import {
  getAccountNumber,
  listAccounts,
  listTransactions,
} from "@/features/accounts/services/accountsApi";
import { submitSavingsOpening } from "@/features/savings/services/savingsApi";
import { quoteTransfer, submitTransfer } from "@/features/transfers/services/transfersApi";

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
const originalFetch = globalThis.fetch;

const beneficiary = {
  id: "beneficiary-1",
  displayName: "Người nhận",
  maskedAccountNumber: "•••• 9876",
  bankName: "Ngân hàng thử nghiệm",
  status: "ACTIVE",
};

function createJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

const account = {
  id: "account-1",
  displayName: "Tài khoản thanh toán",
  maskedNumber: "•••• 1234",
  bankName: "Ngân hàng reference",
  currency: "VND",
  availableBalance: { currency: "VND", amountMinor: "100000" },
  heldAmount: { currency: "VND", amountMinor: "0" },
  currentBalance: { currency: "VND", amountMinor: "100000" },
  status: "ACTIVE",
  updatedAt: "2026-08-14T00:00:00Z",
};

beforeAll(() => {
  globalThis.fetch = fetchMock as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("accounts/transfers API services", () => {
  it("reveals the full account number through a dedicated endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ accountNumber: "970400000001" }),
    );

    await expect(
      getAccountNumber("account/1", { accessToken: "access-token" }),
    ).resolves.toEqual({ accountNumber: "970400000001" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://10.0.2.2:5000/api/v1/accounts/account%2F1/number",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer access-token" }),
    );
  });
  it("gửi Authorization khi lấy accounts", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ accounts: [account] }),
    );

    await expect(
      listAccounts({ accessToken: "access-token" }),
    ).resolves.toEqual({ accounts: [account] });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://10.0.2.2:5000/api/v1/accounts",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer access-token" }),
    );
  });

  it("gửi cursor pagination cho transaction history", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ items: [], nextCursor: null }),
    );

    await listTransactions("account/1", {
      auth: { accessToken: "access-token" },
      cursor: "next cursor",
      limit: 50,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://10.0.2.2:5000/api/v1/accounts/account%2F1/transactions?cursor=next%20cursor&limit=50",
    );
  });

  it("gửi quote request bằng minor unit, không dùng floating point", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        quoteId: "quote-1",
        sourceAccountId: "account-1",
        beneficiary,
        amount: { currency: "VND", amountMinor: "100000" },
        fee: { currency: "VND", amountMinor: "1000" },
        totalDebit: { currency: "VND", amountMinor: "101000" },
        expiresAt: "2026-08-14T00:05:00Z",
      }),
    );

    await quoteTransfer(
      {
        sourceAccountId: "account-1",
        beneficiaryId: "beneficiary-1",
        amount: { currency: "VND", amountMinor: "100000" },
      },
      { accessToken: "access-token" },
    );

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body).toBe(
      JSON.stringify({
        sourceAccountId: "account-1",
        beneficiaryId: "beneficiary-1",
        amount: { currency: "VND", amountMinor: "100000" },
      }),
    );
  });

  it("gửi Idempotency-Key khi submit transfer", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        transferId: "transfer-1",
        reference: "REF-1",
        status: "PENDING",
        amount: { currency: "VND", amountMinor: "100000" },
        fee: { currency: "VND", amountMinor: "1000" },
        createdAt: "2026-08-14T00:00:00Z",
        updatedAt: "2026-08-14T00:00:00Z",
      }, 202),
    );

    await submitTransfer(
      {
        quoteId: "quote-1",
        stepUp: { method: "OTP", proof: "opaque-proof" },
      },
      {
        auth: { accessToken: "access-token" },
        idempotencyKey: "transfer-intent-1",
      },
    );

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer access-token",
        "Idempotency-Key": "transfer-intent-1",
      }),
    );
  });

  it("chặn submit khi idempotency key ngắn hơn contract hoặc thiếu step-up proof", () => {
    expect(() =>
      submitTransfer(
        { quoteId: "quote-1", stepUp: { method: "OTP", proof: "proof" } },
        { auth: {}, idempotencyKey: "short-key" },
      ),
    ).toThrow("idempotencyKey phải có ít nhất 16 ký tự.");
    expect(() =>
      submitSavingsOpening(
        {
          quoteId: "quote-1",
          stepUp: { method: "OTP", proof: "proof" },
        },
        { auth: {}, idempotencyKey: "short-key" },
      ),
    ).toThrow("idempotencyKey phải có ít nhất 16 ký tự.");
    expect(() =>
      submitTransfer(
        { quoteId: "quote-1", stepUp: { method: "OTP", proof: " " } },
        { auth: {}, idempotencyKey: "transfer-intent-1" },
      ),
    ).toThrow("stepUp.proof không được để trống.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
