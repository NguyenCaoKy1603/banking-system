import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import type { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import { DomainError } from "../errors.js";
import { header, writeError } from "./httpUtils.js";
import {
  getRateLimitKey,
  getMfaClientAddress,
  verifyMfaLifecycleChallenge,
  beginRegistrationController,
  verifyRegistrationController,
  cancelRegistrationController,
  loginController,
  beginBiometricLoginChallengeController,
  verifyBiometricLoginController,
  verifyLoginController,
  refreshController,
  logoutController,
  logoutAllController,
  startMfaRecoveryController,
  beginRecoveryTotpEnrollmentController,
  confirmRecoveryTotpEnrollmentController,
  resendRegistrationChallengeController,
  listMfaMethodsController,
  enrollBiometricController,
  beginTotpEnrollmentController,
  confirmTotpEnrollmentController,
  revokeMfaMethodController,
  verifyMfaRecoveryCodeController,
  completeAuthenticatedRecoveryController,
  rotateRecoveryCodesController,
  resendMfaChallengeController,
  createOtpChallengeController,
  changePasswordController,
  forgotPasswordController,
  resetPasswordController,
  listDevicesController,
  revokeDeviceController,
} from "../controllers/authController.js";

export {
  getRateLimitKey,
  getMfaClientAddress,
  verifyMfaLifecycleChallenge,
};

export type RequireBearerFn = (
  request: IncomingMessage,
  system: BankingSystem,
  options: HttpOptions,
  relationalAuth?: RelationalHttpBoundary,
) => Promise<string>;

/**
 * Handles public and pre-authenticated auth routes (Router / Dispatcher):
 * - POST /auth/register
 * - POST /auth/register/verify
 * - POST /auth/register/cancel
 * - POST /auth/login
 * - POST /auth/verify
 * - POST /auth/refresh
 * - POST /auth/logout
 * - POST /auth/logout-all
 * - Pre-auth MFA recovery and challenge resend
 */
export async function handlePublicAuthRoute(
  request: IncomingMessage,
  response: ServerResponse,
  segments: readonly string[],
  body: unknown,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
  requireBearer: RequireBearerFn,
): Promise<boolean> {
  if (segments[0] !== "auth") {
    return false;
  }

  const relationalV2 = process.env.BANKING_PERSISTENCE_MODE?.trim() === "relational-v2";
  const registrationRoute = request.method === "POST" && segments[1] === "register";
  if (relationalV2 && registrationRoute && !(options.relationalHttp?.isRouteEnabled(request.method, segments) ?? false)) {
    writeError(
      response,
      503,
      traceId,
      new DomainError(
        503,
        "RELATIONAL_ROUTE_OUT_OF_SCOPE",
        "Registration requires an approved relational email-provider boundary and is disabled in this local relational-v2 cutover.",
      ),
    );
    return true;
  }

  const relationalAuth = options.relationalHttp?.isRouteEnabled(request.method, segments)
    ? options.relationalHttp
    : undefined;

  // POST /auth/register
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "auth" &&
    segments[1] === "register"
  ) {
    await beginRegistrationController(request, response, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/register/verify
  if (
    request.method === "POST" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "register" &&
    segments[2] === "verify"
  ) {
    await verifyRegistrationController(request, response, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/register/cancel
  if (
    request.method === "POST" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "register" &&
    segments[2] === "cancel"
  ) {
    await cancelRegistrationController(request, response, body, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/login
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "auth" &&
    segments[1] === "login"
  ) {
    await loginController(request, response, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/mfa/biometric/login/challenge
  if (
    request.method === "POST" &&
    segments.length === 5 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "biometric" &&
    segments[3] === "login" &&
    segments[4] === "challenge"
  ) {
    await beginBiometricLoginChallengeController(request, response, body, options, relationalAuth, traceId);
    return true;
  }

  // POST /auth/mfa/biometric/login/verify
  if (
    request.method === "POST" &&
    segments.length === 5 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "biometric" &&
    segments[3] === "login" &&
    segments[4] === "verify"
  ) {
    await verifyBiometricLoginController(request, response, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/verify (legacy login challenge)
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "auth" &&
    segments[1] === "verify"
  ) {
    await verifyLoginController(request, response, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/refresh
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "auth" &&
    segments[1] === "refresh"
  ) {
    await refreshController(request, response, body, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/logout
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "auth" &&
    segments[1] === "logout"
  ) {
    await logoutController(request, response, body, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/logout-all
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "auth" &&
    segments[1] === "logout-all"
  ) {
    await logoutAllController(request, response, options, system, relationalAuth, traceId, requireBearer);
    return true;
  }

  // POST /auth/password/forgot
  if (
    request.method === "POST" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "password" &&
    segments[2] === "forgot"
  ) {
    await forgotPasswordController(request, response, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/password/reset
  if (
    request.method === "POST" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "password" &&
    segments[2] === "reset"
  ) {
    await resetPasswordController(request, response, body, options, system, relationalAuth, traceId);
    return true;
  }

  // PRE-AUTH MFA RECOVERY: /auth/mfa/recover(/verify|/complete)
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    ((segments.length === 3 && segments[2] === "recover") ||
      (segments.length === 4 && segments[2] === "recover" && (segments[3] === "verify" || segments[3] === "complete"))) &&
    !header(request, "authorization")
  ) {
    await startMfaRecoveryController(
      request,
      response,
      body,
      options,
      system,
      relationalAuth,
      traceId,
      segments[3] === "complete",
    );
    return true;
  }

  // PRE-AUTH RECOVERY ENROLL: /auth/mfa/recover/enroll
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "recover" &&
    segments[3] === "enroll" &&
    !header(request, "authorization")
  ) {
    await beginRecoveryTotpEnrollmentController(response, body, options, traceId);
    return true;
  }

  // PRE-AUTH TOTP CONFIRM: /auth/mfa/totp/confirm
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "totp" &&
    segments[3] === "confirm" &&
    !header(request, "authorization")
  ) {
    await confirmRecoveryTotpEnrollmentController(response, body, options, traceId);
    return true;
  }

  // PRE-AUTH RESEND: /auth/challenges/:id/resend
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "challenges" &&
    segments[3] === "resend" &&
    !header(request, "authorization")
  ) {
    await resendRegistrationChallengeController(request, response, segments[2]!, body, options, traceId);
    return true;
  }

  return false;
}

/**
 * Handles authenticated MFA & Security routes (Router / Dispatcher):
 * - GET    /auth/mfa/methods
 * - POST   /auth/mfa/biometric/enroll
 * - POST   /auth/mfa/totp/enroll
 * - POST   /auth/mfa/totp/confirm
 * - DELETE /auth/mfa/methods
 * - POST   /auth/mfa/recover
 * - POST   /auth/mfa/recover/verify
 * - POST   /auth/mfa/recover/complete
 * - POST   /auth/mfa/recovery-codes/rotate
 * - POST   /auth/challenges/:id/resend
 * - POST   /auth/otp/challenges
 */
export async function handleAuthenticatedMfaRoute(
  request: IncomingMessage,
  response: ServerResponse,
  segments: readonly string[],
  body: unknown,
  userId: string,
  relationalAuth: RelationalHttpBoundary | undefined,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<boolean> {
  if (segments[0] !== "auth") {
    return false;
  }

  // POST /auth/password/change
  if (
    request.method === "POST" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "password" &&
    segments[2] === "change"
  ) {
    await changePasswordController(request, response, userId, body, options, system, relationalAuth, traceId);
    return true;
  }

  // GET /auth/devices
  if (
    request.method === "GET" &&
    segments.length === 2 &&
    segments[0] === "auth" &&
    segments[1] === "devices"
  ) {
    await listDevicesController(request, response, userId, relationalAuth, system, traceId);
    return true;
  }

  // DELETE /auth/devices/:deviceId
  if (
    request.method === "DELETE" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "devices"
  ) {
    await revokeDeviceController(request, response, userId, segments[2], relationalAuth, system, traceId);
    return true;
  }

  // GET /auth/mfa/methods
  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "methods"
  ) {
    await listMfaMethodsController(response, userId, options, system, traceId);
    return true;
  }

  // POST /auth/mfa/biometric/enroll
  if (
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "biometric" &&
    segments[3] === "enroll"
  ) {
    await enrollBiometricController(request, response, userId, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/mfa/totp/enroll
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "totp" &&
    segments[3] === "enroll"
  ) {
    await beginTotpEnrollmentController(request, response, userId, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/mfa/totp/confirm
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "totp" &&
    segments[3] === "confirm"
  ) {
    await confirmTotpEnrollmentController(response, userId, body, options, system, relationalAuth, traceId);
    return true;
  }

  // DELETE /auth/mfa/methods/:id
  if (
    request.method === "DELETE" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "methods"
  ) {
    await revokeMfaMethodController(request, response, userId, segments[3], body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/mfa/recover (authenticated)
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "recover"
  ) {
    await verifyMfaRecoveryCodeController(response, userId, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/mfa/recover/verify (authenticated)
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "recover" &&
    segments[3] === "verify"
  ) {
    await verifyMfaRecoveryCodeController(response, userId, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/mfa/recover/complete (authenticated)
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "recover" &&
    segments[3] === "complete"
  ) {
    await completeAuthenticatedRecoveryController(response, userId, body, options, traceId);
    return true;
  }

  // POST /auth/mfa/recovery-codes/rotate
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "mfa" &&
    segments[2] === "recovery-codes" &&
    segments[3] === "rotate"
  ) {
    await rotateRecoveryCodesController(request, response, userId, body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/challenges/:id/resend
  if (
    options.mfaService &&
    request.method === "POST" &&
    segments.length === 4 &&
    segments[0] === "auth" &&
    segments[1] === "challenges" &&
    segments[3] === "resend"
  ) {
    await resendMfaChallengeController(request, response, userId, segments[2], body, options, system, relationalAuth, traceId);
    return true;
  }

  // POST /auth/otp/challenges
  if (
    request.method === "POST" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "otp" &&
    segments[2] === "challenges"
  ) {
    await createOtpChallengeController(request, response, userId, body, options, system, traceId);
    return true;
  }

  return false;
}
