import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

import type { ManagedSecretClient } from "./ManagedSecretProvider.js";
import type { SecretReference, SecretValue } from "./SecretProvider.js";

type AccessSecretVersionResponse = {
  name?: string | null;
  payload?: { data?: Uint8Array | null } | null;
};

/** Narrow interface keeps cloud access replaceable by an offline fake in tests. */
export interface GoogleSecretManagerApi {
  accessSecretVersion(request: { name: string }): Promise<[AccessSecretVersionResponse, ...unknown[]]>;
}

const PROJECT_ID_PATTERN = /^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{6,20})$/;
const SECRET_ID_PATTERN = /^[a-z][a-z0-9-]{1,254}$/;

/**
 * Reads the latest enabled Google Secret Manager version through ADC and
 * returns the provider-assigned numeric version from the response resource.
 * It never logs secret bytes or underlying provider error text.
 */
export class GoogleSecretManagerClient implements ManagedSecretClient {
  private readonly api: GoogleSecretManagerApi;

  constructor(projectId: string, api?: GoogleSecretManagerApi) {
    const normalizedProjectId = projectId.trim();
    if (!PROJECT_ID_PATTERN.test(normalizedProjectId)) {
      throw new Error("BANKING_SECRET_PROJECT_ID must be a valid Google Cloud project ID or number.");
    }
    this.projectId = normalizedProjectId;
    this.api = api ?? new SecretManagerServiceClient() as unknown as GoogleSecretManagerApi;
  }

  private readonly projectId: string;

  async getSecret(reference: SecretReference): Promise<SecretValue> {
    if (reference.environment !== "staging" && reference.environment !== "production-like") {
      throw new Error("Google Secret Manager accepts only staging or production-like references.");
    }
    if (!SECRET_ID_PATTERN.test(reference.secretId)) {
      throw new Error("Google Secret Manager secret ID is invalid.");
    }

    const resourceName = `projects/${this.projectId}/secrets/${reference.secretId}/versions/latest`;
    try {
      const [response] = await this.api.accessSecretVersion({ name: resourceName });
      const payload = response?.payload?.data;
      const returnedName = response?.name;
      if (!(payload instanceof Uint8Array) || !returnedName) {
        throw new Error("invalid provider response");
      }
      const versionMatch = returnedName.match(
        new RegExp(`^projects/[^/]+/secrets/${reference.secretId}/versions/([1-9][0-9]*)$`),
      );
      const value = Buffer.from(payload).toString("utf8");
      if (!versionMatch || !value.trim()) {
        throw new Error("invalid provider response");
      }
      return { value, version: versionMatch[1], source: "managed" };
    } catch {
      throw new Error(`Google Secret Manager could not resolve managed secret ${reference.secretId}.`);
    }
  }
}
