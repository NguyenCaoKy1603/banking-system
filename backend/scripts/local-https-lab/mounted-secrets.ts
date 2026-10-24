import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRuntimeSecretProvider, referenceFor } from "../../src/secrets/runtimeSecrets.js";

const tempRoot = path.resolve(os.tmpdir());
const mountDirectory = await mkdtemp(path.join(tempRoot, "banking-mounted-secret-lab-"));
const tempPrefix = tempRoot.endsWith(path.sep) ? tempRoot : `${tempRoot}${path.sep}`;
if (!mountDirectory.startsWith(tempPrefix)) {
  throw new Error("Temporary mounted-secret folder is outside the operating-system temp directory.");
}

const fakeValue = randomBytes(32).toString("base64");
const secretId = "database-credential";
const env: NodeJS.ProcessEnv = {
  BANKING_SECRET_PROVIDER: "managed",
  BANKING_MANAGED_SECRET_BACKEND: "mounted",
  BANKING_MANAGED_SECRETS_DIR: mountDirectory,
  DATABASE_URL: "this-local-env-fallback-must-not-be-used",
};

try {
  await writeFile(path.join(mountDirectory, secretId), fakeValue, { flag: "wx" });
  await writeFile(path.join(mountDirectory, `${secretId}.version`), "synthetic-local-v1\n", { flag: "wx" });

  const provider = createRuntimeSecretProvider({ bankingEnvironment: "staging" }, env);
  const loaded = await provider.getSecret(referenceFor("databaseUrl", "staging"));
  assert.equal(loaded.value, fakeValue);
  assert.equal(loaded.version, "synthetic-local-v1");
  assert.equal(loaded.source, "managed");

  process.stdout.write(`${JSON.stringify({
    result: "PASS",
    environment: "staging-reference-with-synthetic-data",
    providerSource: loaded.source,
    version: loaded.version,
    cloudCalled: false,
    secretValuePrinted: false,
    envFallbackUsed: false,
  })}\n`);
} finally {
  const resolved = path.resolve(mountDirectory);
  if (!resolved.startsWith(tempPrefix)) throw new Error("Refusing to remove a directory outside the temporary lab prefix.");
  await rm(resolved, { recursive: true, force: true });
}
