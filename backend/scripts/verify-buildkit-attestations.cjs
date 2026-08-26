#!/usr/bin/env node

"use strict";

const fs = require("node:fs");

// Buildx stores its provenance and SBOM as native OCI attestation metadata.
// Cosign image signatures are verified separately; this script verifies the
// registry metadata attached to the exact image manifest digest.

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}`);
  }
  return process.argv[index + 1];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const image = readArg("--image");
const manifestPath = readArg("--manifest");
const provenancePath = readArg("--provenance");
const sbomPath = readArg("--sbom");
const expectedDigest = readArg("--digest");
const provenanceOutput = readArg("--provenance-output");
const sbomOutput = readArg("--sbom-output");

if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) {
  throw new Error(`Expected an OCI sha256 digest, received ${expectedDigest}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!isRecord(manifest) || manifest.digest !== expectedDigest) {
  throw new Error(
    `Registry manifest digest mismatch: expected ${expectedDigest}, received ${manifest?.digest ?? "missing"}`,
  );
}

const descriptors = Array.isArray(manifest.manifests) ? manifest.manifests : [];
const hasAttestationDescriptor = descriptors.some(
  (descriptor) => descriptor?.annotations?.["vnd.docker.reference.type"] === "attestation-manifest",
);
if (!hasAttestationDescriptor) {
  throw new Error("Registry manifest does not expose a BuildKit attestation descriptor");
}

const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
const slsa = provenance?.SLSA;
if (!isRecord(slsa)) {
  throw new Error("BuildKit provenance attestation is missing");
}
const buildType = slsa.buildType ?? slsa.buildDefinition?.buildType;
if (typeof buildType !== "string" || buildType.length === 0) {
  throw new Error("BuildKit provenance does not contain a build type");
}

const sbom = JSON.parse(fs.readFileSync(sbomPath, "utf8"));
const spdx = sbom?.SPDX;
if (!isRecord(spdx) || typeof spdx.spdxVersion !== "string" || spdx.spdxVersion.length === 0) {
  throw new Error("BuildKit SPDX SBOM attestation is missing");
}

writeJson(provenanceOutput, {
  image,
  digest: manifest.digest,
  provenance,
});
writeJson(sbomOutput, {
  image,
  digest: manifest.digest,
  sbom,
});

console.log(`BuildKit attestations verified for ${image}@${manifest.digest}`);
