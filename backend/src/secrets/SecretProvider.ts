export type SecretEnvironment = "development" | "test" | "preview" | "staging" | "production-like";

/** A reference contains metadata only; it must never contain a secret value. */
export type SecretReference = {
  secretId: string;
  environment: SecretEnvironment;
  service: string;
  purpose: string;
  envVar?: string;
};

export type SecretValue = {
  value: string;
  version: string;
  source: "local" | "managed";
  expiresAt?: string;
};

export interface SecretProvider {
  getSecret(reference: SecretReference): Promise<SecretValue>;
  getSecretVersion(reference: SecretReference): Promise<string>;
  refresh(reference: SecretReference): Promise<void>;
}
