import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

const baseUrl = (
  process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "5000"}/api/v1`
).replace(/\/+$/, "");
const email = process.env.E2E_EMAIL ?? "tester@example.com";
const password = process.env.E2E_PASSWORD?.trim();
const deviceId = process.env.E2E_DEVICE_ID ?? "e2e-device-android";
const operatorKey = process.env.E2E_SANDBOX_OPERATOR_KEY ?? process.env.BANKING_SANDBOX_OPERATOR_KEY ?? "sandbox-operator-local";
const mfaOtp = process.env.E2E_MFA_OTP?.trim() ?? process.env.BANKING_SANDBOX_MFA_OTP?.trim();
const transferOtp = process.env.E2E_TRANSFER_OTP?.trim() ?? process.env.BANKING_SANDBOX_OTP?.trim();

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

async function getSandboxOtp(challengeId: string): Promise<string> {
  const result = await request(`/sandbox/otp/${encodeURIComponent(challengeId)}`, {
    headers: { "X-Sandbox-Operator-Key": operatorKey },
  });
  return requireBody<{ otp: string }>(result, "sandbox OTP").otp;
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
    // The reference backend uses BANKING_SANDBOX_OTP for registration verification.
    const proof = transferOtp ?? await getSandboxOtp(challenge.challengeId);
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
    const proof = mfaOtp ?? await getSandboxOtp(session.challengeId);
    session = requireBody<{ accessToken?: string }>(
      await request("/auth/verify", {
        method: "POST",
        body: json({ challengeId: session.challengeId, method: "OTP", proof }),
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

  const fullAccountNumber = requireBody<{ accountNumber: string }>(
    await request(`/accounts/${account.id}/number`, {}, accessToken),
    "account number",
  ).accountNumber;
  requireBody(
    await request("/sandbox/fundings", {
      method: "POST",
      headers: {
        "X-Sandbox-Operator-Key": operatorKey,
        "Idempotency-Key": `e2e-funding-${email}`,
      },
      body: json({
        recipientAccountNumber: fullAccountNumber,
        amount: { currency: "VND", amountMinor: process.env.E2E_FUNDING_AMOUNT_MINOR ?? "10000000" },
        reason: "E2E sandbox funding",
      }),
    }),
    "sandbox funding",
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
  const transferProof = transferOtp ?? await getSandboxOtp(transferChallengeId);
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
          stepUp: { method: "OTP", proof: transferProof, challengeId: transferChallengeId },
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
  const savingsProof = transferOtp ?? await getSandboxOtp(savingsChallengeId);
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
          stepUp: { method: "OTP", proof: savingsProof, challengeId: savingsChallengeId },
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
  const creditApplicationProof = transferOtp ?? await getSandboxOtp(creditApplicationChallengeId);
  const application = requireBody<{ applicationId: string; status: string }>(
    await request(
      "/credit/applications",
      {
        method: "POST",
        headers: { "Idempotency-Key": `e2e-credit-application-${email}` },
        body: json({
          requestedLimit: { currency: "VND", amountMinor: requestedLimitMinor },
          stepUp: { method: "OTP", proof: creditApplicationProof, challengeId: creditApplicationChallengeId },
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
  const creditActivationProof = transferOtp ?? await getSandboxOtp(creditActivationChallengeId);
  requireBody(
    await request(
      `/credit/applications/${application.applicationId}/activate`,
      {
        method: "POST",
        headers: { "Idempotency-Key": `e2e-credit-activation-${email}` },
        body: json({
          stepUp: { method: "OTP", proof: creditActivationProof, challengeId: creditActivationChallengeId },
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
  console.log("Secrets are not printed. Keep E2E_PASSWORD/E2E_MFA_OTP/E2E_TRANSFER_OTP in the caller environment.");
  console.log("\nPowerShell variables:");
  for (const [key, value] of Object.entries(output)) {
    console.log(`$env:${key} = '${String(value).replaceAll("'", "''")}'`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
