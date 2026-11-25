const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readAllSrc(dir) {
  let content = "";
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      content += "\n" + readAllSrc(full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      content += "\n" + fs.readFileSync(full, "utf8");
    }
  }
  return content;
}

const app = readAllSrc(path.join(__dirname, "..", "src"));
const api = fs.readFileSync(new URL("../src/api.ts", `file://${__dirname}/`), "utf8");
const vite = fs.readFileSync(path.join(__dirname, "..", "vite.config.ts"), "utf8");
const dockerfile = fs.readFileSync(path.join(__dirname, "..", "Dockerfile"), "utf8");
const nginxTemplate = fs.readFileSync(path.join(__dirname, "..", "nginx.conf.template"), "utf8");
const runtimeScript = fs.readFileSync(path.join(__dirname, "..", "docker-entrypoint.d", "10-validate-runtime-config.sh"), "utf8");

test("Admin Web exposes the P0 control-plane areas", () => {
  for (const label of ["Hồ sơ định danh", "Giao dịch chuyển tiền", "Outbox / Jobs", "Chính sách & Biểu phí", "Staff / Roles", "Audit Explorer"]) {
    assert.match(app, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const marker of [
    "funding-requests",
    "access-lock-requests",
    "review-recommendations",
    "audit-export-requests",
    "requeue-requests",
    "retry-requests",
    "role-change-requests",
    "disable-requests",
    "/admin/control-policy",
    "/admin/operations/ledger-reconciliation",
  ]) {
    assert.match(app, new RegExp(marker));
  }
});

test("Admin Web keeps staff tokens out of browser storage", () => {
  assert.doesNotMatch(app, /localStorage|sessionStorage/);
  assert.doesNotMatch(api, /localStorage|sessionStorage/);
  assert.match(api, /credentials:\s*["']include["']/);
  assert.match(api, /X-CSRF-Token/);
});

test("Admin Web exposes one-time staff activation without persisting the invite token", () => {
  assert.match(app, /\/admin\/activate/);
  assert.match(app, /inviteToken/);
  assert.match(app, /history\.replaceState/);
  assert.match(app, /mfa-setup-secret/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);
});

test("Approval submit includes the mandatory approval comment", () => {
  assert.match(app, /decision:\s*["']APPROVED["'][\s\S]*comment:\s*reason\.trim\(\)/);
  assert.match(app, /\/reject/);
  assert.match(app, /data-testid=\"step-up-mfa\"/);
  assert.doesNotMatch(app, /window\.prompt/);
});

test("Audit Explorer is gated by the staff approval permission", () => {
  assert.match(app, /canReadApprovals/);
  assert.match(app, /audit\.read/);
  assert.match(app, /target === ["']audit["'][\s\S]*canReadApprovals/);
  assert.match(app, /key:\s*["']audit["'][\s\S]*visible:\s*canReadApprovals/);
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

test("Nginx forwards the upstream Host and preserves the browser host", () => {
  assert.equal((nginxTemplate.match(/proxy_set_header Host \$proxy_host;/g) ?? []).length, 2);
  assert.equal((nginxTemplate.match(/proxy_set_header X-Forwarded-Host \$host;/g) ?? []).length, 2);
  assert.doesNotMatch(nginxTemplate, /proxy_set_header Host \$host;/);
  assert.equal((nginxTemplate.match(/proxy_ssl_server_name on;/g) ?? []).length, 2);

  for (const location of ["location = /readyz", "location /api/"]) {
    const start = nginxTemplate.indexOf(location);
    assert.notEqual(start, -1, `${location} must exist`);
    const end = nginxTemplate.indexOf("\n  }", start);
    const block = nginxTemplate.slice(start, end === -1 ? undefined : end);
    assert.match(block, /proxy_set_header Host \$proxy_host;/);
    assert.match(block, /proxy_set_header X-Forwarded-Host \$host;/);
    assert.match(block, /proxy_ssl_server_name on;/);
  }

  assert.match(nginxTemplate, /connect-src 'self'/);
});
