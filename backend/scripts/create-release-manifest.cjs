const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { readFileSync, readdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

function arg(name, fallback = undefined) {
  const prefix = `--${name}`;
  const inline = process.argv.find((value) => value.startsWith(`${prefix}=`));
  if (inline) return inline.slice(prefix.length + 1).trim();
  const index = process.argv.indexOf(prefix);
  return index >= 0 ? process.argv[index + 1]?.trim() || fallback : fallback;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", cwd: path.resolve(__dirname, "../..") }).trim();
}

const root = path.resolve(__dirname, "../..");
const sourceCommit = arg("source-commit", git("rev-parse", "HEAD"));
const imageDigest = arg("image-digest");
const imageReference = arg("image");
const adminImageDigest = arg("admin-image-digest", null);
const adminImageReference = arg("admin-image", null);
const adminSignatureVerified = arg("admin-signature-verified", "false") === "true";
const adminSbomPresent = arg("admin-sbom-present", "false") === "true";
const adminProvenancePresent = arg("admin-provenance-present", "false") === "true";
const apkSha256 = arg("apk-sha256", null);
const apkArtifact = arg("apk-artifact", null);
const releaseId = arg("release-id");
const output = arg("output", path.join(root, "release-manifest.json"));
const signatureVerified = arg("signature-verified", "false") === "true";
const sbomDigest = arg("sbom-digest", null);
const provenanceDigest = arg("provenance-digest", null);
const sbomPresent = sbomDigest !== null || arg("sbom-present", "false") === "true";
const provenancePresent = provenanceDigest !== null || arg("provenance-present", "false") === "true";
if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) throw new Error("source-commit must be a full 40-character SHA.");
const checkedOutCommit = git("rev-parse", "HEAD");
if (checkedOutCommit.toLowerCase() !== sourceCommit.toLowerCase()) throw new Error("source-commit does not match the checked-out commit.");
if (git("status", "--porcelain=v1")) throw new Error("release manifest requires a clean source tree; run release:gate first.");
if (!/^sha256:[0-9a-f]{64}$/i.test(imageDigest ?? "")) throw new Error("image-digest must be a manifest sha256 digest.");
if (!imageReference?.trim()) throw new Error("image reference is required.");
if ((adminImageReference && !adminImageDigest) || (!adminImageReference && adminImageDigest)) {
  throw new Error("admin-image and admin-image-digest must be supplied together.");
}
if (adminImageDigest && !/^sha256:[0-9a-f]{64}$/i.test(adminImageDigest)) throw new Error("admin-image-digest must be a manifest sha256 digest.");
if (adminImageReference && (!adminSignatureVerified || !adminSbomPresent || !adminProvenancePresent)) {
  throw new Error("Admin Web image requires verified signature, SBOM and provenance flags.");
}
if (apkSha256 && !/^[0-9a-f]{64}$/i.test(apkSha256)) throw new Error("apk-sha256 must be a 64-character SHA-256 hex digest.");
if (!releaseId?.trim()) throw new Error("release-id is required.");

const migrationDirectory = path.join(root, "backend", "database");
const files = readdirSync(migrationDirectory)
  .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
const migrationHash = createHash("sha256");
for (const fileName of files) migrationHash.update(`${fileName}\0${readFileSync(path.join(migrationDirectory, fileName))}\0`);
const openApiPath = path.join(root, "documents", "api", "banking-mvp.openapi.yaml");
const openApiDigest = createHash("sha256").update(readFileSync(openApiPath)).digest("hex");
const firstMigration = files[0]?.replace(/\.sql$/i, "") ?? null;
const lastMigration = files.at(-1)?.replace(/\.sql$/i, "") ?? null;
const manifest = {
  releaseId,
  sourceCommit,
  sourceTree: "clean",
  image: {
    reference: imageReference,
    digest: imageDigest,
    signatureVerified,
    sbomDigest,
    provenanceDigest,
    attestations: {
      sbom: sbomPresent,
      provenance: provenancePresent,
    },
  },
  artifacts: {
    adminWeb: adminImageReference && adminImageDigest
      ? {
          reference: adminImageReference,
          digest: adminImageDigest,
          signatureVerified: adminSignatureVerified,
          attestations: { sbom: adminSbomPresent, provenance: adminProvenancePresent },
        }
      : null,
    mobileApk: apkSha256
      ? { artifact: apkArtifact, sha256: apkSha256 }
      : null,
  },
  database: {
    firstMigration,
    lastMigration,
    migrationSetDigest: migrationHash.digest("hex"),
    minimumCompatibleSchema: Number(lastMigration?.match(/^(\d+)_/)?.[1] ?? 0),
    maximumCompatibleSchema: Number(lastMigration?.match(/^(\d+)_/)?.[1] ?? 0),
  },
  contracts: {
    openapiDigest: `sha256:${openApiDigest}`,
    configSchemaVersion: "2",
  },
  build: {
    workflowRunId: arg("workflow-run-id", null),
    ciRunId: arg("ci-run-id", arg("workflow-run-id", null)),
    builtAt: arg("built-at", new Date().toISOString()),
    builder: arg("builder", "github-actions"),
  },
  promotion: { staging: null, productionLike: null },
  rollbackTargetDigest: arg("rollback-target-digest", null),
};
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "w" });
console.log(JSON.stringify({ output, releaseId, sourceCommit, imageDigest, adminImageDigest, apkSha256, migrationSetDigest: manifest.database.migrationSetDigest }, null, 2));
