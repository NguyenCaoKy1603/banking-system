const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("yaml");

const contractPath = path.resolve(
  __dirname,
  "../../documents/api/banking-mvp.openapi.yaml",
);
const document = parse(fs.readFileSync(contractPath, "utf8"));
const backendHttpPath = path.resolve(__dirname, "../../backend/src/http.ts");
const backendHttp = fs.readFileSync(backendHttpPath, "utf8");

if (document.openapi !== "3.1.0") {
  throw new Error("Expected an OpenAPI 3.1 contract.");
}

if (!String(document.info?.version).endsWith("-draft") || !String(document.info?.description).includes("DRAFT")) {
  throw new Error("Banking OpenAPI must remain explicitly marked as DRAFT until approval.");
}

const requiredPaths = [
  "/auth/register",
  "/auth/register/verify",
  "/auth/challenges/{challengeId}/resend",
  "/auth/otp/challenges",
  "/auth/login",
  "/auth/verify",
  "/auth/refresh",
  "/auth/logout",
  "/auth/logout-all",
  "/mobile/control-policy",
  "/notifications",
  "/notifications/{notificationId}/read",
  "/fraud-reports",
  "/fraud-reports/{reportId}",
  "/accounts",
  "/accounts/{accountId}/number",
  "/accounts/{accountId}/transactions",
  "/accounts/{accountId}/transactions/{transactionId}",
  "/beneficiaries",
  "/beneficiaries/{beneficiaryId}",
  "/internal-recipients/lookup",
  "/transfers/quote",
  "/transfers",
  "/transfers/{transferId}",
  "/savings/products",
  "/savings/quotes",
  "/savings/deposits",
  "/savings/openings/{openingId}",
  "/savings/deposits/{depositId}",
  "/cards",
  "/cards/{cardId}",
  "/cards/{cardId}/lock",
  "/cards/{cardId}/unlock",
  "/credit/accounts",
  "/credit/applications",
  "/credit/applications/{applicationId}",
  "/credit/applications/{applicationId}/activate",
  "/credit/accounts/{creditAccountId}",
  "/credit/accounts/{creditAccountId}/transactions",
  "/credit/accounts/{creditAccountId}/statements",
  "/credit/accounts/{creditAccountId}/statements/{statementId}",
  "/credit/payment-quotes",
  "/credit/payments",
  "/credit/payments/{paymentId}",
  "/kyc/application",
  "/kyc/application/submit",
];

for (const requiredPath of requiredPaths) {
  if (!document.paths?.[requiredPath]) {
    throw new Error(`Missing required path: ${requiredPath}`);
  }

  const operation = Object.values(document.paths[requiredPath]).find(
    (value) => value && typeof value === "object" && "operationId" in value,
  );
  if (!operation?.operationId) {
    throw new Error(`Missing operationId for required path: ${requiredPath}`);
  }
}

const requiredExampleSchemas = [
  "RegisterRequest",
  "LoginRequest",
  "VerifyAuthChallengeRequest",
  "TransferQuoteRequest",
  "SubmitTransferRequest",
  "SavingsQuoteRequest",
  "SubmitSavingsOpeningRequest",
  "CreditStepUpRequest",
  "CreditPaymentQuoteRequest",
  "CreditPaymentRequest",
];
for (const schemaName of requiredExampleSchemas) {
  if (!document.components?.schemas?.[schemaName]?.example) {
    throw new Error(`Missing non-secret example for schema: ${schemaName}`);
  }
}

const implementationMarkers = [
  'segments[1] === "register"',
  'segments[1] === "login"',
  'segments[1] === "verify"',
  'segments[1] === "refresh"',
  'segments[1] === "logout"',
  'segments[1] === "logout-all"',
  'segments[1] === "control-policy"',
  'segments[0] === "notifications"',
  'segments[0] === "fraud-reports"',
  'segments[0] === "accounts"',
  'segments[0] === "beneficiaries"',
  'segments[0] === "internal-recipients"',
  'segments[0] === "transfers"',
  'segments[0] === "savings"',
  'segments[0] === "cards"',
  'segments[0] === "credit"',
  'segments[1] === "applications"',
  'segments[0] === "kyc"',
];
for (const marker of implementationMarkers) {
  if (!backendHttp.includes(marker)) {
    throw new Error(`Reference backend route marker missing: ${marker}`);
  }
}

const submitTransfer = document.paths["/transfers"].post;
const idempotencyParameter = submitTransfer?.parameters?.find(
  (parameter) => parameter.name === "Idempotency-Key",
);

if (idempotencyParameter?.required !== true) {
  throw new Error("POST /transfers must require Idempotency-Key.");
}

const loginResponses = document.paths["/auth/login"].post?.responses;
if (!loginResponses?.["200"] || loginResponses?.["202"]) {
  throw new Error("POST /auth/login must document only the password session response.");
}

const refreshResponses = document.paths["/auth/refresh"].post?.responses;
if (refreshResponses?.["202"]) {
  throw new Error("POST /auth/refresh must not document a login MFA response.");
}

if (!submitTransfer?.responses?.["200"] || !submitTransfer?.responses?.["202"]) {
  throw new Error("POST /transfers must document synchronous and pending responses.");
}

const submitCreditPayment = document.paths["/credit/payments"].post;
const creditIdempotencyParameter = submitCreditPayment?.parameters?.find(
  (parameter) => parameter.name === "Idempotency-Key",
);
if (creditIdempotencyParameter?.required !== true) {
  throw new Error("POST /credit/payments must require Idempotency-Key.");
}
if (!submitCreditPayment?.responses?.["200"] || !submitCreditPayment?.responses?.["202"]) {
  throw new Error("POST /credit/payments must document synchronous and pending responses.");
}

const submitFraudReport = document.paths["/fraud-reports"].post;
const fraudIdempotencyParameter = submitFraudReport?.parameters?.find(
  (parameter) =>
    parameter.name === "Idempotency-Key" ||
    parameter.$ref === "#/components/parameters/IdempotencyKey",
);
if (
  fraudIdempotencyParameter?.required !== true &&
  !(
    fraudIdempotencyParameter?.$ref === "#/components/parameters/IdempotencyKey" &&
    document.components?.parameters?.IdempotencyKey?.required === true
  )
) {
  throw new Error("POST /fraud-reports must require Idempotency-Key.");
}

const registerResponses = document.paths["/auth/register"].post?.responses;
if (!registerResponses?.["202"] || registerResponses?.["201"] || registerResponses?.["200"]) {
  throw new Error("POST /auth/register must expose only the two-step challenge success response.");
}

const authChallengeSchema = document.components?.schemas?.AuthChallengeResponse;
if (!authChallengeSchema?.required?.includes("purpose")) {
  throw new Error("AuthChallengeResponse must require a bound purpose.");
}

const securitySchemes = document.components?.securitySchemes;
if (securitySchemes?.bearerAuth?.type !== "http") {
  throw new Error("The contract must define bearerAuth.");
}

if (document.components?.parameters?.DeviceId?.name !== "X-Device-ID") {
  throw new Error("The contract must define X-Device-ID device binding.");
}


const deviceBindingScheme =
  document.components?.securitySchemes?.deviceBinding;
if (
  deviceBindingScheme?.type !== "apiKey" ||
  deviceBindingScheme?.in !== "header" ||
  deviceBindingScheme?.name !== "X-Device-ID"
) {
  throw new Error(
    "The contract must define deviceBinding as the X-Device-ID header API key.",
  );
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const PUBLIC_OPERATIONS = new Set([
  "POST /auth/register",
  "POST /auth/register/verify",
  "POST /auth/challenges/{challengeId}/resend",
  "POST /auth/login",
  "POST /auth/refresh",
  "POST /auth/verify",
  "POST /auth/logout",
  "POST /auth/mfa/recover",
  "POST /auth/mfa/recover/verify",
  "POST /auth/mfa/recover/complete",
  "POST /auth/mfa/recover/enroll",
]);
for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
  for (const [method, operation] of Object.entries(pathItem ?? {})) {
    if (!HTTP_METHODS.has(method) || !operation || typeof operation !== "object") {
      continue;
    }
    const effectiveSecurity = operation.security ?? document.security ?? [];
    const operationKey = `${method.toUpperCase()} ${routePath}`;
    if (PUBLIC_OPERATIONS.has(operationKey)) {
      if (effectiveSecurity.length !== 0) {
        throw new Error(`${operationKey} must use its documented public unauthenticated boundary.`);
      }
      continue;
    }

    const requirement = effectiveSecurity[0];
    if (
      effectiveSecurity.length !== 1 ||
      !requirement ||
      !Object.prototype.hasOwnProperty.call(requirement, "bearerAuth") ||
      !Object.prototype.hasOwnProperty.call(requirement, "deviceBinding") ||
      Object.keys(requirement).length !== 2
    ) {
      throw new Error(
        `${operationKey} must require bearerAuth and deviceBinding together with no weaker alternative.`,
      );
    }
  }
}

function resolveParameter(parameter) {
  if (parameter?.$ref === "#/components/parameters/DeviceId") {
    return document.components?.parameters?.DeviceId;
  }
  return parameter;
}

for (const [method, routePath] of [
  ["post", "/auth/register"],
  ["post", "/auth/register/verify"],
  ["post", "/auth/challenges/{challengeId}/resend"],
  ["post", "/auth/login"],
  ["post", "/auth/verify"],
  ["post", "/auth/refresh"],
  ["post", "/auth/logout"],
]) {
  const pathItem = document.paths?.[routePath];
  const operation = pathItem?.[method];
  const parameters = [
    ...(pathItem?.parameters ?? []),
    ...(operation?.parameters ?? []),
  ].map(resolveParameter);
  if (
    !parameters.some(
      (parameter) =>
        parameter?.name === "X-Device-ID" &&
        parameter?.in === "header" &&
        parameter?.required === true,
    )
  ) {
    throw new Error(
      `${method.toUpperCase()} ${routePath} must require X-Device-ID without bearer auth.`,
    );
  }
}

function resolveSchema(schema) {
  const prefix = "#/components/schemas/";
  if (schema?.$ref?.startsWith(prefix)) {
    return document.components?.schemas?.[schema.$ref.slice(prefix.length)];
  }
  return schema;
}

function requireChallengeBoundStepUp(schema, label) {
  const resolved = resolveSchema(schema);
  if (
    !resolved?.required?.includes("challengeId") ||
    !resolved?.properties?.challengeId
  ) {
    throw new Error(`${label} must require a challenge-bound challengeId.`);
  }
}

requireChallengeBoundStepUp(
  document.components?.schemas?.SubmitTransferRequest?.properties?.stepUp,
  "SubmitTransferRequest.stepUp",
);
requireChallengeBoundStepUp(
  document.components?.schemas?.SubmitSavingsOpeningRequest?.properties?.stepUp,
  "SubmitSavingsOpeningRequest.stepUp",
);
requireChallengeBoundStepUp(
  document.components?.schemas?.CreditStepUpRequest,
  "CreditStepUpRequest",
);

for (const [schemaName, schema] of Object.entries(
  document.components?.schemas ?? {},
)) {
  const stepUpSchema = resolveSchema(schema?.properties?.stepUp);
  if (
    stepUpSchema?.required?.includes("challengeId") &&
    !schema?.example?.stepUp?.challengeId
  ) {
    throw new Error(
      `${schemaName}.example.stepUp must include its required challengeId.`,
    );
  }
}

if (!document.components?.schemas?.CreditStepUpRequest?.example?.challengeId) {
  throw new Error("CreditStepUpRequest.example must include challengeId.");
}

const publicChallengePurposes =
  document.components?.schemas?.CreateOtpChallengeRequest?.properties?.purpose?.enum ?? [];
for (const purpose of ["REGISTRATION_VERIFY", "LOGIN"]) {
  if (publicChallengePurposes.includes(purpose)) {
    throw new Error(
      `POST /auth/otp/challenges must not issue internal ${purpose} challenges.`,
    );
  }
}
for (const purpose of [
  "TRANSFER",
  "SAVINGS_OPENING",
  "CREDIT_APPLICATION",
  "CARD_ACTIVATION",
  "CREDIT_PAYMENT",
  "CARD_UNLOCK",
]) {
  if (!publicChallengePurposes.includes(purpose)) {
    throw new Error(`POST /auth/otp/challenges must support ${purpose}.`);
  }
}

console.log(
  `OpenAPI draft valid: ${requiredPaths.length} required paths, device binding, challenge-bound step-up, examples and reference route markers included.`,
);
