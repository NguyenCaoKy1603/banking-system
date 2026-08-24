import {
  getFraudReport,
  submitFraudReport,
} from "@/features/fraud/services/fraudReportsApi";

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
const originalFetch = globalThis.fetch;

function createJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

const report = {
  reportId: "report-1",
  status: "RECEIVED",
  createdAt: "2026-08-23T00:00:00.000Z",
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

describe("fraud reports API", () => {
  it("submits with a durable idempotency key and reads status by encoded ID", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(report, 201))
      .mockResolvedValueOnce(createJsonResponse(report));

    await submitFraudReport(
      {
        accountId: "account-1",
        transactionId: "transaction-1",
        reason: "Tôi không thực hiện giao dịch này",
      },
      {
        auth: { accessToken: "access-token", deviceId: "device-1" },
        idempotencyKey: "fraud-intent-1",
      },
    );
    await getFraudReport("report/1", {
      accessToken: "access-token",
      deviceId: "device-1",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://10.0.2.2:5000/api/v1/fraud-reports",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer access-token",
        "Idempotency-Key": "fraud-intent-1",
        "X-Device-ID": "device-1",
      }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://10.0.2.2:5000/api/v1/fraud-reports/report%2F1",
    );
  });

  it("fails before network when request or key is invalid", async () => {
    await expect(
      submitFraudReport(
        { accountId: "account-1", transactionId: "transaction-1", reason: "bad" },
        { auth: { accessToken: "access-token" }, idempotencyKey: "key-1" },
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      submitFraudReport(
        {
          accountId: "account-1",
          transactionId: "transaction-1",
          reason: "Valid reason",
        },
        { auth: { accessToken: "access-token" }, idempotencyKey: " " },
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      submitFraudReport(
        {
          accountId: "account-1",
          transactionId: "transaction-1",
          reason: "Valid reason",
        },
        { auth: { accessToken: "access-token" }, idempotencyKey: "short" },
      ),
    ).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
