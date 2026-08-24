import {
  activateCreditApplication,
  getCreditPayment,
  listCreditStatements,
  listCreditTransactions,
  lockCreditCard,
  quoteCreditPayment,
  submitCreditApplication,
  submitCreditPayment,
  unlockCreditCard,
} from "@/features/credit/services/creditApi";

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
const originalFetch = globalThis.fetch;

const quote = {
  quoteId: "quote-1",
  sourceAccountId: "account-1",
  sourceAccountMaskedNumber: "•••• 0001",
  creditAccountId: "credit-account-1",
  cardLastFour: "2468",
  statementId: "statement-1",
  statementVersion: 1,
  paymentOption: "MINIMUM",
  amount: { currency: "VND", amountMinor: "200000" },
  fee: { currency: "VND", amountMinor: "0" },
  outstandingBefore: { currency: "VND", amountMinor: "4000000" },
  outstandingAfter: { currency: "VND", amountMinor: "3800000" },
  minimumPaymentRemainingBefore: { currency: "VND", amountMinor: "200000" },
  minimumPaymentRemainingAfter: { currency: "VND", amountMinor: "0" },
  terms: "Sandbox terms",
  expiresAt: "2099-08-24T17:05:00.000Z",
};

const payment = {
  paymentId: "payment-1",
  statementId: "statement-1",
  sourceAccountId: "account-1",
  amount: { currency: "VND", amountMinor: "200000" },
  reference: "CRD-1",
  status: "SUCCEEDED",
  failureReason: null,
  createdAt: "2026-08-24T17:00:00.000Z",
  updatedAt: "2026-08-24T17:00:00.000Z",
};
const cardResponse = {
  card: {
    cardId: "card-1",
    creditAccountId: "credit-account-1",
    displayName: "Credit sandbox",
    brand: "VISA",
    maskedNumber: "•••• 2468",
    lastFour: "2468",
    expiryMonth: 12,
    expiryYear: 30,
    status: "ACTIVE",
    updatedAt: "2026-08-24T17:00:00.000Z",
    creditLimit: { currency: "VND", amountMinor: "20000000" },
    availableCredit: { currency: "VND", amountMinor: "16000000" },
    postedOutstanding: { currency: "VND", amountMinor: "4000000" },
    pendingAuthorizations: { currency: "VND", amountMinor: "0" },
    nextDueAt: "2026-09-08T17:00:00.000Z",
    remainingAmountDue: { currency: "VND", amountMinor: "4000000" },
    minimumPaymentRemaining: { currency: "VND", amountMinor: "200000" },
    sandbox: true,
  },
};

function createJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

beforeAll(() => {
  globalThis.fetch = fetchMock as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("credit API services", () => {
  it("builds encoded transaction and statement list paths", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ items: [], nextCursor: "next" }))
      .mockResolvedValueOnce(createJsonResponse({ items: [], nextCursor: null }));

    await listCreditTransactions("credit/account", {
      auth: { accessToken: "access-token" },
      cursor: "next cursor",
      limit: 50,
    });
    await listCreditStatements("credit/account", {
      auth: { accessToken: "access-token" },
      limit: 20,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://10.0.2.2:5000/api/v1/credit/accounts/credit%2Faccount/transactions?cursor=next%20cursor&limit=50",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://10.0.2.2:5000/api/v1/credit/accounts/credit%2Faccount/statements?limit=20",
    );
  });

  it("uses explicit lock/unlock methods and sends step-up proof only on unlock", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(cardResponse))
      .mockResolvedValueOnce(createJsonResponse(cardResponse));

    await lockCreditCard("card/1", { accessToken: "access-token" });
    await unlockCreditCard(
      "card/1",
      { method: "OTP", proof: "opaque-proof" },
      { accessToken: "access-token" },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://10.0.2.2:5000/api/v1/cards/card%2F1/lock");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://10.0.2.2:5000/api/v1/cards/card%2F1/unlock");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ method: "OTP", proof: "opaque-proof" }),
    );
  });

  it("posts payment quote and receipt with idempotency key", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(quote))
      .mockResolvedValueOnce(createJsonResponse(payment))
      .mockResolvedValueOnce(createJsonResponse(payment));

    await quoteCreditPayment(
      {
        sourceAccountId: "account-1",
        creditAccountId: "credit-account-1",
        statementId: "statement-1",
        paymentOption: "MINIMUM",
      },
      { accessToken: "access-token" },
    );
    await submitCreditPayment(
      { quoteId: "quote-1", stepUp: { method: "OTP", proof: "opaque-proof" } },
      { auth: { accessToken: "access-token" }, idempotencyKey: "credit-intent-01" },
    );
    await getCreditPayment("payment-1", { accessToken: "access-token" });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        sourceAccountId: "account-1",
        creditAccountId: "credit-account-1",
        statementId: "statement-1",
        paymentOption: "MINIMUM",
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
      expect.objectContaining({ "Idempotency-Key": "credit-intent-01" }),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "http://10.0.2.2:5000/api/v1/credit/payments/payment-1",
    );
  });

  it("rejects invalid custom amount and short idempotency keys before network", () => {
    expect(() =>
      quoteCreditPayment(
        {
          sourceAccountId: "account-1",
          creditAccountId: "credit-account-1",
          statementId: "statement-1",
          paymentOption: "CUSTOM",
        },
        {},
      ),
    ).toThrow();
    expect(() =>
      submitCreditPayment(
        { quoteId: "quote-1", stepUp: { method: "OTP", proof: "opaque-proof" } },
        { auth: {}, idempotencyKey: "short-key" },
      ),
    ).toThrow("idempotencyKey phải có ít nhất 16 ký tự.");
    expect(() =>
      submitCreditApplication(
        { stepUp: { method: "OTP", proof: "opaque-proof" } },
        { auth: {}, idempotencyKey: "short" },
      ),
    ).toThrow("idempotencyKey phải có ít nhất 8 ký tự.");
    expect(() =>
      activateCreditApplication(
        "application-1",
        { method: "OTP", proof: "opaque-proof" },
        { auth: {}, idempotencyKey: "short" },
      ),
    ).toThrow("idempotencyKey phải có ít nhất 8 ký tự.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
