type FundingResponse = {
  fundingId: string;
  reference: string;
  status: string;
  amount: { currency: string; amountMinor: string };
  recipientMaskedAccountNumber: string;
  createdAt: string;
};

const baseUrl = (
  process.env.SANDBOX_API_URL ??
  `http://127.0.0.1:${process.env.PORT ?? "5000"}/api/v1`
).replace(/\/+$/, "");
const operatorKey = process.env.SANDBOX_OPERATOR_KEY?.trim();
const accountNumber = process.env.SANDBOX_ACCOUNT_NUMBER?.trim();
const amountMinor = process.env.SANDBOX_AMOUNT_MINOR?.trim() ?? "10000000";
const reason = process.env.SANDBOX_REASON?.trim() ?? "Cấp tiền kiểm thử";
const idempotencyKey =
  process.env.SANDBOX_FUNDING_IDEMPOTENCY_KEY?.trim() ??
  `sandbox-funding-${Date.now()}`;

if (!operatorKey || !accountNumber) {
  throw new Error(
    "Set SANDBOX_OPERATOR_KEY and SANDBOX_ACCOUNT_NUMBER in the caller environment.",
  );
}

const response = await fetch(`${baseUrl}/sandbox/fundings`, {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
    "X-Sandbox-Operator-Key": operatorKey,
  },
  body: JSON.stringify({
    recipientAccountNumber: accountNumber,
    amount: { currency: "VND", amountMinor },
    reason,
  }),
});
const body = await response.json().catch(() => null);
if (!response.ok) {
  throw new Error(`Sandbox Funding failed with HTTP ${response.status}.`);
}

const receipt = body as FundingResponse;
console.log(
  JSON.stringify(
    {
      fundingId: receipt.fundingId,
      reference: receipt.reference,
      status: receipt.status,
      amount: receipt.amount,
      recipientMaskedAccountNumber: receipt.recipientMaskedAccountNumber,
      createdAt: receipt.createdAt,
    },
    null,
    2,
  ),
);
console.log("Operator key and full account number are not printed.");
