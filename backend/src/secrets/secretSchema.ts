import type { SecretReference, SecretValue } from "./SecretProvider.js";

export type SecretSchema = {
  reference: SecretReference;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
};

export function validateSecretValue(schema: SecretSchema, secret: SecretValue): SecretValue {
  const value = secret.value;
  if (!value.trim()) throw new Error(`${schema.reference.secretId} resolved to an empty secret.`);
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    throw new Error(`${schema.reference.secretId} does not meet the minimum length policy.`);
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    throw new Error(`${schema.reference.secretId} exceeds the maximum length policy.`);
  }
  if (schema.pattern && !schema.pattern.test(value)) {
    throw new Error(`${schema.reference.secretId} does not match its secret schema.`);
  }
  return secret;
}
