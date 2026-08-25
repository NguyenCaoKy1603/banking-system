import type { SecretEnvironment, SecretProvider, SecretReference, SecretValue } from "./SecretProvider.js";
import { validateSecretValue, type SecretSchema } from "./secretSchema.js";

const LOCAL_ENVIRONMENTS = new Set<SecretEnvironment>(["development", "test", "preview"]);

/**
 * Local-only provider. It is intentionally unable to resolve staging or
 * production-like references, even if a caller accidentally passes an env
 * object containing those values.
 */
export class LocalDevelopmentSecretProvider implements SecretProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly environment: SecretEnvironment = "development") {
    if (!LOCAL_ENVIRONMENTS.has(environment)) {
      throw new Error("LocalDevelopmentSecretProvider is only allowed in development, test or preview.");
    }
  }

  async getSecret(reference: SecretReference): Promise<SecretValue> {
    if (!LOCAL_ENVIRONMENTS.has(reference.environment) || reference.environment !== this.environment) {
      throw new Error(`Local secret provider cannot resolve ${reference.environment} secret references.`);
    }
    const envVar = reference.envVar ?? reference.secretId;
    const value = this.env[envVar]?.trim();
    if (!value) throw new Error(`${envVar} is required for local secret reference ${reference.secretId}.`);
    const version = this.env[`${envVar}_VERSION`]?.trim() || "local-v1";
    return { value, version, source: "local" };
  }

  async getSecretVersion(reference: SecretReference): Promise<string> {
    return (await this.getSecret(reference)).version;
  }

  async refresh(reference: SecretReference): Promise<void> {
    await this.getSecret(reference);
  }

  async getValidatedSecret(schema: SecretSchema): Promise<SecretValue> {
    return validateSecretValue(schema, await this.getSecret(schema.reference));
  }
}
