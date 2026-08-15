import { requestJson } from "@/services/api/httpClient";

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
const originalFetch = globalThis.fetch;

function createJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function createApiErrorResponse(status = 401): Response {
  return createJsonResponse(
    {
      code: "UNAUTHORIZED",
      message: "Phiên không hợp lệ.",
      fieldErrors: null,
      traceId: "trace-id",
    },
    status,
  );
}

function createDeferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
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

describe("httpClient", () => {
  it("gửi Authorization, request ID và idempotency key", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ ok: true }));

    await expect(
      requestJson("/transfers", {
        method: "POST",
        body: { amountMinor: 1000 },
        auth: { accessToken: "access-token" },
        idempotencyKey: "transfer-key-1",
      }),
    ).resolves.toEqual({ ok: true });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request?.headers).toEqual(
      expect.objectContaining({
        Accept: "application/json",
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
        "Idempotency-Key": "transfer-key-1",
        "X-Request-ID": expect.any(String),
      }),
    );
    expect(request?.signal).toBeDefined();
  });

  it("trả lỗi timeout và hủy fetch khi quá thời gian", async () => {
    fetchMock.mockImplementation((_url, request) => {
      return new Promise<Response>((_resolve, reject) => {
        request?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });

    await expect(
      requestJson("/slow", { timeoutMs: 1 }),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      status: null,
    });
  });

  it("trả lỗi request aborted khi caller hủy request", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, request) => {
      return new Promise<Response>((_resolve, reject) => {
        request?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });

    const requestPromise = requestJson("/cancelled", {
      signal: controller.signal,
      timeoutMs: 1000,
    });
    controller.abort();

    await expect(requestPromise).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
      status: null,
    });
  });

  it("refresh token theo single-flight và retry request một lần", async () => {
    const refresh = createDeferred<string | null>();
    let fetchCount = 0;

    fetchMock.mockImplementation(async () => {
      fetchCount += 1;

      if (fetchCount <= 2) {
        return createApiErrorResponse();
      }

      return createJsonResponse({ ok: true });
    });

    const refreshAccessToken = jest.fn(() => refresh.promise);
    const firstRequest = requestJson("/accounts", {
      auth: { accessToken: "expired-token", refreshAccessToken },
    });
    const secondRequest = requestJson("/accounts", {
      auth: { accessToken: "expired-token", refreshAccessToken },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);

    refresh.resolve("fresh-token");

    await expect(firstRequest).resolves.toEqual({ ok: true });
    await expect(secondRequest).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer fresh-token" }),
    );
  });

  it("không retry 401 lần thứ hai sau khi refresh", async () => {
    fetchMock.mockResolvedValueOnce(createApiErrorResponse());
    fetchMock.mockResolvedValueOnce(createApiErrorResponse());
    const refreshAccessToken = jest.fn().mockResolvedValue("fresh-token");

    await expect(
      requestJson("/accounts", {
        auth: { accessToken: "expired-token", refreshAccessToken },
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
