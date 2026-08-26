const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const file = path.resolve(__dirname, "../../documents/api/admin.openapi.yaml");
const source = fs.readFileSync(file, "utf8");
const document = YAML.parse(source);
if (!/DRAFT/i.test(String(document?.info?.description ?? ""))) throw new Error("Admin OpenAPI must remain explicitly marked DRAFT.");
const paths = document?.paths ?? {};
const entries = [];
const operationIds = new Set();
for (const [route, operations] of Object.entries(paths)) {
  if (!route.startsWith("/admin/")) throw new Error(`Admin OpenAPI route outside /admin namespace: ${route}`);
  for (const [method, operation] of Object.entries(operations)) {
    if (!['get','post','delete'].includes(method)) continue;
    if (!operation || typeof operation !== 'object' || typeof operation.operationId !== 'string') throw new Error(`Admin route ${method.toUpperCase()} ${route} needs operationId.`);
    if (operationIds.has(operation.operationId)) throw new Error(`Duplicate Admin operationId ${operation.operationId}.`);
    operationIds.add(operation.operationId); entries.push(`${method.toUpperCase()} ${route}`);
  }
}
if (entries.length < 20) throw new Error("Admin OpenAPI contract is unexpectedly small.");
if (/password\s*:\s*[^<{\s]|totp(secret|_secret)?\s*:\s*[^<{\s]|token\s*:\s*[^<{\s]/i.test(source)) throw new Error("Admin OpenAPI must not contain secret examples.");
console.log(`Admin OpenAPI valid: ${entries.length} routes, ${operationIds.size} operationIds, DRAFT marker present.`);
