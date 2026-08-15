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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const methodGuard = (method) => `request.method === "${method}"`;
const segmentGuard = (index, value) => `segments[${index}] === "${value}"`;

const routeContracts = [
  ["POST", "/auth/register", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "register")]],
  ["POST", "/auth/login", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "login")]],
  ["POST", "/auth/verify", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "verify")]],
  ["POST", "/auth/refresh", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "refresh")]],
  ["POST", "/auth/logout", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "logout")]],
  ["POST", "/auth/logout-all", [methodGuard("POST"), "segments.length === 2", segmentGuard(0, "auth"), segmentGuard(1, "logout-all")]],
  ["GET", "/mobile/control-policy", [methodGuard("GET"), "segments.length === 2", segmentGuard(0, "mobile"), segmentGuard(1, "control-policy")]],
  ["GET", "/notifications", [methodGuard("GET"), "segments.length === 1", segmentGuard(0, "notifications")]],
  ["POST", "/notifications/{notificationId}/read", [methodGuard("POST"), "segments.length === 3", segmentGuard(0, "notifications"), segmentGuard(2, "read")]],
  ["POST", "/fraud-reports", [methodGuard("POST"), "segments.length === 1", segmentGuard(0, "fraud-reports")]],
  ["GET", "/accounts", [methodGuard("GET"), "segments.length === 1", segmentGuard(0, "accounts")]],
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

console.log(
  `OpenAPI draft valid: ${requiredPaths.length} required paths, ${routeContracts.length} exact method/segment guards, examples and notification target contract verified.`,
);
