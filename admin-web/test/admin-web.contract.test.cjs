const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(new URL("../src/App.tsx", `file://${__dirname}/`), "utf8");
const api = fs.readFileSync(new URL("../src/api.ts", `file://${__dirname}/`), "utf8");
const vite = fs.readFileSync(path.join(__dirname, "..", "vite.config.ts"), "utf8");
const dockerfile = fs.readFileSync(path.join(__dirname, "..", "Dockerfile"), "utf8");
const nginxTemplate = fs.readFileSync(path.join(__dirname, "..", "nginx.conf.template"), "utf8");
const runtimeScript = fs.readFileSync(path.join(__dirname, "..", "docker-entrypoint.d", "10-validate-runtime-config.sh"), "utf8");

test("Admin Web exposes the P0 control-plane areas", () => {
  for (const label of ["Approval Inbox", "KYC / Credit", "Giao dịch chờ", "Fraud cases", "Outbox / Jobs", "Staff / Roles", "Audit explorer"]) assert.match(app, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const marker of ["funding-requests", "access-lock-requests", "review-recommendations", "resolution-requests", "requeue-requests", "retry-requests", "role-change-requests", "disable-requests"]) assert.match(app, new RegExp(marker));
});

test("Admin Web keeps staff tokens out of browser storage", () => {
  assert.doesNotMatch(api, /localStorage|sessionStorage/);
  assert.match(api, /credentials:\s*["']include["']/);
  assert.match(api, /X-CSRF-Token/);
});

test("Approval submit includes the mandatory checker comment", () => {
  assert.match(app, /decision:\s*["']APPROVED["'][\s\S]*comment:\s*reason\.trim\(\)/);
  assert.match(app, /\/reject/);
  assert.match(app, /data-testid=\"step-up-mfa\"/);
  assert.doesNotMatch(app, /window\.prompt/);
});

test("Admin Web uses a same-origin API and runtime-only upstream", () => {
  assert.match(api, /const API_BASE = ["']\/api\/v1["']/);
  assert.doesNotMatch(api, /import\.meta\.env|ADMIN_API_URL|127\.0\.0\.1:5001|localhost:5001/);
  assert.match(vite, /ADMIN_API_UPSTREAM/);
  assert.match(vite, /["']\/api["']/);
  assert.doesNotMatch(vite, /ADMIN_API_URL/);
  assert.doesNotMatch(dockerfile, /ADMIN_API_URL/);
  assert.match(dockerfile, /nginx\.conf\.template/);
  assert.match(dockerfile, /10-validate-runtime-config\.sh/);
  assert.match(nginxTemplate, /connect-src 'self'/);
  assert.doesNotMatch(nginxTemplate, /127\.0\.0\.1:5001|localhost:5001|staging\.example/);
  assert.match(nginxTemplate, /proxy_pass __ADMIN_API_UPSTREAM__/);
  assert.match(nginxTemplate, /location = \/readyz/);
  assert.match(runtimeScript, /ADMIN_WEB_ENV/);
  assert.match(runtimeScript, /ADMIN_API_UPSTREAM/);
  assert.match(runtimeScript, /staging:http\|production-like:http/);
  assert.match(runtimeScript, /nginx -t/);
});
