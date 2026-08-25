import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type RuntimeMetadata = {
  service: string;
  releaseId: string;
  commitSha: string;
  imageDigest: string;
  environment: string;
  moneyMode: string;
  schemaVersion: string;
  migrationSetDigest: string;
  apiContractDigest: string;
  builtAt: string | null;
  startedAt: string;
};

const startedAt = new Date().toISOString();

function migrationFiles(directory = process.env.MIGRATION_DIRECTORY ?? path.resolve(process.cwd(), "database")): string[] {
  try {
    return readdirSync(directory)
      .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
      .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  } catch {
    return [];
  }
}

function canonicalMigrationSql(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function migrationSetDigest(directory?: string): { digest: string; schemaVersion: string } {
  const resolvedDirectory = directory ?? process.env.MIGRATION_DIRECTORY ?? path.resolve(process.cwd(), "database");
  const files = migrationFiles(resolvedDirectory);
  const hash = createHash("sha256");
  for (const fileName of files) {
    hash.update(fileName);
    hash.update("\0");
    hash.update(canonicalMigrationSql(readFileSync(path.join(resolvedDirectory, fileName), "utf8")), "utf8");
    hash.update("\0");
  }
  const lastKey = files.at(-1)?.match(/^(\d+)_/)?.[1];
  const configuredDigest = process.env.MIGRATION_SET_DIGEST?.trim();
  return {
    digest: configuredDigest && configuredDigest !== "unknown" ? configuredDigest : hash.digest("hex"),
    schemaVersion: process.env.SCHEMA_VERSION?.trim() && process.env.SCHEMA_VERSION?.trim() !== "unknown"
      ? process.env.SCHEMA_VERSION.trim()
      : lastKey?.padStart(3, "0") || "unknown",
  };
}

export function runtimeMetadata(overrides: Partial<RuntimeMetadata> = {}): RuntimeMetadata {
  const migration = migrationSetDigest();
  return {
    service: "banking-reference-backend",
    releaseId: process.env.RELEASE_ID?.trim() || "local",
    commitSha: process.env.BUILD_COMMIT_SHA?.trim() || "local",
    imageDigest: process.env.IMAGE_DIGEST?.trim() && process.env.IMAGE_DIGEST.trim() !== "unknown"
      ? process.env.IMAGE_DIGEST.trim()
      : "unknown",
    environment: process.env.BANKING_ENV?.trim() || "development",
    moneyMode: process.env.BANKING_MONEY_MODE?.trim() || "virtual",
    schemaVersion: migration.schemaVersion,
    migrationSetDigest: migration.digest,
    apiContractDigest: process.env.API_CONTRACT_DIGEST?.trim() && process.env.API_CONTRACT_DIGEST.trim() !== "unknown"
      ? process.env.API_CONTRACT_DIGEST.trim()
      : "unknown",
    builtAt: process.env.BUILD_CREATED_AT?.trim() && process.env.BUILD_CREATED_AT.trim() !== "unknown"
      ? process.env.BUILD_CREATED_AT.trim()
      : null,
    startedAt,
    ...overrides,
  };
}
