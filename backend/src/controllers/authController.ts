import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions, PersistentStepUpPurpose } from "../http.js";
import type { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import type { PersistentMfaService } from "../mfa/persistentMfaService.js";
import type { OtpPurpose } from "../types.js";
import { conflictWithCode, invalidRequest, unauthorized } from "../errors.js";
import { computeRegistrationNetworkFingerprint, fingerprint } from "../security.js";
import { header, requireObject, requireDeviceId, writeResponse } from "../routes/httpUtils.js";
import type { RequireBearerFn } from "../routes/authRoutes.js";

/**
 * Auth & MFA Controller (Tầng Controller - Xử lý Request/Response cho Xác thực, Đăng ký, Đăng nhập & MFA/TOTP)
 */

export function getRateLimitKey(request: IncomingMessage, registrationFingerprintKey: Buffer): string {
  return computeRegistrationNetworkFingerprint(request.socket.remoteAddress, registrationFingerprintKey);
}

export function getMfaClientAddress(request: IncomingMessage): string {
  const forwardedFor = header(request, "x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.socket.remoteAddress || "unknown-client";
}

export async function verifyMfaLifecycleChallenge(
  mfaService: PersistentMfaService,
  request: IncomingMessage,
  customerId: string,
  data: Record<string, unknown>,
  purpose: "MFA_FACTOR_CHANGE" | "MFA_FACTOR_REMOVAL",
): Promise<void> {
  if (typeof data.challengeId !== "string" || typeof data.code !== "string") {
    throw conflictWithCode("MFA_CURRENT_FACTOR_REQUIRED", "Current TOTP verification is required for this MFA change.");
  }
  const result = await mfaService.verifyChallenge({
    challengeId: data.challengeId,
    customerId,
    deviceId: requireDeviceId(request),
    proof: data.code,
    purpose,
    resourceId: null,
    requestFingerprint: null,
  });
  if (result.customerId !== customerId) {
    throw unauthorized("MFA user binding is invalid.");
  }
}

// ==========================================
// PUBLIC AUTH CONTROLLERS
// ==========================================

export async function beginRegistrationController(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  writeResponse(
    response,
    202,
    traceId,
    relationalAuth && options.mfaService
      ? await relationalAuth.beginRegistration(
        data as never,
        requireDeviceId(request),
        options.mfaService,
        getRateLimitKey(request, options.registrationFingerprintKey),
      )
      : await system.beginRegistrationAsync(
        data as never,
        getRateLimitKey(request, options.registrationFingerprintKey),
        requireDeviceId(request),
      ),
  );
}

export async function verifyRegistrationController(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  const challengeId = data.challengeId;
  const method = data.method;
  const proof = data.proof;

  if (typeof challengeId !== "string" || challengeId.length < 1) {
    throw invalidRequest("challengeId is required.", { challengeId: "challengeId must be a non-empty string." });
  }
  if (method !== "EMAIL_OTP") {
    throw invalidRequest("method must be EMAIL_OTP for registration verification.", { method: "method must be EMAIL_OTP." });
  }
  if (typeof proof !== "string" || proof.length < 1) {
    throw invalidRequest("proof is required.", { proof: "proof must be a non-empty string." });
  }

  writeResponse(
    response,
    201,
    traceId,
    relationalAuth && options.mfaService
      ? await relationalAuth.verifyRegistration(
        challengeId,
        proof,
        requireDeviceId(request),
        options.mfaService,
      )
      : await Promise.resolve(system.verifyRegistrationChallenge(challengeId, proof, requireDeviceId(request))),
  );
}

export async function cancelRegistrationController(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  const challengeId = data.challengeId;

  if (typeof challengeId !== "string" || challengeId.length < 1) {
    throw invalidRequest("challengeId is required.", { challengeId: "challengeId must be a non-empty string." });
  }

  const rawDeviceId = header(request, "x-device-id");
  if (!rawDeviceId?.trim()) {
    throw invalidRequest("Device binding is required.");
  }
  const deviceId = rawDeviceId.trim();

  if (relationalAuth) {
    await (relationalAuth as any).registration.cancel(challengeId, deviceId);
  } else {
    await (system as any).cancelRegistrationChallenge?.(challengeId, deviceId);
  }

  writeResponse(response, 204, traceId);
}

export async function loginController(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  const user = relationalAuth
    ? await relationalAuth.loginPasswordOnly(data.email as string, data.password as string, requireDeviceId(request))
    : await system.loginPasswordOnly(data.email as string, data.password as string, requireDeviceId(request));
  if (options.customerAccessStatus && (await options.customerAccessStatus(user.id)) === "LOCKED") {
    throw unauthorized("Customer access is locked by the control plane.");
  }
  writeResponse(
    response,
    200,
    traceId,
    relationalAuth
      ? await relationalAuth.issueMfaSession(user.id, requireDeviceId(request))
      : system.issueMfaSession(user.id, requireDeviceId(request)),
  );
}

export async function verifyLoginController(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  if (relationalAuth) {
    throw invalidRequest("Relational-v2 login is password-only; no login MFA challenge is supported.");
  }
  if (options.mfaService) {
    const result = await options.mfaService.verifyChallenge({
      challengeId: data.challengeId as string,
      deviceId: requireDeviceId(request),
      proof: data.proof as string,
      purpose: "LOGIN",
    });
    if (!result.customerId) {
      throw unauthorized("MFA user binding is invalid.");
    }
    if (options.customerAccessStatus && (await options.customerAccessStatus(result.customerId)) === "LOCKED") {
      throw unauthorized("Customer access is locked by the control plane.");
    }
    writeResponse(response, 200, traceId, system.issueMfaSession(result.customerId, requireDeviceId(request)));
    return;
  }
  writeResponse(
    response,
    200,
    traceId,
    system.verifyLoginChallenge(
      data.challengeId as string,
      data.method as "OTP" | "TOTP" | "BIOMETRIC",
      data.proof as string,
      requireDeviceId(request),
    ),
  );
}

export async function refreshController(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  writeResponse(
    response,
    200,
    traceId,
    relationalAuth
      ? await relationalAuth.refresh(data.refreshToken as string, requireDeviceId(request))
      : system.refresh(data.refreshToken as string, requireDeviceId(request)),
  );
}

export async function logoutController(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  const revoked = relationalAuth
    ? await relationalAuth.revoke(data.refreshToken as string, requireDeviceId(request))
    : system.revoke(data.refreshToken as string, requireDeviceId(request));
  if (!revoked) {
    throw unauthorized("Refresh token is invalid.");
  }
  writeResponse(response, 204, traceId);
}

export async function logoutAllController(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
  requireBearer: RequireBearerFn,
): Promise<void> {
  const userId = await requireBearer(request, system, options, relationalAuth);
  if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
  else system.revokeAllSessions(userId);
  writeResponse(response, 204, traceId);
}

export async function startMfaRecoveryController(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
  complete: boolean,
): Promise<void> {
  if (!options.mfaService) return;
  const data = requireObject(body);
  if (complete) {
    if (typeof data.recoveryToken !== "string" || !data.recoveryToken.trim()) {
      throw invalidRequest("recoveryToken is required.");
    }
    await options.mfaService.completeRecovery({ recoveryToken: data.recoveryToken });
    writeResponse(response, 202, traceId, { status: "RECOVERY_COMPLETED" });
    return;
  }
  if (typeof data.email !== "string" || typeof data.password !== "string" || typeof data.code !== "string") {
    throw invalidRequest("email, password and code are required to start MFA recovery.");
  }
  const user = relationalAuth
    ? await relationalAuth.loginPasswordOnly(data.email, data.password, requireDeviceId(request))
    : await system.loginPasswordOnly(data.email, data.password, requireDeviceId(request));
  const recovery = await options.mfaService.verifyRecoveryCode(user.id, data.code);
  if (relationalAuth) await relationalAuth.revokeAllSessions(user.id);
  else system.revokeAllSessions(user.id);
  writeResponse(response, 202, traceId, { ...recovery, status: "RECOVERY_STARTED" });
}

export async function beginRecoveryTotpEnrollmentController(
  response: ServerResponse,
  body: unknown,
  options: HttpOptions,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) return;
  const data = requireObject(body);
  if (typeof data.recoveryToken !== "string" || !data.recoveryToken.trim()) {
    throw invalidRequest("recoveryToken is required.");
  }
  writeResponse(
    response,
    201,
    traceId,
    await options.mfaService.beginRecoveryTotpEnrollment({
      recoveryToken: data.recoveryToken,
      displayName: typeof data.displayName === "string" ? data.displayName : undefined,
    }),
  );
}

export async function confirmRecoveryTotpEnrollmentController(
  response: ServerResponse,
  body: unknown,
  options: HttpOptions,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) return;
  const data = requireObject(body);
  if (
    typeof data.recoveryToken === "string" &&
    typeof data.credentialId === "string" &&
    typeof data.code === "string"
  ) {
    writeResponse(
      response,
      200,
      traceId,
      await options.mfaService.confirmTotpEnrollment({
        recoveryToken: data.recoveryToken,
        credentialId: data.credentialId,
        code: data.code,
      }),
    );
  }
}

export async function resendRegistrationChallengeController(
  request: IncomingMessage,
  response: ServerResponse,
  challengeId: string,
  body: unknown,
  options: HttpOptions,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) return;
  requireObject(body);
  writeResponse(
    response,
    200,
    traceId,
    await options.mfaService.resendRegistrationChallenge({
      challengeId,
      deviceId: requireDeviceId(request),
      networkFingerprint: getRateLimitKey(request, options.registrationFingerprintKey),
    }),
  );
}

// ==========================================
// AUTHENTICATED MFA & SECURITY CONTROLLERS
// ==========================================

export async function listMfaMethodsController(
  response: ServerResponse,
  userId: string,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) {
    writeResponse(response, 200, traceId, { items: system.listBiometricCredentials(userId) });
    return;
  }
  writeResponse(response, 200, traceId, { items: await options.mfaService.listCredentials(userId) });
}

export async function enrollBiometricController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  const deviceId = requireDeviceId(request);
  const passwordValid = relationalAuth
    ? await relationalAuth.verifyCurrentPassword(userId, typeof data.password === "string" ? data.password : "")
    : typeof data.password === "string" && system.verifyCurrentPassword(userId, data.password);
  if (!passwordValid) {
    throw unauthorized("Current password is invalid.");
  }
  const displayName = typeof data.displayName === "string" ? data.displayName : undefined;
  if (options.mfaService) {
    if (typeof data.challengeId === "string" && data.challengeId.trim()) {
      await verifyMfaLifecycleChallenge(options.mfaService, request, userId, data, "MFA_FACTOR_CHANGE");
    }
    writeResponse(
      response,
      201,
      traceId,
      await options.mfaService.enrollBiometricCredential({
        customerId: userId,
        deviceId,
        displayName,
      }),
    );
    return;
  }
  writeResponse(
    response,
    201,
    traceId,
    system.enrollBiometricCredential(userId, deviceId, displayName),
  );
}

export async function beginTotpEnrollmentController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) return;
  const data = requireObject(body);
  const passwordValid = relationalAuth
    ? await relationalAuth.verifyCurrentPassword(userId, typeof data.password === "string" ? data.password : "")
    : typeof data.password === "string" && system.verifyCurrentPassword(userId, data.password);
  if (!passwordValid) {
    throw unauthorized("Current password is invalid.");
  }
  const credentials = await options.mfaService.listCredentials(userId);
  if (credentials.some((credential) => credential.status === "ACTIVE")) {
    await verifyMfaLifecycleChallenge(options.mfaService, request, userId, data, "MFA_FACTOR_CHANGE");
  }
  const user = relationalAuth
    ? await relationalAuth.getUser(userId)
    : system.getUser(userId);
  writeResponse(
    response,
    201,
    traceId,
    await options.mfaService.beginTotpEnrollment({
      customerId: userId,
      email: user.email,
      displayName: typeof data.displayName === "string" ? data.displayName : undefined,
    }),
  );
}

export async function confirmTotpEnrollmentController(
  response: ServerResponse,
  userId: string,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) return;
  const data = requireObject(body);
  const confirmation = await options.mfaService.confirmTotpEnrollment({
    customerId: userId,
    credentialId: data.credentialId as string,
    code: data.code as string,
  });
  if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
  else system.revokeAllSessions(userId);
  writeResponse(response, 200, traceId, confirmation);
}

export async function revokeMfaMethodController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  credentialId: string,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  const data = body === undefined ? {} : requireObject(body);
  const passwordValid = relationalAuth
    ? await relationalAuth.verifyCurrentPassword(userId, typeof data.password === "string" ? data.password : "")
    : typeof data.password === "string" && system.verifyCurrentPassword(userId, data.password);
  if (!passwordValid) {
    throw unauthorized("Current password is invalid.");
  }
  if (!options.mfaService) {
    system.revokeBiometricCredential(userId, credentialId);
    writeResponse(response, 204, traceId);
    return;
  }
  const credentials = await options.mfaService.listCredentials(userId);
  if (credentials.some((credential) => credential.status === "ACTIVE")) {
    await verifyMfaLifecycleChallenge(options.mfaService, request, userId, data, "MFA_FACTOR_REMOVAL");
  }
  await options.mfaService.revokeCredential(userId, credentialId, true);
  if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
  else system.revokeAllSessions(userId);
  writeResponse(response, 204, traceId);
}

export async function verifyMfaRecoveryCodeController(
  response: ServerResponse,
  userId: string,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) return;
  const data = requireObject(body);
  const recovery = await options.mfaService.verifyRecoveryCode(userId, data.code as string);
  if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
  else system.revokeAllSessions(userId);
  writeResponse(response, 202, traceId, { ...recovery, status: "RECOVERY_STARTED" });
}

export async function completeAuthenticatedRecoveryController(
  response: ServerResponse,
  userId: string,
  body: unknown,
  options: HttpOptions,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) return;
  const data = requireObject(body);
  if (typeof data.recoveryToken !== "string" || !data.recoveryToken.trim()) {
    throw invalidRequest("recoveryToken is required.");
  }
  await options.mfaService.completeRecovery({
    customerId: userId,
    recoveryToken: data.recoveryToken,
  });
  writeResponse(response, 202, traceId, { status: "RECOVERY_COMPLETED" });
}

export async function rotateRecoveryCodesController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) return;
  const data = requireObject(body);
  const passwordValid = relationalAuth
    ? await relationalAuth.verifyCurrentPassword(userId, typeof data.password === "string" ? data.password : "")
    : typeof data.password === "string" && system.verifyCurrentPassword(userId, data.password);
  if (typeof data.password === "string" && !passwordValid) {
    throw unauthorized("Current password is invalid.");
  }
  if (typeof data.challengeId !== "string" || typeof data.code !== "string") {
    throw invalidRequest("challengeId and code are required for recovery-code rotation.");
  }
  const result = await options.mfaService.verifyChallenge({
    challengeId: data.challengeId,
    customerId: userId,
    deviceId: requireDeviceId(request),
    proof: data.code,
    purpose: "RECOVERY_CODE_ROTATION",
  });
  if (result.customerId !== userId) {
    throw unauthorized("MFA user binding is invalid.");
  }
  if (relationalAuth) await relationalAuth.revokeAllSessions(userId);
  else system.revokeAllSessions(userId);
  writeResponse(response, 200, traceId, {
    status: "ROTATED",
    recoveryCodes: await options.mfaService.rotateRecoveryCodes(userId),
  });
}

export async function resendMfaChallengeController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  challengeId: string,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  relationalAuth: RelationalHttpBoundary | undefined,
  traceId: string,
): Promise<void> {
  if (!options.mfaService) return;
  requireObject(body);
  const user = relationalAuth
    ? await relationalAuth.getUser(userId)
    : system.getUser(userId);
  writeResponse(
    response,
    200,
    traceId,
    await options.mfaService.resendChallenge({
      challengeId,
      customerId: userId,
      deviceId: requireDeviceId(request),
      destination: user.email,
      networkFingerprint: getMfaClientAddress(request),
    }),
  );
}

export async function createOtpChallengeController(
  request: IncomingMessage,
  response: ServerResponse,
  userId: string,
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  if (options.mfaService) {
    const supportedPurposes = new Set<PersistentStepUpPurpose>([
      "TRANSFER",
      "SAVINGS_OPENING",
      "SAVINGS_WITHDRAWAL",
      "CREDIT_APPLICATION",
      "CARD_ACTIVATION",
      "CREDIT_PAYMENT",
      "CARD_UNLOCK",
      "CARD_REPORT_LOST",
      "RECOVERY_CODE_ROTATION",
      "MFA_FACTOR_CHANGE",
      "MFA_FACTOR_REMOVAL",
    ]);
    if (typeof data.purpose !== "string" || !supportedPurposes.has(data.purpose as PersistentStepUpPurpose)) {
      throw invalidRequest("purpose is not supported for persistent TOTP step-up.");
    }
    const purpose = data.purpose as PersistentStepUpPurpose;
    const resourceId = typeof data.resourceId === "string" ? data.resourceId : null;
    const directTransferCutover = purpose === "TRANSFER" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["transfers"]);
    const directSavingsCutover = purpose === "SAVINGS_OPENING" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["savings", "deposits"]);
    const directSavingsWithdrawalCutover = purpose === "SAVINGS_WITHDRAWAL" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["savings", "deposits", resourceId, "withdraw"]);
    const directCreditPaymentCutover = purpose === "CREDIT_PAYMENT" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["credit", "payments"]);
    const directCreditCardCutover = purpose === "CARD_UNLOCK" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["cards", resourceId, "unlock"]);
    const directCardLostCutover = purpose === "CARD_REPORT_LOST" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["cards", resourceId, "report-lost"]);
    const directCreditApplicationCutover = purpose === "CREDIT_APPLICATION" && options.relationalHttp?.isRouteEnabled("POST", ["credit", "applications"]);
    const directCreditActivationCutover = purpose === "CARD_ACTIVATION" && resourceId && options.relationalHttp?.isRouteEnabled("POST", ["credit", "applications", resourceId, "activate"]);
    const directMfaLifecycle = options.relationalHttp?.isRouteEnabled("POST", ["auth", "otp", "challenges"]) &&
      ["MFA_FACTOR_CHANGE", "MFA_FACTOR_REMOVAL", "RECOVERY_CODE_ROTATION"].includes(purpose);
    const requestFingerprint = directTransferCutover && options.relationalHttp
      ? await options.relationalHttp.getTransferStepUpRequestFingerprint(resourceId)
      : directSavingsCutover && options.relationalHttp
        ? await options.relationalHttp.getSavingsStepUpRequestFingerprint(resourceId)
        : directSavingsWithdrawalCutover
          ? fingerprint({ depositId: resourceId, action: "EARLY_WITHDRAWAL" })
        : directCreditPaymentCutover && options.relationalHttp
          ? await options.relationalHttp.getCreditPaymentStepUpRequestFingerprint(resourceId)
          : directCreditCardCutover
            ? fingerprint({ cardId: resourceId })
          : directCardLostCutover
            ? fingerprint({ cardId: resourceId, action: "REPORT_LOST" })
          : directCreditApplicationCutover
              ? (typeof data.requestFingerprint === "string" ? data.requestFingerprint : null)
              : directCreditActivationCutover
                ? fingerprint({ applicationId: resourceId })
      : directMfaLifecycle
        ? (typeof data.requestFingerprint === "string" ? data.requestFingerprint : null)
        : system.getStepUpRequestFingerprint(
          purpose as OtpPurpose,
          resourceId,
          typeof data.requestFingerprint === "string" ? data.requestFingerprint : null,
        );
    const requestedMethod = typeof data.method === "string" ? data.method : undefined;
    const deviceId = requireDeviceId(request);
    const activeCredentials = await options.mfaService.listCredentials(userId);
    const hasActiveTotp = activeCredentials.some((c) => c.status === "ACTIVE" && c.credentialType === "TOTP");
    const hasActiveBiometric = activeCredentials.some(
      (c) =>
        c.status === "ACTIVE" &&
        c.credentialType === "BIOMETRIC" &&
        (!c.deviceId || c.deviceId === deviceId),
    );

    if (requestedMethod === "BIOMETRIC") {
      if (!hasActiveBiometric) {
        throw invalidRequest("Thiết bị này chưa kích hoạt xác thực sinh trắc học.");
      }
      const bioChallenge = await options.mfaService.beginBiometricChallenge({
        customerId: userId,
        deviceId,
        purpose,
        resourceId,
        requestFingerprint,
        networkFingerprint: getMfaClientAddress(request),
      });
      writeResponse(response, 201, traceId, {
        challengeId: bioChallenge.challengeId,
        expiresAt: bioChallenge.expiresAt,
        methods: hasActiveTotp ? ["TOTP", "BIOMETRIC"] : ["BIOMETRIC"],
        method: "BIOMETRIC",
        purpose,
      });
      return;
    }

    if (purpose === "TRANSFER") {
      if (!hasActiveTotp && !hasActiveBiometric) {
        throw invalidRequest("Tài khoản chưa kích hoạt Google Authenticator (TOTP) hoặc Sinh trắc học. Vui lòng cài đặt trong mục Bảo mật tài khoản trước khi chuyển tiền.");
      }
      if (!hasActiveTotp && hasActiveBiometric) {
        const bioChallenge = await options.mfaService.beginBiometricChallenge({
          customerId: userId,
          deviceId,
          purpose,
          resourceId,
          requestFingerprint,
          networkFingerprint: getMfaClientAddress(request),
        });
        writeResponse(response, 201, traceId, {
          challengeId: bioChallenge.challengeId,
          expiresAt: bioChallenge.expiresAt,
          methods: ["BIOMETRIC"],
          method: "BIOMETRIC",
          purpose,
        });
        return;
      }
      const challenge = await options.mfaService.beginTotpChallenge({
        customerId: userId,
        deviceId,
        purpose,
        resourceId,
        requestFingerprint,
        networkFingerprint: getMfaClientAddress(request),
      });
      writeResponse(response, 201, traceId, {
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt,
        methods: hasActiveBiometric ? ["TOTP", "BIOMETRIC"] : ["TOTP"],
        method: "TOTP",
        purpose,
      });
      return;
    }

    if (requestedMethod === "EMAIL_OTP" || requestedMethod === "OTP" || (!hasActiveTotp && !hasActiveBiometric)) {
      const emailChallenge = await options.mfaService.createEmailChallenge({
        customerId: userId,
        deviceId,
        purpose,
        resourceId,
        requestFingerprint,
        networkFingerprint: getMfaClientAddress(request),
      });
      writeResponse(response, 201, traceId, {
        challengeId: emailChallenge.challengeId,
        expiresAt: emailChallenge.expiresAt,
        methods: hasActiveTotp
          ? (hasActiveBiometric ? ["TOTP", "BIOMETRIC", "EMAIL_OTP", "OTP"] : ["TOTP", "EMAIL_OTP", "OTP"])
          : (hasActiveBiometric ? ["BIOMETRIC", "EMAIL_OTP", "OTP"] : ["EMAIL_OTP", "OTP"]),
        method: "EMAIL_OTP",
        purpose,
        maskedDestination: emailChallenge.maskedDestination,
        resendAfter: emailChallenge.resendAfter,
      });
      return;
    }

    if (!hasActiveTotp && hasActiveBiometric) {
      const bioChallenge = await options.mfaService.beginBiometricChallenge({
        customerId: userId,
        deviceId,
        purpose,
        resourceId,
        requestFingerprint,
        networkFingerprint: getMfaClientAddress(request),
      });
      writeResponse(response, 201, traceId, {
        challengeId: bioChallenge.challengeId,
        expiresAt: bioChallenge.expiresAt,
        methods: ["BIOMETRIC", "EMAIL_OTP", "OTP"],
        method: "BIOMETRIC",
        purpose,
      });
      return;
    }

    const challenge = await options.mfaService.beginTotpChallenge({
      customerId: userId,
      deviceId,
      purpose,
      resourceId,
      requestFingerprint,
      networkFingerprint: getMfaClientAddress(request),
    });
    writeResponse(response, 201, traceId, {
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      methods: hasActiveBiometric ? ["TOTP", "BIOMETRIC", "EMAIL_OTP", "OTP"] : ["TOTP", "EMAIL_OTP", "OTP"],
      method: "TOTP",
      purpose,
    });
    return;
  }

  writeResponse(
    response,
    201,
    traceId,
    system.createOtpChallenge(
      userId,
      requireDeviceId(request),
      data.purpose as never,
      typeof data.resourceId === "string" ? data.resourceId : null,
      typeof data.requestFingerprint === "string" ? data.requestFingerprint : null,
    ),
  );
}
