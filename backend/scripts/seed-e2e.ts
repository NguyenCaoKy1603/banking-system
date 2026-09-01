import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Pool, type PoolConfig } from "pg";
import { generateTotp, KeyEncryptionKeyringAdapter } from "../src/mfa/crypto.js";
import { calculateMinimumPayment } from "../src/credit.js";
import { AuditRepository } from "../src/database/repositories/auditRepository.js";
import { LedgerRepository } from "../src/database/repositories/ledgerRepository.js";
import { OutboxRepository } from "../src/database/repositories/outboxRepository.js";

const require = createRequire(import.meta.url);
const { resolvePostgresSsl } = require("./postgres-ssl.cjs") as { resolvePostgresSsl: () => PoolConfig["ssl"] };

type JsonRecord = Record<string, unknown>;

const baseUrl = (
  process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "5000"}/api/v1`
).replace(/\/+$/, "");
const email = process.env.E2E_EMAIL ?? "tester@example.com";
const password = process.env.E2E_PASSWORD?.trim();
const deviceId = process.env.E2E_DEVICE_ID ?? "e2e-device-android";
const registrationCode = process.env.E2E_REGISTRATION_CODE?.trim();
const emailCaptureUrl = process.env.E2E_EMAIL_CAPTURE_URL?.trim().replace(/\/+$/, "");
const totpSecret = process.env.E2E_TOTP_SECRET?.trim();
const explicitTotpCode = process.env.E2E_TOTP_CODE?.trim();
const TOTP_PERIOD_MS = 30_000;
// Host-side E2E seed and the local API container can have a few seconds of
// clock skew.  Generate after a safe margin inside the new 30-second step so
// the API never sees a proof from its future.
const TOTP_EDGE_GUARD_MS = 6_000;
let lastTotpStep = -1;

if (!password) {
  throw new Error(
    "E2E_PASSWORD is required; do not put test credentials in the repository.",
  );
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function request(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<{ status: number; body: unknown }> {
  const rateLimitKey = process.env.E2E_RATE_LIMIT_KEY?.trim();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Device-ID": deviceId,
      ...(rateLimitKey ? { "X-Forwarded-For": rateLimitKey } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body };
}

function requireBody<T extends JsonRecord>(result: { status: number; body: unknown }, label: string): T {
  if (result.status < 200 || result.status >= 300 || typeof result.body !== "object" || result.body === null) {
    throw new Error(`${label} failed with HTTP ${result.status}: ${json(result.body)}`);
  }
  return result.body as T;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function seedReferenceFunding(accountId: string, amountMinor: string, seedKey: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    if (process.env.E2E_FUNDING_PRESEEDED !== "1") {
      throw new Error("E2E requires DATABASE_URL for an isolated reference fixture, or E2E_FUNDING_PRESEEDED=1 for a pre-funded account.");
    }
    return;
  }
  const amount = BigInt(amountMinor);
  if (amount <= 0n) throw new Error("E2E_FUNDING_AMOUNT_MINOR must be positive.");
  const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: resolvePostgresSsl() });
  const transactionId = randomUUID();
  const journalId = randomUUID();
  const outboxId = randomUUID();
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query("SELECT id, status, version FROM payment_accounts WHERE id=$1 FOR UPDATE", [accountId]);
      if (!account.rows[0]) throw new Error("E2E fixture account was not found in PostgreSQL.");
      if (String(account.rows[0].status) !== "ACTIVE") throw new Error("E2E fixture account is not active.");
      const existing = await client.query("SELECT id FROM account_transactions WHERE account_id=$1 AND reference=$2 LIMIT 1", [accountId, `E2E-REFERENCE-FUND-${seedKey}`]);
      if (!existing.rows[0]) {
        const version = Number(account.rows[0].version ?? 0) + 1;
        await client.query("UPDATE payment_accounts SET available_minor=available_minor+$2,current_minor=current_minor+$2,version=$3,updated_at=NOW() WHERE id=$1", [accountId, amount.toString(), version]);
        await client.query("INSERT INTO account_transactions (id,account_id,direction,amount_minor,fee_minor,currency,status,description,counterparty_name,reference,occurred_at,created_at,completed_at,kind) VALUES ($1,$2,'CREDIT',$3,0,'VND','SUCCEEDED','E2E reference fixture funding','Reference fixture',$4,NOW(),NOW(),NOW(),'REFERENCE_FIXTURE_FUNDING')", [transactionId, accountId, amount.toString(), `E2E-REFERENCE-FUND-${seedKey}`]);
        await client.query("INSERT INTO ledger_journals (id,aggregate_id,journal_type,currency,occurred_at,created_at) VALUES ($1,$2,'REFERENCE_FIXTURE_FUNDING','VND',NOW(),NOW())", [journalId, transactionId]);
        await client.query("INSERT INTO ledger_entries (journal_id,line_number,account_ref,side,amount_minor,currency) VALUES ($1,1,'reference-fixture-source','DEBIT',$2,'VND'),($1,2,$3,'CREDIT',$2,'VND')", [journalId, amount.toString(), `payment-account:${accountId}`]);
        await client.query("INSERT INTO outbox_events (id,event_type,aggregate_id,payload,occurred_at,published_at,attempts,next_attempt_at,event_version,aggregate_type,aggregate_version,status,priority,deduplication_key,created_at,updated_at,trace_id) VALUES ($1,'REFERENCE_FIXTURE_FUNDING_SUCCEEDED',$2,$3,NOW(),NULL,0,NOW(),1,'payment-account',$4,'PENDING',100,$5,NOW(),NOW(),$6)", [outboxId, accountId, JSON.stringify({ transactionId, amountMinor: amount.toString(), currency: "VND" }), version, `e2e-reference-funding:${seedKey}`, `e2e:${seedKey}`]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function envelopeMetadata(ciphertext: string): { version: string; aadVersion: string | null; algorithm: string; encryptedDataKey: string | null } {
  const parts = ciphertext.split(".");
  return {
    version: parts[0] === "v2" ? "v2" : "v1",
    aadVersion: parts[0] === "v2" ? parts[2] ?? null : null,
    algorithm: parts[0] === "v2" ? "AES-256-GCM-ENVELOPE" : "AES-256-GCM",
    encryptedDataKey: parts[0] === "v2" ? parts[6] ?? null : null,
  };
}

/**
 * Provision a per-run TOTP fixture without exposing the seed secret through an
 * HTTP endpoint. The credential is encrypted with the same local runtime key
 * and is only used by this disposable E2E database.
 */
async function ensureE2eTotpCredential(userEmail: string): Promise<void> {
  if (!totpSecret) throw new Error("E2E_TOTP_SECRET is required to provision the E2E MFA fixture.");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to provision the E2E MFA fixture.");
  const encryption = KeyEncryptionKeyringAdapter.fromEnvironment({ required: true });
  const credentialId = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: resolvePostgresSsl() });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const customer = await client.query<{ id: string }>("SELECT id FROM customers WHERE email = $1", [userEmail]);
      const customerId = customer.rows[0]?.id;
      if (!customerId) throw new Error("E2E fixture customer was not found while provisioning MFA.");
      const active = await client.query("SELECT id FROM mfa_credentials WHERE customer_id = $1 AND credential_type = 'TOTP' AND status = 'ACTIVE' LIMIT 1", [customerId]);
      if (active.rows[0]) {
        await client.query("COMMIT");
        return;
      }
      const encryptedSecret = encryption.encrypt(totpSecret, {
        environment: process.env.BANKING_ENV?.trim() || "preview",
        recordType: "mfa-totp",
        recordId: credentialId,
        subjectId: customerId,
        schemaVersion: "026",
      });
      const metadata = envelopeMetadata(encryptedSecret);
      const displayName = `E2E Authenticator ${fingerprint(userEmail).slice(0, 8)}`;
      await client.query(
        `INSERT INTO mfa_credentials
          (id, customer_id, credential_type, display_name, status,
           secret_ciphertext, secret_key_id, secret_cipher_version,
           secret_aad_version, secret_encryption_algorithm, secret_encrypted_data_key,
           algorithm, digits, period_seconds, enrolled_at)
         VALUES ($1, $2, 'TOTP', $3, 'ACTIVE', $4, $5, $6, $7, $8, $9, 'SHA1', 6, 30, NOW())`,
        [credentialId, customerId, displayName, encryptedSecret, encryption.keyId, metadata.version, metadata.aadVersion, metadata.algorithm, metadata.encryptedDataKey],
      );
      await client.query(
        `INSERT INTO auth_security_events (id, customer_id, event_type, purpose, resource_id, metadata)
         VALUES ($1, $2, 'MFA_ENROLLED', 'MFA_TOTP_ENROLLMENT', $3, $4::jsonb)`,
        [randomUUID(), customerId, credentialId, JSON.stringify({ source: "e2e_fixture" })],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Move only the disposable E2E credit fixture to the state required by the
 * customer activation flow. The real business flow remains four-eyes:
 * SUBMITTED -> Admin decision -> PENDING_ACTIVATION -> customer step-up.
 */
async function approveE2eCreditApplication(userEmail: string, applicationId: string): Promise<void> {
  if (process.env.E2E_CREDIT_APPROVE_FIXTURE !== "1") return;
  if ((process.env.BANKING_ENV?.trim() || "preview") !== "preview") {
    throw new Error("E2E_CREDIT_APPROVE_FIXTURE is allowed only for the local preview environment.");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to provision the E2E credit approval fixture.");
  const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: resolvePostgresSsl() });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const customer = await client.query<{ id: string }>("SELECT id FROM customers WHERE email = $1", [userEmail]);
      const customerId = customer.rows[0]?.id;
      if (!customerId) throw new Error("E2E fixture customer was not found while approving credit.");

      const application = await client.query<{
        id: string;
        customer_id: string;
        status: string;
        requested_limit_minor: string;
        version: number;
      }>(
        "SELECT id, customer_id, status, requested_limit_minor, version FROM credit_applications WHERE id = $1 AND customer_id = $2 FOR UPDATE",
        [applicationId, customerId],
      );
      const row = application.rows[0];
      if (!row) throw new Error("E2E credit application was not found for the fixture customer.");
      if (row.status === "PENDING_ACTIVATION") {
        await client.query("COMMIT");
        return;
      }
      if (!["SUBMITTED", "UNDER_REVIEW"].includes(row.status)) {
        throw new Error(`E2E credit application cannot be fixture-approved from status ${row.status}.`);
      }

      const updated = await client.query<{ version: number }>(
        `UPDATE credit_applications
            SET status = 'PENDING_ACTIVATION',
                approved_limit_minor = requested_limit_minor,
                decision_reason_code = 'E2E_FIXTURE_APPROVAL',
                decision_at = NOW(),
                version = version + 1,
                updated_at = NOW()
          WHERE id = $1
          RETURNING version`,
        [applicationId],
      );
      const afterVersion = Number(updated.rows[0]?.version ?? Number(row.version) + 1);
      const approvedLimitMinor = String(row.requested_limit_minor);

      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "CREDIT_APPLICATION_E2E_APPROVED",
        actorCustomerId: customerId,
        resourceId: applicationId,
        payload: {
          source: "disposable_e2e_fixture",
          status: "PENDING_ACTIVATION",
          approvedLimitMinor,
        },
      });
      await new OutboxRepository(client).append({
        id: randomUUID(),
        eventType: "credit.application_approved",
        aggregateType: "credit-application",
        aggregateId: applicationId,
        aggregateVersion: afterVersion,
        deduplicationKey: `e2e-credit-approval:${applicationId}`,
        subjectCustomerIds: [customerId],
        payload: {
          applicationId,
          status: "PENDING_ACTIVATION",
          approvedLimitMinor,
          source: "disposable_e2e_fixture",
        },
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Create the small outstanding balance needed by the payment screen. The
 * relational activation flow intentionally creates a clean credit account;
 * this explicit fixture adds one synthetic purchase and its statement so the
 * payment E2E can exercise quote -> step-up -> ledger -> outbox.
 */
async function seedE2eCreditStatement(userEmail: string, applicationId: string): Promise<void> {
  if (process.env.E2E_CREDIT_APPROVE_FIXTURE !== "1") return;
  if ((process.env.BANKING_ENV?.trim() || "preview") !== "preview") {
    throw new Error("E2E credit statement fixtures are allowed only for the local preview environment.");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to provision the E2E credit statement fixture.");
  const amount = BigInt(process.env.E2E_CREDIT_OUTSTANDING_MINOR ?? "4000000");
  if (amount <= 0n) throw new Error("E2E_CREDIT_OUTSTANDING_MINOR must be positive.");
  const minimum = calculateMinimumPayment(amount);
  const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: resolvePostgresSsl() });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const customer = await client.query<{ id: string }>("SELECT id FROM customers WHERE email = $1", [userEmail]);
      const customerId = customer.rows[0]?.id;
      if (!customerId) throw new Error("E2E fixture customer was not found while seeding credit statement.");
      const application = await client.query<{ credit_account_id: string | null }>(
        "SELECT credit_account_id FROM credit_applications WHERE id = $1 AND customer_id = $2",
        [applicationId, customerId],
      );
      const creditAccountId = application.rows[0]?.credit_account_id;
      if (!creditAccountId) throw new Error("E2E credit application has no activated credit account.");
      const account = await client.query<{ current_cycle_start_at: string }>(
        "SELECT current_cycle_start_at FROM credit_accounts WHERE id = $1 AND customer_id = $2 FOR UPDATE",
        [creditAccountId, customerId],
      );
      const accountRow = account.rows[0];
      if (!accountRow) throw new Error("E2E activated credit account was not found.");
      const existing = await client.query(
        "SELECT id FROM credit_statements WHERE credit_account_id = $1 AND remaining_amount_due_minor > 0 ORDER BY issued_at DESC, id DESC LIMIT 1",
        [creditAccountId],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return;
      }

      const now = new Date();
      const issuedAt = now.toISOString();
      const cycleEndAt = new Date(Date.parse(accountRow.current_cycle_start_at)).toISOString();
      const cycleStartAt = new Date(Date.parse(cycleEndAt) - 5 * 24 * 60 * 60 * 1000).toISOString();
      const dueAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();
      const statementId = randomUUID();
      const transactionId = randomUUID();
      await client.query(
        `INSERT INTO credit_statements
          (id, credit_account_id, cycle_start_at, cycle_end_at, issued_at, due_at,
           opening_balance_minor, purchase_total_minor, refund_total_minor,
           fee_total_minor, interest_total_minor, closing_balance_minor,
           remaining_amount_due_minor, minimum_payment_due_minor,
           minimum_payment_remaining_minor, paid_amount_minor, status, version)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, 0, 0, 0, $7, $7, $8, $8, 0, 'ISSUED', 1)`,
        [statementId, creditAccountId, cycleStartAt, cycleEndAt, issuedAt, dueAt, amount.toString(), minimum.toString()],
      );
      await client.query(
        `INSERT INTO credit_transactions
          (id, credit_account_id, statement_id, type, status, description,
           merchant_name, amount_minor, debt_effect, occurred_at, posted_at)
         VALUES ($1, $2, $3, 'PURCHASE', 'POSTED',
                 'Dư nợ mua sắm fixture E2E', 'Merchant fixture E2E', $4,
                 'INCREASE', $5, $5)`,
        [transactionId, creditAccountId, statementId, amount.toString(), new Date(Date.parse(cycleEndAt) - 24 * 60 * 60 * 1000).toISOString()],
      );
      await client.query("INSERT INTO credit_statement_items (statement_id, transaction_id) VALUES ($1, $2)", [statementId, transactionId]);
      await client.query(
        "UPDATE credit_accounts SET posted_outstanding_minor = posted_outstanding_minor + $2, version = version + 1, updated_at = NOW() WHERE id = $1",
        [creditAccountId, amount.toString()],
      );
      const journalId = randomUUID();
      const ledger = new LedgerRepository(client);
      await ledger.appendJournal({ id: journalId, aggregateId: statementId, journalType: "CREDIT_PURCHASE_FIXTURE", occurredAt: issuedAt });
      await ledger.appendEntries(journalId, [
        { lineNumber: 1, accountRef: `credit-receivable:${creditAccountId}`, side: "DEBIT", amountMinor: amount.toString(), entryId: randomUUID(), occurredAt: issuedAt },
        { lineNumber: 2, accountRef: `e2e-credit-purchase-source:${applicationId}`, side: "CREDIT", amountMinor: amount.toString(), entryId: randomUUID(), occurredAt: issuedAt },
      ]);
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "CREDIT_STATEMENT_E2E_SEEDED",
        actorCustomerId: customerId,
        resourceId: statementId,
        occurredAt: issuedAt,
        payload: { source: "disposable_e2e_fixture", amountMinor: amount.toString(), applicationId },
      });
      const notificationId = randomUUID();
      await client.query(
        "INSERT INTO notifications (id, customer_id, notification_type, title, body, resource_id, resource_account_id, is_read, created_at) VALUES ($1, $2, 'CREDIT', 'Sao kê thẻ tín dụng đã phát hành', 'Sao kê fixture E2E đã sẵn sàng.', $3, NULL, false, $4)",
        [notificationId, customerId, statementId, issuedAt],
      );
      await new OutboxRepository(client).append({
        id: randomUUID(),
        eventType: "credit.statement_issued",
        aggregateType: "credit-statement",
        aggregateId: statementId,
        aggregateVersion: 1,
        deduplicationKey: `e2e-credit-statement:${statementId}`,
        subjectCustomerIds: [customerId],
        notificationIds: [notificationId],
        occurredAt: issuedAt,
        payload: {
          statementId,
          creditAccountId,
          closingAmountMinor: amount.toString(),
          source: "disposable_e2e_fixture",
        },
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function getRegistrationCode(destination: string): Promise<string> {
  if (registrationCode && /^\d{6}$/.test(registrationCode)) return registrationCode;
  if (!emailCaptureUrl) {
    throw new Error(
      "E2E_REGISTRATION_CODE or E2E_EMAIL_CAPTURE_URL must be supplied by the configured email test provider.",
    );
  }
  const deadline = Date.now() + Number(process.env.E2E_EMAIL_CAPTURE_TIMEOUT_MS ?? 30_000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${emailCaptureUrl}/messages`, { headers: { Accept: "application/json" } });
      if (response.ok) {
        const body = await response.json() as { messages?: Array<{ purpose?: string; destination?: string; code?: string; expiresAt?: string }> };
        const message = body.messages?.find((candidate) =>
          candidate.purpose === "REGISTRATION_EMAIL_VERIFY" &&
          candidate.destination === destination &&
          /^\d{6}$/.test(candidate.code ?? "") &&
          Date.parse(candidate.expiresAt ?? "") > Date.now(),
        );
        if (message?.code) return message.code;
      }
    } catch {
      // The local capture service may start after the API; keep polling until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The local email capture service did not receive a live registration challenge in time.");
}

async function getTotpCode(): Promise<string> {
  if (explicitTotpCode) {
    if (!/^\d{6}$/.test(explicitTotpCode)) throw new Error("E2E_TOTP_CODE must contain six digits.");
    return explicitTotpCode;
  }
  if (!totpSecret) {
    throw new Error("E2E_TOTP_SECRET is required for production-like MFA seed; never use a fixed OTP.");
  }
  let now = Date.now();
  let step = Math.floor(now / TOTP_PERIOD_MS);
  while (step <= lastTotpStep || now - step * TOTP_PERIOD_MS < TOTP_EDGE_GUARD_MS) {
    const targetStep = Math.max(step, lastTotpStep + 1);
    const targetAt = targetStep * TOTP_PERIOD_MS + TOTP_EDGE_GUARD_MS;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, targetAt - now)));
    now = Date.now();
    step = Math.floor(now / TOTP_PERIOD_MS);
  }
  lastTotpStep = step;
  return generateTotp(totpSecret, now);
}

async function createOtpChallenge(
  accessToken: string,
  purpose: string,
  resourceId?: string,
  requestFingerprint?: string,
): Promise<string> {
  const result = await request(
    "/auth/otp/challenges",
    {
      method: "POST",
      body: json({ purpose, resourceId: resourceId ?? null, requestFingerprint: requestFingerprint ?? null }),
    },
    accessToken,
  );
  return requireBody<{ challengeId: string }>(result, `${purpose} OTP challenge`).challengeId;
}

async function registerIfNeeded(
  input: { fullName: string; email: string; phoneNumber: string; password: string },
): Promise<void> {
  const register = await request("/auth/register", {
    method: "POST",
    body: json(input),
  });
  if (register.status === 202) {
    const challenge = requireBody<{ challengeId: string }>(register, "registration");
    const proof = await getRegistrationCode(input.email);
    requireBody(
      await request("/auth/register/verify", {
        method: "POST",
        body: json({ challengeId: challenge.challengeId, method: "OTP", proof }),
      }),
      "registration verification",
    );
    return;
  }
  if (register.status !== 201 && register.status !== 409) {
    requireBody(register, "register");
  }
}

async function loginUser(userEmail: string, userPassword: string): Promise<string> {
  const login = await request("/auth/login", {
    method: "POST",
    body: json({ email: userEmail, password: userPassword }),
  });
  let session = requireBody<{ accessToken?: string; challengeId?: string }>(login, "login");
  if (login.status === 202) {
    if (!session.challengeId) throw new Error("Login returned MFA status without challengeId.");
    const proof = await getTotpCode();
    session = requireBody<{ accessToken?: string }>(
      await request("/auth/verify", {
        method: "POST",
        body: json({ challengeId: session.challengeId, method: "TOTP", proof }),
      }),
      "MFA verification",
    );
  }
  if (!session.accessToken) throw new Error("Login did not return an access token.");
  return session.accessToken;
}

async function main(): Promise<void> {
  if (!password) throw new Error("E2E_PASSWORD is required.");
  const requiredPassword = password;
  await registerIfNeeded({
    fullName: "E2E Tester",
    email,
    phoneNumber: process.env.E2E_PHONE ?? "0900000099",
    password: requiredPassword,
  });
  const accessToken = await loginUser(email, requiredPassword);
  await ensureE2eTotpCredential(email);
  const accounts = requireBody<{
    accounts: Array<{
      id: string;
      displayName: string;
      maskedNumber: string;
    }>;
  }>(await request("/accounts", {}, accessToken), "accounts");
  const account = accounts.accounts[0];
  if (!account) {
    throw new Error("Seed user has no payment account.");
  }

  await seedReferenceFunding(
    account.id,
    process.env.E2E_FUNDING_AMOUNT_MINOR ?? "10000000",
    fingerprint(email).slice(0, 24),
  );

  const beneficiaries = requireBody<{
    items: Array<{
      id: string;
      displayName: string;
      maskedAccountNumber: string;
      bankName: string;
    }>;
  }>(await request("/beneficiaries", {}, accessToken), "beneficiaries");

  let beneficiary = beneficiaries.items[0];
  if (!beneficiary) {
    let destinationAccountNumber = process.env.E2E_BENEFICIARY_ACCOUNT?.trim();
    if (!destinationAccountNumber) {
      const recipientPassword = process.env.E2E_RECIPIENT_PASSWORD?.trim();
      if (!recipientPassword) {
        throw new Error(
          "E2E_BENEFICIARY_ACCOUNT or E2E_RECIPIENT_PASSWORD is required to create a real recipient account.",
        );
      }
      const recipientEmail = process.env.E2E_RECIPIENT_EMAIL ?? "recipient@example.com";
      await registerIfNeeded({
        fullName: "E2E Recipient",
        email: recipientEmail,
        phoneNumber: process.env.E2E_RECIPIENT_PHONE ?? "0900000100",
        password: recipientPassword,
      });
      const recipientAccessToken = await loginUser(recipientEmail, recipientPassword);
      const recipientAccounts = requireBody<{
        accounts: Array<{ id: string }>;
      }>(await request("/accounts", {}, recipientAccessToken), "recipient accounts");
      const recipientAccount = recipientAccounts.accounts[0];
      if (!recipientAccount) throw new Error("Recipient user has no payment account.");
      destinationAccountNumber = requireBody<{ accountNumber: string }>(
        await request(`/accounts/${recipientAccount.id}/number`, {}, recipientAccessToken),
        "recipient account number",
      ).accountNumber;
    }
    const created = requireBody<{
      beneficiary: {
        id: string;
        displayName: string;
        maskedAccountNumber: string;
        bankName: string;
      };
    }>(
      await request(
        "/beneficiaries",
        {
          method: "POST",
          body: json({
            displayName: "E2E Recipient",
            accountNumber: destinationAccountNumber,
            bankName: "Reference Bank",
          }),
        },
        accessToken,
      ),
      "create beneficiary",
    );
    beneficiary = created.beneficiary;
  }

  const transferAmount = process.env.E2E_TRANSFER_AMOUNT_MINOR ?? "100000";
  const quote = requireBody<{ quoteId: string }>(
    await request(
      "/transfers/quote",
      {
        method: "POST",
        body: json({
          sourceAccountId: account.id,
          beneficiaryId: beneficiary.id,
          amount: { currency: "VND", amountMinor: transferAmount },
        }),
      },
      accessToken,
    ),
    "transfer quote",
  );
  const transferChallengeId = await createOtpChallenge(
    accessToken,
    "TRANSFER",
    quote.quoteId,
    fingerprint({ quoteId: quote.quoteId, amountMinor: transferAmount }),
  );
  const transferProof = await getTotpCode();
  const transfer = requireBody<{ transferId: string; status: string }>(
    await request(
      "/transfers",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": `e2e-seed-${Date.now()}`,
        },
        body: json({
          quoteId: quote.quoteId,
          stepUp: { method: "TOTP", proof: transferProof, challengeId: transferChallengeId },
        }),
      },
      accessToken,
    ),
    "seed transfer",
  );

  const savingsProducts = requireBody<{
    items: Array<{ productId: string }>;
  }>(await request("/savings/products", {}, accessToken), "savings products");
  const savingsProduct = savingsProducts.items[0];
  if (!savingsProduct) {
    throw new Error("Seed has no active savings product.");
  }
  const savingsQuote = requireBody<{ quoteId: string }>(
    await request(
      "/savings/quotes",
      {
        method: "POST",
        body: json({
          sourceAccountId: account.id,
          productId: savingsProduct.productId,
          principal: { currency: "VND", amountMinor: process.env.E2E_SAVINGS_AMOUNT_MINOR ?? "1000000" },
          maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
        }),
      },
      accessToken,
    ),
    "savings quote",
  );
  const savingsChallengeId = await createOtpChallenge(
    accessToken,
    "SAVINGS_OPENING",
    savingsQuote.quoteId,
    fingerprint({ quoteId: savingsQuote.quoteId }),
  );
  const savingsProof = await getTotpCode();
  const savingsOpening = requireBody<{
    openingId: string;
    depositId: string | null;
    status: string;
  }>(
    await request(
      "/savings/deposits",
      {
        method: "POST",
        headers: { "Idempotency-Key": `e2e-savings-seed-${Date.now()}` },
        body: json({
          quoteId: savingsQuote.quoteId,
          stepUp: { method: "TOTP", proof: savingsProof, challengeId: savingsChallengeId },
        }),
      },
      accessToken,
    ),
    "savings opening",
  );
  if (savingsOpening.status === "PENDING") {
    const resumed = requireBody<{ depositId: string | null; status: string }>(
      await request(`/savings/openings/${savingsOpening.openingId}`, {}, accessToken),
      "savings opening resume",
    );
    savingsOpening.depositId = resumed.depositId;
    savingsOpening.status = resumed.status;
  }

  const requestedLimitMinor = process.env.E2E_CREDIT_LIMIT_MINOR ?? "20000000";
  const creditApplicationChallengeId = await createOtpChallenge(
    accessToken,
    "CREDIT_APPLICATION",
    undefined,
    fingerprint({ requestedLimitMinor }),
  );
  const creditApplicationProof = await getTotpCode();
  const application = requireBody<{ applicationId: string; status: string }>(
    await request(
      "/credit/applications",
      {
        method: "POST",
        headers: { "Idempotency-Key": `e2e-credit-application-${email}` },
        body: json({
          requestedLimit: { currency: "VND", amountMinor: requestedLimitMinor },
          stepUp: { method: "TOTP", proof: creditApplicationProof, challengeId: creditApplicationChallengeId },
        }),
      },
      accessToken,
    ),
    "credit application",
  );
  await approveE2eCreditApplication(email, application.applicationId);
  const creditActivationChallengeId = await createOtpChallenge(
    accessToken,
    "CARD_ACTIVATION",
    application.applicationId,
  );
  const creditActivationProof = await getTotpCode();
  requireBody(
    await request(
      `/credit/applications/${application.applicationId}/activate`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `e2e-credit-activation-${email}` },
        body: json({
          stepUp: { method: "TOTP", proof: creditActivationProof, challengeId: creditActivationChallengeId },
        }),
      },
      accessToken,
    ),
    "credit activation",
  );
  await seedE2eCreditStatement(email, application.applicationId);

  const creditCards = requireBody<{
    items: Array<{ cardId: string; creditAccountId: string; lastFour: string; postedOutstanding: { amountMinor: string }; minimumPaymentRemaining: { amountMinor: string } }>;
  }>(await request("/cards", {}, accessToken), "credit cards");
  const creditCard = creditCards.items[0];
  if (!creditCard) {
    throw new Error("Seed has no credit sandbox card.");
  }
  const creditStatements = requireBody<{
    items: Array<{ statementId: string; minimumPaymentRemaining: { amountMinor: string } }>;
  }>(await request(`/credit/accounts/${creditCard.creditAccountId}/statements`, {}, accessToken), "credit statements");
  const creditStatement = creditStatements.items[0];
  if (!creditStatement) {
    throw new Error("Seed has no credit sandbox statement.");
  }

  const qrPayload = JSON.stringify({
    version: 1,
    kind: "RECEIVE_MONEY",
    accountId: account.id,
    displayName: account.displayName,
    maskedAccountNumber: account.maskedNumber,
    bankName: "Reference Bank",
    currency: "VND",
    beneficiaryId: beneficiary.id,
  });

  const output = {
    APP_ID: process.env.APP_ID ?? "com.example.digitalbanking.mobile",
    TEST_EMAIL: email,
    BENEFICIARY_ID: beneficiary.id,
    TRANSFER_AMOUNT_MINOR: transferAmount,
    QR_PAYLOAD: qrPayload,
    SEEDED_ACCOUNT_ID: account.id,
    SEEDED_TRANSFER_ID: transfer.transferId,
    SEEDED_TRANSFER_STATUS: transfer.status,
    SEEDED_SAVINGS_DEPOSIT_ID: savingsOpening.depositId ?? "",
    SEEDED_SAVINGS_STATUS: savingsOpening.status,
    CREDIT_CARD_ID: creditCard.cardId,
    CREDIT_ACCOUNT_ID: creditCard.creditAccountId,
    CREDIT_STATEMENT_ID: creditStatement.statementId,
    CREDIT_MINIMUM_AMOUNT_MINOR: creditStatement.minimumPaymentRemaining.amountMinor,
    API_BASE_URL: baseUrl,
  };

  console.log(JSON.stringify(output, null, 2));
  console.log("Secrets are not printed. Keep E2E_PASSWORD/E2E_REGISTRATION_CODE/E2E_TOTP_SECRET in the caller environment.");
  console.log("\nPowerShell variables:");
  for (const [key, value] of Object.entries(output)) {
    console.log(`$env:${key} = '${String(value).replaceAll("'", "''")}'`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
