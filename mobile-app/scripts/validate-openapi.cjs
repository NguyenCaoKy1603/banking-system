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
  "/auth/login",
  "/auth/verify",
  "/auth/refresh",
  "/auth/logout",
  "/auth/logout-all",
  "/mobile/control-policy",
  "/notifications",
  "/notifications/{notificationId}/read",
  "/fraud-reports",
  "/accounts",
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
  "/credit/accounts/{creditAccountId}",
  "/credit/accounts/{creditAccountId}/transactions",
  "/credit/accounts/{creditAccountId}/statements",
  "/credit/accounts/{creditAccountId}/statements/{statementId}",
  "/credit/payment-quotes",
  "/credit/payments",
  "/credit/payments/{paymentId}",
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
  'segments[0] === "transfers"',
  'segments[0] === "savings"',
  'segments[0] === "cards"',
  'segments[0] === "credit"',
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
if (!loginResponses?.["200"] || !loginResponses?.["202"]) {
  throw new Error("POST /auth/login must document both session and MFA responses.");
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

const securitySchemes = document.components?.securitySchemes;
if (securitySchemes?.bearerAuth?.type !== "http") {
  throw new Error("The contract must define bearerAuth.");
}

if (document.components?.parameters?.DeviceId?.name !== "X-Device-ID") {
  throw new Error("The contract must define X-Device-ID device binding.");
}

console.log(
  `OpenAPI draft valid: ${requiredPaths.length} required paths, examples and reference route markers included.`,
);
