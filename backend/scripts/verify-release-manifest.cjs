const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

function value(name, fallback = undefined) {
  const prefix = `--${name}`;
  const inline = process.argv.find((item) => item.startsWith(`${prefix}=`));
  if (inline) return inline.slice(prefix.length + 1).trim() || fallback;
  const index = process.argv.indexOf(prefix);
  return index >= 0 ? process.argv[index + 1]?.trim() || fallback : fallback;
}

const manifestPath = value("manifest", path.resolve(process.cwd(), "../release-manifest.json"));
const requireStaging = process.argv.includes("--require-staging");
const checkSource = process.argv.includes("--check-source");
const failures = [];
const SOLO_ACADEMIC_SCOPE = "academic-synthetic-virtual-money";
const VERIFICATION_MODES = new Set(["SOLO_ACADEMIC_OWNER", "INDEPENDENT_REVIEW"]);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`Unable to read release manifest: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const requireField = (condition, message) => {
  if (!condition) failures.push(message);
};
const digest = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/i.test(value);
const sha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);

requireField(typeof manifest.releaseId === "string" && manifest.releaseId.length > 0, "releaseId is missing");
requireField(typeof manifest.sourceCommit === "string" && /^[0-9a-f]{40}$/i.test(manifest.sourceCommit), "sourceCommit must be a full Git SHA");
requireField(manifest.sourceTree === "clean", "sourceTree must be clean");
requireField(digest(manifest.image?.digest), "backend image digest must be a sha256 manifest digest");
requireField(manifest.image?.signatureVerified === true, "backend image signature was not verified");
requireField(manifest.image?.attestations?.sbom === true, "SBOM attestation was not verified");
requireField(manifest.image?.attestations?.provenance === true, "provenance attestation was not verified");
requireField(typeof manifest.database?.migrationSetDigest === "string" && /^[0-9a-f]{64}$/.test(manifest.database.migrationSetDigest), "migrationSetDigest is invalid");
requireField(typeof manifest.contracts?.openapiDigest === "string" && digest(manifest.contracts.openapiDigest), "openapiDigest is invalid");

if (manifest.artifacts?.adminWeb !== null && manifest.artifacts?.adminWeb !== undefined) {
  requireField(typeof manifest.artifacts.adminWeb.reference === "string" && manifest.artifacts.adminWeb.reference.length > 0, "Admin Web image reference is invalid");
  requireField(digest(manifest.artifacts.adminWeb.digest), "Admin Web image digest is invalid");
  requireField(manifest.artifacts.adminWeb.signatureVerified === true, "Admin Web image signature was not verified");
  requireField(manifest.artifacts.adminWeb.attestations?.sbom === true, "Admin Web SBOM attestation was not verified");
  requireField(manifest.artifacts.adminWeb.attestations?.provenance === true, "Admin Web provenance attestation was not verified");
}
if (manifest.artifacts?.mobileApk !== null && manifest.artifacts?.mobileApk !== undefined) {
  requireField(sha256(manifest.artifacts.mobileApk.sha256), "Mobile APK SHA-256 is invalid");
}

if (checkSource) {
  const root = path.resolve(__dirname, "../..");
  const checkedOutCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1"], { cwd: root, encoding: "utf8" }).trim();
  requireField(checkedOutCommit.toLowerCase() === String(manifest.sourceCommit).toLowerCase(), "manifest sourceCommit does not match checked-out commit");
  requireField(status.length === 0, "worktree must be clean when validating a release manifest");
}

if (requireStaging) {
  const staging = manifest.promotion?.staging;
  requireField(staging && typeof staging === "object", "staging promotion evidence is missing");
  requireField(staging?.status === "STAGING VERIFIED", "staging evidence is not marked STAGING VERIFIED");
  requireField(typeof staging?.verifiedAt === "string" && staging.verifiedAt.length > 0, "staging verifiedAt is missing");
  requireField(typeof staging?.healthEvidence === "string" && staging.healthEvidence.length > 0, "staging health evidence is missing");
  requireField(typeof staging?.versionEvidence === "string" && staging.versionEvidence.length > 0, "staging version evidence is missing");
  requireField(typeof staging?.verificationMode === "string" && VERIFICATION_MODES.has(staging.verificationMode), "staging verificationMode must be SOLO_ACADEMIC_OWNER or INDEPENDENT_REVIEW");
  requireField(typeof staging?.verifiedBy === "string" && staging.verifiedBy.length > 0, "staging verifiedBy is missing");
  requireField(typeof staging?.independentReview === "boolean", "staging independentReview must be boolean");
  requireField(typeof staging?.scope === "string" && staging.scope.length > 0, "staging scope is missing");

  const productionLikePromotion = manifest.promotion?.productionLike !== null && manifest.promotion?.productionLike !== undefined;
  const productionLikeStaging = staging?.environment === "production-like" || staging?.targetEnvironment === "production-like";
  if (staging?.verificationMode === "SOLO_ACADEMIC_OWNER") {
    requireField(!productionLikePromotion && !productionLikeStaging, "SOLO_ACADEMIC_OWNER cannot verify a production-like promotion");
    requireField(staging.verifiedBy === "repository-owner", "SOLO_ACADEMIC_OWNER must be verifiedBy repository-owner");
    requireField(staging.independentReview === false, "SOLO_ACADEMIC_OWNER must declare independentReview=false");
    requireField(staging.scope === SOLO_ACADEMIC_SCOPE, `SOLO_ACADEMIC_OWNER requires scope=${SOLO_ACADEMIC_SCOPE}`);
    requireField(staging.reviewer === undefined || staging.reviewer === null || staging.reviewer === "", "SOLO_ACADEMIC_OWNER must not declare an independent reviewer");
  } else if (staging?.verificationMode === "INDEPENDENT_REVIEW") {
    requireField(staging.independentReview === true, "INDEPENDENT_REVIEW must declare independentReview=true");
    requireField(typeof staging.reviewer === "string" && staging.reviewer.length > 0, "independent staging reviewer is missing");
  }
  requireField(manifest.artifacts?.adminWeb?.digest && manifest.artifacts?.mobileApk?.sha256, "Admin Web digest and mobile APK checksum are required for staging");
}

if (failures.length > 0) {
  console.error(JSON.stringify({ valid: false, manifest: manifestPath, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ valid: true, manifest: manifestPath, releaseId: manifest.releaseId, sourceCommit: manifest.sourceCommit, imageDigest: manifest.image.digest, stagingRequired: requireStaging }, null, 2));
}
