import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class EndpointCrypto {
  private readonly key: Buffer;

  constructor(keyMaterial = process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY) {
    if (!keyMaterial?.trim()) {
      throw new Error("NOTIFICATION_ENDPOINT_ENCRYPTION_KEY is required for notification endpoints.");
    }
    this.key = createHash("sha256").update(keyMaterial).digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  decrypt(value: string): string {
    const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split(".");
    if (!ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error("Endpoint ciphertext is invalid.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
