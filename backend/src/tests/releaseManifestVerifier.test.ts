import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const backendRoot = path.resolve(import.meta.dirname, "../..");
const verifier = path.join(backendRoot, "scripts", "verify-release-manifest.cjs");

const baseManifest = () => ({
  releaseId: "v1.0.0-thesis-test",
  sourceCommit: "b".repeat(40),
  sourceTree: "clean",
  image: {
    reference: "ghcr.io/example/backend",
    digest: `sha256:${"1".repeat(64)}`,
    signatureVerified: true,
    attestations: { sbom: true, provenance: true },
  },
  artifacts: {
    adminWeb: {
      reference: "ghcr.io/example/admin-web",
      digest: `sha256:${"2".repeat(64)}`,
      signatureVerified: true,
      attestations: { sbom: true, provenance: true },
    },
    mobileApk: { sha256: "3".repeat(64) },
  },
  database: { migrationSetDigest: "4".repeat(64), minimumCompatibleSchema: 32, maximumCompatibleSchema: 32 },
  contracts: { openapiDigest: `sha256:${"5".repeat(64)}`, configSchemaVersion: "2" },
  build: { builtAt: "2026-08-26T00:00:00.000Z", builder: "test" },
  promotion: {
    staging: {
      status: "STAGING VERIFIED",
      verifiedAt: "2026-08-26T00:00:00.000Z",
      healthEvidence: "health.json",
      versionEvidence: "version.json",
      verificationMode: "SOLO_ACADEMIC_OWNER",
      verifiedBy: "repository-owner",
      independentReview: false,
      scope: "academic-synthetic-virtual-money",
    },
    productionLike: null,
  },
});

function runVerifier(manifest: Record<string, unknown>): { status: number; output: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "release-manifest-verifier-"));
  const manifestPath = path.join(directory, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  try {
    try {
      const output = execFileSync(process.execPath, [verifier, "--manifest", manifestPath, "--require-staging"], { encoding: "utf8", cwd: backendRoot, stdio: ["ignore", "pipe", "pipe"] });
      return { status: 0, output };
    } catch (error) {
      const result = error as { status?: number; stdout?: string; stderr?: string };
      return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("solo academic owner verification passes without an independent reviewer", () => {
  const result = runVerifier(baseManifest());
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /"valid": true/);
});

test("solo academic verification requires an owner attestation", () => {
  const manifest = baseManifest();
  (manifest.promotion as Record<string, unknown>).staging = {
    ...(manifest.promotion as Record<string, unknown>).staging as Record<string, unknown>,
    verifiedBy: "",
  };
  const result = runVerifier(manifest);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /staging verifiedBy is missing/);
});

test("solo academic verification requires synthetic virtual money scope", () => {
  const manifest = baseManifest();
  (manifest.promotion as Record<string, unknown>).staging = {
    ...(manifest.promotion as Record<string, unknown>).staging as Record<string, unknown>,
    scope: "academic-real-money",
  };
  const result = runVerifier(manifest);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /requires scope=academic-synthetic-virtual-money/);
});

test("solo mode is rejected for production-like promotion", () => {
  const manifest = baseManifest();
  (manifest.promotion as Record<string, unknown>).productionLike = { status: "RELEASED" };
  const result = runVerifier(manifest);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /cannot verify a production-like promotion/);
});

test("a false independent-review claim is rejected", () => {
  const manifest = baseManifest();
  (manifest.promotion as Record<string, unknown>).staging = {
    ...(manifest.promotion as Record<string, unknown>).staging as Record<string, unknown>,
    verificationMode: "INDEPENDENT_REVIEW",
    independentReview: false,
    reviewer: "someone",
  };
  const result = runVerifier(manifest);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /INDEPENDENT_REVIEW must declare independentReview=true/);
});
