import { DatabasePool } from "../src/database/pool.js";
import { UnitOfWork } from "../src/database/unitOfWork.js";
import { KeyEncryptionKeyringAdapter } from "../src/mfa/crypto.js";
import { EndpointCrypto } from "../src/notifications/endpointCrypto.js";
import { createRuntimeSecretProvider, referenceFor } from "../src/secrets/runtimeSecrets.js";

type RecordType = "mfa-customer" | "mfa-staff" | "notification-endpoint";

const recordType = (process.argv.find((value) => value.startsWith("--record-type="))?.slice(14) || "").trim() as RecordType;
const batchSize = Number(process.argv.find((value) => value.startsWith("--batch-size="))?.slice(13) || "50");
const apply = process.argv.includes("--apply");
const environment = (process.env.BANKING_ENV?.trim().toLowerCase() || "development") as "development" | "test" | "preview" | "staging" | "production-like";
const jobId = process.env.REENCRYPT_JOB_ID?.trim() || `reencrypt-${recordType || "missing"}-${Date.now()}`;

if (!new Set<RecordType>(["mfa-customer", "mfa-staff", "notification-endpoint"]).has(recordType)) throw new Error("--record-type must be mfa-customer, mfa-staff or notification-endpoint.");
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("--batch-size must be between 1 and 500.");
if (apply && process.env.REENCRYPT_CONFIRM !== "1") throw new Error("Applying re-encryption requires REENCRYPT_CONFIRM=1.");

function metadata(ciphertext: string): { version: string; aadVersion: string | null; algorithm: string; encryptedDataKey: string | null } {
  const parts = ciphertext.split(".");
  return { version: parts[0] === "v2" ? "v2" : "v1", aadVersion: parts[0] === "v2" ? parts[2] ?? null : null, algorithm: parts[0] === "v2" ? "AES-256-GCM-ENVELOPE" : "AES-256-GCM", encryptedDataKey: parts[0] === "v2" ? parts[6] ?? null : null };
}

function isCurrent(ciphertext: string, currentKeyId: string): boolean {
  return ciphertext.startsWith(`v2.${currentKeyId}.`);
}

function context(recordId: string, subjectId: string, kind: "mfa-totp" | "admin-mfa" | "notification-endpoint") {
  return { environment, recordType: kind, recordId, subjectId, schemaVersion: "026" };
}

async function ensureCheckpoint(database: DatabasePool, targetKeyId: string, previousKeyId: string | null): Promise<{ lastRecordId: string | null }> {
  const result = await database.query<{ last_record_id: string | null }>("SELECT last_record_id FROM encryption_rekey_checkpoints WHERE job_id = $1", [jobId]);
  if (result.rows[0]) return { lastRecordId: result.rows[0].last_record_id };
  await database.query(
    `INSERT INTO encryption_rekey_checkpoints (job_id, environment, record_type, from_key_id, to_key_id, status, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [jobId, environment, recordType, previousKeyId, targetKeyId, apply ? "RUNNING" : "PREPARED"],
  );
  return { lastRecordId: null };
}

async function main(): Promise<void> {
  const database = new DatabasePool({ max: 2 });
  const unitOfWork = new UnitOfWork(database);
  let failed = 0;
  try {
    const secretProvider = createRuntimeSecretProvider({ bankingEnvironment: environment });
    const currentMfa = await KeyEncryptionKeyringAdapter.fromSecretProvider(
      secretProvider,
      {
        current: referenceFor("mfaEncryptionKey", environment),
        previous: referenceFor("mfaEncryptionKeyPrevious", environment),
      },
      {
        currentKeyId: process.env.BANKING_MFA_ENCRYPTION_KEY_ID?.trim(),
        previousKeyId: process.env.BANKING_MFA_ENCRYPTION_KEY_PREVIOUS_ID?.trim(),
        required: environment === "staging" || environment === "production-like",
      },
    );
    const endpoint = await EndpointCrypto.fromSecretProvider(
      secretProvider,
      {
        current: referenceFor("notificationEndpointKey", environment),
        previous: referenceFor("notificationEndpointKeyPrevious", environment),
      },
      {
        currentKeyId: process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_ID?.trim(),
        previousKeyId: process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_PREVIOUS_ID?.trim(),
        required: environment === "staging" || environment === "production-like",
      },
    );
    const currentKeyId = recordType === "notification-endpoint" ? endpoint.keyId : currentMfa.keyId;
    const previousKeyId = recordType === "notification-endpoint"
      ? endpoint.previousKeyIds[0] ?? process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_PREVIOUS_ID?.trim() ?? null
      : currentMfa.previousKeyIds[0] ?? process.env.BANKING_MFA_ENCRYPTION_KEY_PREVIOUS_ID?.trim() ?? null;
    const checkpoint = await ensureCheckpoint(database, currentKeyId, previousKeyId);
    let scanned = 0;
    let changed = 0;
    let lastId = checkpoint.lastRecordId;
    while (true) {
      const query = recordType === "mfa-customer"
        ? `SELECT id, customer_id AS subject_id, secret_ciphertext, secret_key_id FROM mfa_credentials WHERE credential_type = 'TOTP' AND secret_ciphertext IS NOT NULL AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`
        : recordType === "mfa-staff"
          ? `SELECT id, staff_id AS subject_id, secret_ciphertext, encryption_key_id AS secret_key_id FROM staff_mfa_credentials WHERE secret_ciphertext IS NOT NULL AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`
          : `SELECT id, customer_id AS subject_id, address_ciphertext AS secret_ciphertext, address_key_id AS secret_key_id FROM notification_endpoints WHERE address_ciphertext IS NOT NULL AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`;
      const batchStartId = lastId;
      const batch = await unitOfWork.transaction(async ({ client }) => {
        const rows = await client.query<{ id: string; subject_id: string; secret_ciphertext: string; secret_key_id: string | null }>(
          // A monotonic checkpoint must never advance past a locked row. A
          // blocking row lock is deliberate here; SKIP LOCKED would make a
          // later resume silently omit records that were busy at scan time.
          `${query} FOR UPDATE`,
          [lastId, batchSize],
        );
        if (rows.rows.length === 0) return { count: 0, changed: 0, lastId: batchStartId };
        let batchChanged = 0;
        let batchLastId = batchStartId;
        for (const row of rows.rows) {
          scanned += 1;
          batchLastId = row.id;
          if ((recordType === "mfa-customer" || recordType === "mfa-staff") && isCurrent(row.secret_ciphertext, currentMfa.keyId)) continue;
          if (recordType === "notification-endpoint" && isCurrent(row.secret_ciphertext, endpoint.keyId)) continue;
          if (!apply) continue;
          const kind = recordType === "mfa-customer" ? "mfa-totp" : recordType === "mfa-staff" ? "admin-mfa" : "notification-endpoint";
          const encryptionContext = context(row.id, row.subject_id, kind);
          const plaintext = recordType === "notification-endpoint"
            ? endpoint.decrypt(row.secret_ciphertext, { environment, endpointId: row.id, customerId: row.subject_id, schemaVersion: "026" })
            : currentMfa.decrypt(row.secret_ciphertext, row.secret_key_id ?? undefined, encryptionContext);
          const ciphertext = recordType === "notification-endpoint"
            ? endpoint.encrypt(plaintext, { environment, endpointId: row.id, customerId: row.subject_id, schemaVersion: "026" })
            : currentMfa.encrypt(plaintext, encryptionContext);
          const details = metadata(ciphertext);
          if (recordType === "mfa-customer") {
            await client.query("UPDATE mfa_credentials SET secret_ciphertext=$2, secret_key_id=$3, secret_cipher_version=$4, secret_aad_version=$5, secret_encryption_algorithm=$6, secret_encrypted_data_key=$7, secret_reencrypted_at=NOW(), updated_at=NOW() WHERE id=$1", [row.id, ciphertext, currentMfa.keyId, details.version, details.aadVersion, details.algorithm, details.encryptedDataKey]);
          } else if (recordType === "mfa-staff") {
            await client.query("UPDATE staff_mfa_credentials SET secret_ciphertext=$2, encryption_key_id=$3, secret_cipher_version=$4, secret_aad_version=$5, secret_encryption_algorithm=$6, secret_encrypted_data_key=$7, secret_reencrypted_at=NOW(), updated_at=NOW() WHERE id=$1", [row.id, ciphertext, currentMfa.keyId, details.version, details.aadVersion, details.algorithm, details.encryptedDataKey]);
          } else {
            await client.query("UPDATE notification_endpoints SET address_ciphertext=$2, address_key_id=$3, address_cipher_version=$4, address_aad_version=$5, address_encryption_algorithm=$6, address_encrypted_data_key=$7, address_reencrypted_at=NOW(), updated_at=NOW() WHERE id=$1", [row.id, ciphertext, endpoint.keyId, details.version, details.aadVersion, details.algorithm, details.encryptedDataKey]);
          }
          batchChanged += 1;
        }
        if (apply) {
          await client.query("UPDATE encryption_rekey_checkpoints SET last_record_id=$2, scanned_count=scanned_count+$3, reencrypted_count=reencrypted_count+$4, updated_at=NOW() WHERE job_id=$1", [jobId, batchLastId, rows.rows.length, batchChanged]);
        }
        return { count: rows.rows.length, changed: batchChanged, lastId: batchLastId };
      });
      if (batch.count === 0) break;
      changed += batch.changed;
      lastId = batch.lastId;
      if (batch.count < batchSize) break;
    }
    if (apply) await database.query("UPDATE encryption_rekey_checkpoints SET status=$2, completed_at=NOW(), updated_at=NOW() WHERE job_id=$1", [jobId, failed > 0 ? "FAILED" : "COMPLETED"]);
    console.log(JSON.stringify({ jobId, recordType, environment, apply, scanned, reencrypted: changed, failed, status: apply ? failed > 0 ? "FAILED" : "COMPLETED" : "DRY_RUN" }));
  } catch (error) {
    if (apply) {
      failed += 1;
      await database.query("UPDATE encryption_rekey_checkpoints SET status='FAILED', failed_count=failed_count+1, last_error_code='REENCRYPT_BATCH_FAILED', updated_at=NOW() WHERE job_id=$1", [jobId]).catch(() => undefined);
    }
    throw error;
  } finally {
    await database.close();
  }
}

void main().catch(() => {
  console.error("Ciphertext re-encryption failed; inspect the checkpoint without printing secret material.");
  process.exitCode = 1;
});
