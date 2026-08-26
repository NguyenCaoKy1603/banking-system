#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const workflowPath = path.join(root, ".github", "workflows", "container-release.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");
const releaseStart = workflow.indexOf("\n  release:\n");
const release = releaseStart === -1 ? "" : workflow.slice(releaseStart);
const topPermissionsStart = workflow.indexOf("\npermissions:\n");
const topPermissionsEnd = workflow.indexOf("\nconcurrency:", topPermissionsStart);
const topPermissions = workflow.slice(topPermissionsStart, topPermissionsEnd === -1 ? undefined : topPermissionsEnd);
const failures = [];

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

function requireAbsent(source, pattern, message) {
  if (pattern.test(source)) failures.push(message);
}

requireMatch(
  workflow,
  /on:\s*\n\s+push:\s*\n\s+tags:\s*\n\s+-\s+["']v1\.0\.0-thesis-rc\.\*["']/,
  "container-release must trigger push only for v1.0.0-thesis-rc.* tags",
);
requireAbsent(workflow, /branches:\s*\[main\]/, "container-release must not trigger on main pushes");
requireMatch(workflow, /workflow_dispatch:/, "manual workflow dispatch must remain available");
requireMatch(release, /if:\s*github\.event_name\s*==\s*['"]push['"]\s*&&\s*startsWith\(github\.ref,\s*['"]refs\/tags\/v1\.0\.0-thesis-rc\./, "publish job must be limited to pushed RC tags");
requireMatch(release, /RELEASE_ID:\s*\$\{\{\s*github\.ref_name\s*\}\}/, "release ID must be the tag name");
requireAbsent(release, /format\(\s*['"]release-/, "temporary release ID fallback must be removed");
requireMatch(release, /git fetch --no-tags origin main/, "publish job must fetch main before building");
requireMatch(release, /git rev-parse HEAD/, "publish job must normalize the checked-out source commit");
requireMatch(release, /git rev-parse origin\/main/, "publish job must compare the tag commit with main");
requireMatch(release, /git show -s --format=%cI HEAD/, "publish job must derive build time from the source commit");
requireMatch(release, /SOURCE_COMMIT=%s/, "normalized source commit must be exported to later steps");
requireMatch(release, /BUILD_CREATED_AT=%s/, "normalized build time must be exported to later steps");
requireMatch(
  release,
  /Set up Node\.js[\s\S]*Install release dependencies[\s\S]*run: npm ci[\s\S]*Scan repository and Git history for high-confidence secrets/,
  "publish job must install backend dev dependencies before secret-registry validation",
);
requireAbsent(release, /github\.event\.head_commit\.timestamp/, "publish metadata must not use push-event timestamps");
requireMatch(release, /:sha-\$\{\{\s*steps\.release_meta\.outputs\.source_commit\s*\}\}/g, "backend image must use the normalized source SHA tag");
requireMatch(release, /ADMIN_IMAGE_NAME }}:sha-\$\{\{\s*steps\.release_meta\.outputs\.source_commit\s*\}\}/g, "Admin image must use the normalized source SHA tag");
requireMatch(release, /Reject an existing release tag before publishing/, "release tag immutability check must be present");
requireMatch(release, /docker manifest inspect/, "release tag immutability must be checked in the registry");
requireMatch(release, /admin-web\/scripts\/verify-runtime-proxy\.cjs/, "release must use the shared runtime proxy fixture");
requireAbsent(release, /refs\/\(heads\/main\|tags\//, "Cosign identity must not allow the old main-branch workflow");
requireMatch(release, /COSIGN_IDENTITY:[^\n]*refs\/tags\/v1\\[.]0\\[.]0-thesis-rc/, "Cosign identity must be bound to RC tags");
requireMatch(topPermissions, /permissions:\s*\n\s+contents:\s*read\s*\n/, "quality jobs must have read-only default permissions");
requireAbsent(topPermissions, /packages:\s*write|id-token:\s*write/, "write/OIDC permissions must not be global");
requireMatch(release, /permissions:\s*\n\s+contents:\s*read\s*\n\s+packages:\s*write\s*\n\s+id-token:\s*write/, "publish job must explicitly request package/OIDC permissions");

if (failures.length > 0) {
  console.error("container-release workflow contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("container-release workflow contract: PASS");
