const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync(new URL("../src/App.tsx", `file://${__dirname}/`), "utf8");
const api = fs.readFileSync(new URL("../src/api.ts", `file://${__dirname}/`), "utf8");

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
