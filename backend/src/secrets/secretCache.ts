import type { SecretProvider, SecretReference, SecretValue } from "./SecretProvider.js";

function cacheKey(reference: SecretReference): string {
  return [reference.environment, reference.service, reference.purpose, reference.secretId].join("|");
}

/** In-memory cache only; values are never persisted or included in errors. */
export class SecretCache implements SecretProvider {
  private readonly values = new Map<string, SecretValue>();
  private readonly loadedAt = new Map<string, number>();

  constructor(private readonly provider: SecretProvider, private readonly ttlMs = 5 * 60 * 1000) {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error("Secret cache TTL must be a positive integer.");
  }

  async getSecret(reference: SecretReference): Promise<SecretValue> {
    const key = cacheKey(reference);
    const cached = this.values.get(key);
    const loadedAt = this.loadedAt.get(key) ?? 0;
    const expiresAt = cached?.expiresAt ? Date.parse(cached.expiresAt) : Number.POSITIVE_INFINITY;
    if (cached && Date.now() - loadedAt < this.ttlMs && expiresAt > Date.now()) return cached;
    const resolved = await this.provider.getSecret(reference);
    this.values.set(key, resolved);
    this.loadedAt.set(key, Date.now());
    return resolved;
  }

  async getSecretVersion(reference: SecretReference): Promise<string> {
    return (await this.getSecret(reference)).version;
  }

  async refresh(reference: SecretReference): Promise<void> {
    const key = cacheKey(reference);
    this.values.set(key, await this.provider.getSecret(reference));
    this.loadedAt.set(key, Date.now());
  }

  clear(): void {
    this.values.clear();
    this.loadedAt.clear();
  }
}
