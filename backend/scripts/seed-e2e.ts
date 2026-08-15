type JsonRecord = Record<string, unknown>;

const baseUrl = (
  process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "5000"}/api/v1`
).replace(/\/+$/, "");
const email = process.env.E2E_EMAIL ?? "tester@example.com";
const password = process.env.E2E_PASSWORD?.trim();
const deviceId = process.env.E2E_DEVICE_ID ?? "e2e-device-android";
const mfaOtp = process.env.E2E_MFA_OTP ?? process.env.BANKING_SANDBOX_MFA_OTP;
const transferOtp = process.env.E2E_TRANSFER_OTP ?? process.env.BANKING_SANDBOX_OTP;

if (!password) {
  throw new Error(
    "E2E_PASSWORD is required; do not put test credentials in the repository.",
  );
}

if (!mfaOtp || !transferOtp) {
  throw new Error(
    "Set E2E_MFA_OTP/E2E_TRANSFER_OTP or the BANKING_SANDBOX_* equivalents.",
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

async function main(): Promise<void> {
  const register = await request("/auth/register", {
    method: "POST",
    body: json({
      fullName: "E2E Tester",
      email,
      phoneNumber: process.env.E2E_PHONE ?? "0900000099",
      password,
    }),
  });
  if (register.status !== 201 && register.status !== 409) {
    requireBody(register, "register");
  }

  const login = await request("/auth/login", {
    method: "POST",
    body: json({ email, password }),
  });

  let session = requireBody<{
    accessToken?: string;
    challengeId?: string;
  }>(login, "login");

  if (login.status === 202) {
    if (!session.challengeId) {
      throw new Error("Login returned MFA status without challengeId.");
    }
    const verified = await request("/auth/verify", {
      method: "POST",
      body: json({
        challengeId: session.challengeId,
        method: "OTP",
        proof: mfaOtp,
      }),
    });
    session = requireBody<{ accessToken?: string }>(verified, "MFA verification");
  }

  if (!session.accessToken) {
    throw new Error("Login did not return an access token.");
  }

  const accessToken = session.accessToken;
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
            accountNumber: process.env.E2E_BENEFICIARY_ACCOUNT ?? "987654321012",
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
          stepUp: { method: "OTP", proof: transferOtp },
        }),
      },
      accessToken,
    ),
    "seed transfer",
  );

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
