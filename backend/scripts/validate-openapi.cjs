const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("yaml");

const contractPath = path.resolve(__dirname, "../../documents/api/banking-mvp.openapi.yaml");
const backendHttpPath = path.resolve(__dirname, "../src/http.ts");
const document = parse(fs.readFileSync(contractPath, "utf8"));
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
  "/accounts/{accountId}/transactions",
  "/accounts/{accountId}/transactions/{transactionId}",
  "/beneficiaries",
  "/beneficiaries/{beneficiaryId}",
  "/transfers/quote",
  "/transfers",
  "/transfers/{transferId}",
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
]) {
  if (!document.components?.schemas?.[schemaName]?.example) {
    throw new Error(`Missing non-secret example for schema: ${schemaName}`);
  }
}

for (const marker of [
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
]) {
  if (!backendHttp.includes(marker)) {
    throw new Error(`Reference backend route marker missing: ${marker}`);
  }
}

const submitTransfer = document.paths["/transfers"].post;
if (!submitTransfer.parameters?.some((parameter) => parameter.name === "Idempotency-Key" && parameter.required === true)) {
  throw new Error("POST /transfers must require Idempotency-Key.");
}
if (!submitTransfer.responses?.["200"] || !submitTransfer.responses?.["202"]) {
  throw new Error("POST /transfers must document synchronous and pending responses.");
}
const loginResponses = document.paths["/auth/login"].post?.responses;
if (!loginResponses?.["200"] || !loginResponses?.["202"]) {
  throw new Error("POST /auth/login must document both session and MFA responses.");
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

console.log(`OpenAPI draft valid: ${requiredPaths.length} required paths, examples and reference route markers included.`);
