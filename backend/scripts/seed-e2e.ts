import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import { generateTotp } from "../src/mfa/crypto.js";

type JsonRecord = Record<string, unknown>;

const baseUrl = (
  process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "5000"}/api/v1`
).replace(/\/+$/, "");
const email = process.env.E2E_EMAIL ?? "tester@example.com";
const password = process.env.E2E_PASSWORD?.trim();
const deviceId = process.env.E2E_DEVICE_ID ?? "e2e-device-android";
const registrationCode = process.env.E2E_REGISTRATION_CODE?.trim();
const totpSecret = process.env.E2E_TOTP_SECRET?.trim();
const explicitTotpCode = process.env.E2E_TOTP_CODE?.trim();
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
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Device-ID": deviceId,
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
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
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

async function getRegistrationCode(): Promise<string> {
  if (!registrationCode || !/^\d{6}$/.test(registrationCode)) {
    throw new Error(
      "E2E_REGISTRATION_CODE must be supplied by the configured email test provider; no sandbox OTP endpoint is available.",
    );
  }
  return registrationCode;
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
  let step = Math.floor(now / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - now + 250));
    now = Date.now();
    step = Math.floor(now / 30_000);
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
    const proof = await getRegistrationCode();
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
