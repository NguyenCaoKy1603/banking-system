import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type { ManagedSecretClient } from "./ManagedSecretProvider.js";
import type { SecretReference, SecretValue } from "./SecretProvider.js";

/**
 * Reads secrets that a real Secret Manager has mounted into a workload.
 *
 * This is deliberately not a local `.env` fallback.  The mount must contain
 * one file per secret id and a sibling `<secret-id>.version` metadata file.
 * The version sidecar lets release evidence record which managed version was
 * consumed without ever copying the secret value into logs or artifacts.
 */
export class MountedSecretClient implements ManagedSecretClient {
  private readonly directory: string;

  constructor(directory: string) {
    const configured = directory.trim();
    if (!configured || !path.isAbsolute(configured)) {
      throw new Error("BANKING_MANAGED_SECRETS_DIR must be an absolute mounted-secret directory.");
    }
    this.directory = path.resolve(configured);
  }

  async getSecret(reference: SecretReference): Promise<SecretValue> {
    if (reference.environment !== "staging" && reference.environment !== "production-like") {
      throw new Error("Mounted managed secrets accept only staging or production-like references.");
    }
    const secretPath = this.safePath(reference.secretId);
    const versionPath = this.safePath(`${reference.secretId}.version`);
    try {
      const [secretStat, value, version] = await Promise.all([
        lstat(secretPath),
        readFile(secretPath, "utf8"),
        readFile(versionPath, "utf8"),
      ]);
      if (!secretStat.isFile()) {
        throw new Error("secret mount entry is not a regular file");
      }
      const trimmedValue = value.trim();
      const trimmedVersion = version.trim();
      if (!trimmedValue || !trimmedVersion) {
        throw new Error("secret value or version is empty");
      }
      return { value: trimmedValue, version: trimmedVersion, source: "managed" };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("secret mount entry")) throw error;
      throw new Error(`Managed secret ${reference.secretId} is not available with version metadata.`);
    }
  }

  private safePath(fileName: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(fileName)) {
      throw new Error("Managed secret id contains unsupported path characters.");
    }
    const resolved = path.resolve(this.directory, fileName);
    const prefix = this.directory.endsWith(path.sep) ? this.directory : `${this.directory}${path.sep}`;
    if (resolved !== this.directory && !resolved.startsWith(prefix)) {
      throw new Error("Managed secret path escapes the mounted directory.");
    }
    return resolved;
  }
}
