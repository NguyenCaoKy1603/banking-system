const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("yaml");

const contractPath = path.resolve(__dirname, "../../documents/api/banking-mvp.openapi.yaml");
const backendHttpPath = path.resolve(__dirname, "../src/http.ts");
const routesDir = path.resolve(__dirname, "../src/routes");
const document = parse(fs.readFileSync(contractPath, "utf8"));
const routeSources = fs.existsSync(routesDir)
  ? fs
      .readdirSync(routesDir)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => fs.readFileSync(path.join(routesDir, file), "utf8"))
      .join("\n")
  : "";
const backendHttp = `${fs.readFileSync(backendHttpPath, "utf8")}\n${routeSources}`;

if (document.openapi !== "3.1.0") {
  throw new Error("Expected an OpenAPI 3.1 contract.");
}
if (!String(document.info?.version).endsWith("-draft") || !String(document.info?.description).includes("DRAFT")) {
  throw new Error("Banking OpenAPI must remain explicitly marked as DRAFT until approval.");
}

const requiredPaths = [
  "/auth/register",
  "/auth/register/verify",
  "/auth/otp/challenges",
  "/auth/mfa/methods",
  "/auth/mfa/totp/enroll",
  "/auth/mfa/totp/confirm",
  "/auth/mfa/methods/{credentialId}",
  "/auth/mfa/recover",
  "/auth/mfa/recover/verify",
  "/auth/mfa/recover/complete",
  "/auth/mfa/recover/enroll",
  "/auth/challenges/{challengeId}/resend",
  "/auth/login",
  "/auth/verify",
  "/auth/refresh",
  "/auth/logout",
  "/auth/logout-all",
  "/mobile/control-policy",
  "/notifications",
  "/notifications/{notificationId}/read",
  "/accounts",
  "/internal-recipients/lookup",
  "/accounts/{accountId}/number",
  "/accounts/{accountId}/transactions",
  "/accounts/{accountId}/transactions/{transactionId}",
  "/beneficiaries",
  "/beneficiaries/{beneficiaryId}",
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
  const pathItem = document.paths?.[requiredPath];
  if (!pathItem) {
    throw new Error(`Missing required path: ${requiredPath}`);
  }
  const operation = Object.values(pathItem).find(
    (value) => value && typeof value === "object" && "operationId" in value,
  );
  if (!operation?.operationId) {
    throw new Error(`Missing operationId for required path: ${requiredPath}`);
  }
}

for (const schemaName of [
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
]) {
  if (!document.components?.schemas?.[schemaName]?.example) {
    throw new Error(`Missing non-secret example for schema: ${schemaName}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const methodGuard = (method) => `request.method === "${method}"`;
const segmentGuard = (index, value) => `segments[${index}] === "${value}"`;

const routeContracts = [
  ["POST", "/auth/register", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "register")]],
  ["POST", "/auth/register/verify", [methodGuard("POST"), "segments.length === 3", segmentGuard(0, "auth"), segmentGuard(1, "register"), segmentGuard(2, "verify")]],
  ["POST", "/auth/otp/challenges", [methodGuard("POST"), "segments.length === 3", segmentGuard(0, "auth"), segmentGuard(1, "otp"), segmentGuard(2, "challenges")]],
  ["GET", "/auth/mfa/methods", [methodGuard("GET"), "segments.length === 3", segmentGuard(0, "auth"), segmentGuard(1, "mfa"), segmentGuard(2, "methods")]],
  ["POST", "/auth/mfa/totp/enroll", [methodGuard("POST"), "segments.length === 4", segmentGuard(0, "auth"), segmentGuard(1, "mfa"), segmentGuard(2, "totp"), segmentGuard(3, "enroll")]],
  ["POST", "/auth/mfa/totp/confirm", [methodGuard("POST"), "segments.length === 4", segmentGuard(0, "auth"), segmentGuard(1, "mfa"), segmentGuard(2, "totp"), segmentGuard(3, "confirm")]],
  ["DELETE", "/auth/mfa/methods/{credentialId}", [methodGuard("DELETE"), "segments.length === 4", segmentGuard(0, "auth"), segmentGuard(1, "mfa"), segmentGuard(2, "methods")]],
  ["POST", "/auth/mfa/recover", [methodGuard("POST"), "segments.length === 3", segmentGuard(0, "auth"), segmentGuard(1, "mfa"), segmentGuard(2, "recover")]],
  ["POST", "/auth/mfa/recover/verify", [methodGuard("POST"), "segments.length === 4", segmentGuard(0, "auth"), segmentGuard(1, "mfa"), segmentGuard(2, "recover"), segmentGuard(3, "verify")]],
  ["POST", "/auth/mfa/recover/complete", [methodGuard("POST"), "segments.length === 4", segmentGuard(0, "auth"), segmentGuard(1, "mfa"), segmentGuard(2, "recover"), segmentGuard(3, "complete")]],
  ["POST", "/auth/mfa/recover/enroll", [methodGuard("POST"), "segments.length === 4", segmentGuard(0, "auth"), segmentGuard(1, "mfa"), segmentGuard(2, "recover"), segmentGuard(3, "enroll")]],
  ["POST", "/auth/challenges/{challengeId}/resend", [methodGuard("POST"), "segments.length === 4", segmentGuard(0, "auth"), segmentGuard(1, "challenges"), segmentGuard(3, "resend")]],
  ["POST", "/auth/login", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "login")]],
  ["POST", "/auth/verify", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "verify")]],
  ["POST", "/auth/refresh", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "refresh")]],
  ["POST", "/auth/logout", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "logout")]],
  ["POST", "/auth/logout-all", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "logout-all")]],
  ["GET", "/mobile/control-policy", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "mobile"), segmentGuard(1, "control-policy")]],
  ["GET", "/notifications", [methodGuard("GET"), "segments.length === 1", segmentGuard(0, "notifications")]],
  ["POST", "/notifications/{notificationId}/read", [methodGuard("POST"), "segments.length === 3", segmentGuard(0, "notifications"), segmentGuard(2, "read")]],
  ["GET", "/accounts", [methodGuard("GET"), "segments.length === 1", segmentGuard(0, "accounts")]],
  ["POST", "/internal-recipients/lookup", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "internal-recipients"), segmentGuard(1, "lookup")]],
  ["GET", "/accounts/{accountId}/number", [methodGuard("GET"), "segments.length === 3", segmentGuard(0, "accounts"), segmentGuard(2, "number")]],
  ["GET", "/accounts/{accountId}/transactions", [methodGuard("GET"), "segments.length === 3", segmentGuard(0, "accounts"), segmentGuard(2, "transactions")]],
  ["GET", "/accounts/{accountId}/transactions/{transactionId}", [methodGuard("GET"), "segments.length === 4", segmentGuard(0, "accounts"), segmentGuard(2, "transactions")]],
  ["GET", "/beneficiaries", [methodGuard("GET"), "segments.length === 1", segmentGuard(0, "beneficiaries")]],
  ["POST", "/beneficiaries", [methodGuard("POST"), "segments.length === 1", segmentGuard(0, "beneficiaries")]],
  ["PATCH", "/beneficiaries/{beneficiaryId}", [methodGuard("PATCH"), "segments.length === 2", segmentGuard(0, "beneficiaries")]],
  ["DELETE", "/beneficiaries/{beneficiaryId}", [methodGuard("DELETE"), "segments.length === 2", segmentGuard(0, "beneficiaries")]],
  ["GET", "/beneficiaries/{beneficiaryId}", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "beneficiaries")]],
  ["POST", "/transfers/quote", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "transfers"), segmentGuard(1, "quote")]],
  ["POST", "/transfers", [methodGuard("POST"), "segments.length === 1", segmentGuard(0, "transfers")]],
  ["GET", "/transfers/{transferId}", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "transfers")]],
  ["GET", "/savings/products", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "savings"), segmentGuard(1, "products")]],
  ["POST", "/savings/quotes", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "savings"), segmentGuard(1, "quotes")]],
  ["POST", "/savings/deposits", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "savings"), segmentGuard(1, "deposits")]],
  ["GET", "/savings/openings/{openingId}", [methodGuard("GET"), "segments.length === 3", segmentGuard(0, "savings"), segmentGuard(1, "openings")]],
  ["GET", "/savings/deposits", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "savings"), segmentGuard(1, "deposits")]],
  ["GET", "/savings/deposits/{depositId}", [methodGuard("GET"), "segments.length === 3", segmentGuard(0, "savings"), segmentGuard(1, "deposits")]],
  ["GET", "/cards", [methodGuard("GET"), "segments.length === 1", segmentGuard(0, "cards")]],
  ["GET", "/cards/{cardId}", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "cards")]],
  ["POST", "/cards/{cardId}/lock", [methodGuard("POST"), "segments.length === 3", segmentGuard(0, "cards"), segmentGuard(2, "lock")]],
  ["POST", "/cards/{cardId}/unlock", [methodGuard("POST"), "segments.length === 3", segmentGuard(0, "cards"), segmentGuard(2, "unlock")]],
  ["GET", "/credit/accounts", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "credit"), segmentGuard(1, "accounts")]],
  ["GET", "/credit/applications", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "credit"), segmentGuard(1, "applications")]],
  ["POST", "/credit/applications", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "credit"), segmentGuard(1, "applications")]],
  ["GET", "/credit/applications/{applicationId}", [methodGuard("GET"), "segments.length === 3", segmentGuard(0, "credit"), segmentGuard(1, "applications")]],
  ["POST", "/credit/applications/{applicationId}/activate", [methodGuard("POST"), "segments.length === 4", segmentGuard(0, "credit"), segmentGuard(1, "applications"), segmentGuard(3, "activate")]],
  ["GET", "/credit/accounts/{creditAccountId}", [methodGuard("GET"), "segments.length === 3", segmentGuard(0, "credit"), segmentGuard(1, "accounts")]],
  ["GET", "/credit/accounts/{creditAccountId}/transactions", [methodGuard("GET"), "segments.length === 4", segmentGuard(0, "credit"), segmentGuard(1, "accounts"), segmentGuard(3, "transactions")]],
  ["GET", "/credit/accounts/{creditAccountId}/statements", [methodGuard("GET"), "segments.length === 4", segmentGuard(0, "credit"), segmentGuard(1, "accounts"), segmentGuard(3, "statements")]],
  ["GET", "/credit/accounts/{creditAccountId}/statements/{statementId}", [methodGuard("GET"), "segments.length === 5", segmentGuard(0, "credit"), segmentGuard(1, "accounts"), segmentGuard(3, "statements")]],
  ["POST", "/credit/payment-quotes", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "credit"), segmentGuard(1, "payment-quotes")]],
  ["POST", "/credit/payments", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "credit"), segmentGuard(1, "payments")]],
  ["GET", "/credit/payments/{paymentId}", [methodGuard("GET"), "segments.length === 3", segmentGuard(0, "credit"), segmentGuard(1, "payments")]],
  ["GET", "/kyc/application", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "kyc"), segmentGuard(1, "application")]],
  ["POST", "/kyc/application", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "kyc"), segmentGuard(1, "application")]],
  ["POST", "/kyc/application/submit", [methodGuard("POST"), "segments.length === 3", segmentGuard(0, "kyc"), segmentGuard(1, "application"), segmentGuard(2, "submit")]],
];

for (const [method, routePath, fragments] of routeContracts) {
  const operation = document.paths?.[routePath]?.[method.toLowerCase()];
  if (!operation?.operationId) {
    throw new Error(`Missing OpenAPI operationId for ${method} ${routePath}.`);
  }
  const sourcePattern = fragments
    .map((fragment) => escapeRegExp(fragment))
    .join("[\\s\\S]{0,180}");
  if (!new RegExp(sourcePattern).test(backendHttp)) {
    throw new Error(
      `Reference backend exact route guard missing for ${method} ${routePath}.`,
    );
  }
}

const notificationSchema = document.components?.schemas?.Notification;
if (
  !notificationSchema?.required?.includes("resourceAccountId") ||
  !notificationSchema?.properties?.resourceAccountId
) {
  throw new Error(
    "Notification schema must require resourceAccountId for safe transaction deep links.",
  );
}

const submitTransfer = document.paths["/transfers"].post;
if (!submitTransfer.parameters?.some((parameter) => parameter.name === "Idempotency-Key" && parameter.required === true)) {
  throw new Error("POST /transfers must require Idempotency-Key.");
}
if (!submitTransfer.responses?.["200"] || !submitTransfer.responses?.["202"]) {
  throw new Error("POST /transfers must document synchronous and pending responses.");
}
const submitSavings = document.paths["/savings/deposits"].post;
if (!submitSavings.parameters?.some((parameter) => parameter.name === "Idempotency-Key" && parameter.required === true)) {
  throw new Error("POST /savings/deposits must require Idempotency-Key.");
}
if (!submitSavings.responses?.["200"] || !submitSavings.responses?.["202"]) {
  throw new Error("POST /savings/deposits must document synchronous and pending responses.");
}
const submitCreditPayment = document.paths["/credit/payments"].post;
if (!submitCreditPayment.parameters?.some((parameter) => parameter.name === "Idempotency-Key" && parameter.required === true)) {
  throw new Error("POST /credit/payments must require Idempotency-Key.");
}
if (!submitCreditPayment.responses?.["200"] || !submitCreditPayment.responses?.["202"]) {
  throw new Error("POST /credit/payments must document synchronous and pending responses.");
}
const registerResponses = document.paths["/auth/register"].post?.responses;
if (!registerResponses?.["202"] || registerResponses?.["201"] || registerResponses?.["200"]) {
  throw new Error("POST /auth/register must expose only the two-step challenge success response.");
}
const authChallengeSchema = document.components?.schemas?.AuthChallengeResponse;
if (!authChallengeSchema?.required?.includes("purpose")) {
  throw new Error("AuthChallengeResponse must require a bound purpose.");
}
const loginResponses = document.paths["/auth/login"].post?.responses;
if (!loginResponses?.["200"] || loginResponses?.["202"]) {
  throw new Error("POST /auth/login must document only the password session response.");
}
if (document.paths["/auth/refresh"].post?.responses?.["202"]) {
  throw new Error("POST /auth/refresh must not document a login MFA response.");
}
if (!document.components?.securitySchemes?.bearerAuth || document.components.securitySchemes.bearerAuth.type !== "http") {
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
  "POST /auth/register/cancel",
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
  const prefix = "#/components/parameters/";
  if (parameter?.$ref?.startsWith(prefix)) {
    return document.components?.parameters?.[parameter.$ref.slice(prefix.length)];
  }
  return parameter;
}

for (const [method, routePath] of [
  ["post", "/auth/register"],
  ["post", "/auth/register/verify"],
  ["post", "/auth/register/cancel"],
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

function requireResponses(method, routePath, statuses) {
  const responses = document.paths?.[routePath]?.[method]?.responses ?? {};
  for (const status of statuses) {
    if (!responses[status]) {
      throw new Error(
        `${method.toUpperCase()} ${routePath} must document HTTP ${status}.`,
      );
    }
  }
}

for (const routePath of [
  "/transfers",
  "/savings/deposits",
  "/credit/payments",
]) {
  requireResponses("post", routePath, ["401", "404", "409", "422", "429"]);
}
requireResponses("post", "/credit/applications", ["401", "409", "422", "429"]);
for (const routePath of [
  "/credit/applications/{applicationId}/activate",
  "/cards/{cardId}/unlock",
]) {
  requireResponses("post", routePath, ["401", "404", "409", "422", "429"]);
}
for (const routePath of [
  "/transfers/quote",
  "/savings/quotes",
  "/credit/payment-quotes",
]) {
  requireResponses("post", routePath, ["401", "404", "409", "422"]);
}
requireResponses("post", "/auth/register", ["409", "422", "429"]);
requireResponses("post", "/auth/register/verify", ["401", "409", "422", "429"]);
requireResponses("post", "/auth/otp/challenges", ["401", "422", "429"]);

function requireIdempotencyMinimum(routePath, minimum) {
  const operation = document.paths?.[routePath]?.post;
  const parameter = (operation?.parameters ?? [])
    .map(resolveParameter)
    .find(
      (candidate) =>
        candidate?.name === "Idempotency-Key" && candidate?.in === "header",
    );
  if (
    parameter?.required !== true ||
    parameter?.schema?.minLength !== minimum
  ) {
    throw new Error(
      `POST ${routePath} must require Idempotency-Key minLength ${minimum}.`,
    );
  }
}

for (const routePath of [
  "/transfers",
  "/savings/deposits",
  "/credit/payments",
]) {
  requireIdempotencyMinimum(routePath, 16);
}
for (const routePath of [
  "/credit/applications",
  "/credit/applications/{applicationId}/activate",
]) {
  requireIdempotencyMinimum(routePath, 8);
}

const conflictDescription = String(
  document.components?.responses?.Conflict?.description ?? "",
);
if (
  !conflictDescription.includes("STEP_UP_VERIFICATION_FAILED") ||
  !conflictDescription.includes("must not trigger token refresh/replay")
) {
  throw new Error(
    "HTTP 409 must distinguish financial step-up rejection from bearer-token HTTP 401.",
  );
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
  `OpenAPI draft valid: ${requiredPaths.length} required paths, ${routeContracts.length} exact method/segment guards, device binding, challenge-bound step-up, financial response/idempotency matrices, examples and notification target contract verified.`,
);
