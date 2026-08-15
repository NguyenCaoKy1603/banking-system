import {
  login,
  refreshSession,
  revokeAllSessions,
  register,
  revokeSession,
  verifyLoginChallenge,
} from "@/features/auth/services/authApi";
import type {
  AuthUser,
  AuthChallengeResponse,
  LoginRequest,
  LoginResponse,
  RegisterFormValues,
  RegisterRequest,
  RegisterResponse,
} from "@/features/auth/types/auth";
import { ApiError } from "@/services/api/ApiError";

const API_BASE_URL = "http://10.0.2.2:5000/api/v1";

const authUser: AuthUser = {
  id: "user-id",
  fullName: "Người Dùng Thử",
  email: "tester@example.com",
  phoneNumber: "0912345678",
  createdAt: "2026-01-01T00:00:00Z",
};

const loginRequest: LoginRequest = {
  email: "tester@example.com",
  password: "Password1",
};

const registerFormValues: RegisterFormValues = {
  fullName: authUser.fullName,
  email: authUser.email,
  phoneNumber: authUser.phoneNumber,
  password: "Password1",
  confirmPassword: "Password1",
};

const registerRequestBody: RegisterRequest = {
  fullName: registerFormValues.fullName,
  email: registerFormValues.email,
  phoneNumber: registerFormValues.phoneNumber,
  password: registerFormValues.password,
};

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
const originalFetch = globalThis.fetch;

function createJsonResponse(payload: unknown, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function createInvalidJsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockRejectedValue(new SyntaxError("Invalid JSON")),
  } as unknown as Response;
}

async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApiError);

    if (error instanceof ApiError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected promise to reject with ApiError");
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

describe("authApi", () => {
  it("refreshes a rotated token pair", async () => {
    const response: LoginResponse = {
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
      expiresInSeconds: 900,
      user: authUser,
    };
    fetchMock.mockResolvedValueOnce(createJsonResponse(response, 200));

    await expect(refreshSession("refresh-token")).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/refresh`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      }),
    );
  });

  it("sends the device binding header when configured", async () => {
    const response: LoginResponse = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresInSeconds: 900,
      user: authUser,
    };
    fetchMock.mockResolvedValueOnce(createJsonResponse(response, 200));

    await login(loginRequest, {
      deviceId: "00000000-0000-4000-8000-000000000001",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/login`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Device-ID": "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
  });

  it("accepts a server-driven MFA challenge and verifies it", async () => {
    const challenge: AuthChallengeResponse = {
      challengeId: "challenge-1",
      expiresAt: "2026-08-14T00:05:00Z",
      methods: ["OTP"],
    };
    fetchMock.mockResolvedValueOnce(createJsonResponse(challenge, 202));

    await expect(login(loginRequest)).resolves.toEqual(challenge);

    const response: LoginResponse = {
      accessToken: "access-token-mfa",
      refreshToken: "refresh-token-mfa",
      expiresInSeconds: 900,
      user: authUser,
    };
    fetchMock.mockResolvedValueOnce(createJsonResponse(response, 200));

    await expect(
      verifyLoginChallenge({
        challengeId: "challenge-1",
        method: "OTP",
        proof: "654321",
      }),
    ).resolves.toEqual(response);
  });

  it("accepts a 204 response when revoking a session", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(null, 204));

    await expect(revokeSession("refresh-token")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/logout`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      }),
    );
  });

  it("revokes all sessions using the authenticated device-bound session", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(null, 204));

    await expect(
      revokeAllSessions({
        accessToken: "access-token",
        deviceId: "device-1",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/logout-all`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          "X-Device-ID": "device-1",
        }),
      }),
    );
  });

  it("rejects empty refresh tokens before making a request", async () => {
    await expect(refreshSession(" ")).rejects.toThrow(TypeError);
    await expect(revokeSession(" ")).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gửi request đăng nhập đến đúng URL với method, header và body JSON", async () => {
    const response: LoginResponse = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresInSeconds: 900,
      user: authUser,
    };
    fetchMock.mockResolvedValueOnce(createJsonResponse(response, 200));

    await login(loginRequest);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/login`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Request-ID": expect.any(String),
        }),
        body: JSON.stringify(loginRequest),
        signal: expect.anything(),
      }),
    );
  });

  it("gửi request đăng ký đúng URL và không gửi confirmPassword", async () => {
    const response: RegisterResponse = { user: authUser };
    fetchMock.mockResolvedValueOnce(createJsonResponse(response, 201));

    await register(registerFormValues);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/register`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Request-ID": expect.any(String),
        }),
        body: JSON.stringify(registerRequestBody),
        signal: expect.anything(),
      }),
    );

    const requestOptions = fetchMock.mock.calls[0]?.[1];
    expect(typeof requestOptions?.body).toBe("string");

    if (typeof requestOptions?.body !== "string") {
      throw new Error("Expected a serialized JSON request body");
    }

    const parsedBody: unknown = JSON.parse(requestOptions.body);
    expect(parsedBody).toEqual(registerRequestBody);
    expect(parsedBody).not.toHaveProperty("confirmPassword");
  });

  it("parse response đăng nhập thành công", async () => {
    const response: LoginResponse = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresInSeconds: 900,
      user: authUser,
    };
    fetchMock.mockResolvedValueOnce(createJsonResponse(response, 200));

    await expect(login(loginRequest)).resolves.toEqual(response);
  });

  it("parse response đăng ký thành công", async () => {
    const response: RegisterResponse = { user: authUser };
    fetchMock.mockResolvedValueOnce(createJsonResponse(response, 201));

    await expect(register(registerFormValues)).resolves.toEqual(response);
  });

  it("từ chối HTTP 200 có JSON sai schema LoginResponse", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ user: authUser }, 200),
    );

    const error = await expectApiError(login(loginRequest));

    expect(error).toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
      message: "Phản hồi từ máy chủ không đúng định dạng mong đợi.",
    });
  });

  it.each([
    ["token rỗng", { accessToken: "" }],
    ["refresh token rỗng", { refreshToken: "" }],
    ["expiry bằng 0", { expiresInSeconds: 0 }],
    ["expiry âm", { expiresInSeconds: -1 }],
  ])("từ chối LoginResponse có %s", async (_caseName, override) => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(
        {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresInSeconds: 900,
          user: authUser,
          ...override,
        },
        200,
      ),
    );

    const error = await expectApiError(login(loginRequest));

    expect(error).toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
  });

  it.each([
    ["id user rỗng", { id: "" }],
    ["email user sai định dạng", { email: "invalid-email" }],
    ["thời gian user không hợp lệ", { createdAt: "not-a-date" }],
  ])("từ chối LoginResponse có %s", async (_caseName, userOverride) => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(
        {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresInSeconds: 900,
          user: { ...authUser, ...userOverride },
        },
        200,
      ),
    );

    const error = await expectApiError(login(loginRequest));

    expect(error).toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
  });

  it("từ chối HTTP 201 có JSON sai schema RegisterResponse", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ user: { id: authUser.id } }, 201),
    );

    const error = await expectApiError(register(registerFormValues));

    expect(error).toMatchObject({
      status: 201,
      code: "INVALID_RESPONSE",
      message: "Phản hồi từ máy chủ không đúng định dạng mong đợi.",
    });
  });

  it("chuẩn hóa lỗi đăng nhập 401", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(
        {
          code: "INVALID_CREDENTIALS",
          message: "Thông tin đăng nhập không hợp lệ.",
          fieldErrors: null,
          traceId: "trace-401",
        },
        401,
      ),
    );

    const error = await expectApiError(login(loginRequest));

    expect(error).toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      fieldErrors: null,
      traceId: "trace-401",
    });
  });

  it("chuẩn hóa lỗi đăng ký 409 có fieldErrors", async () => {
    const fieldErrors = { email: "Email đã tồn tại." };
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(
        {
          code: "ACCOUNT_CONFLICT",
          message: "Thông tin đăng ký đã tồn tại.",
          fieldErrors,
          traceId: "trace-409",
        },
        409,
      ),
    );

    const error = await expectApiError(register(registerFormValues));

    expect(error).toMatchObject({
      status: 409,
      code: "ACCOUNT_CONFLICT",
      fieldErrors,
      traceId: "trace-409",
    });
  });

  it("trả INVALID_RESPONSE khi error JSON thiếu schema bắt buộc", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ fieldErrors: null }, 422),
    );

    const error = await expectApiError(register(registerFormValues));

    expect(error).toMatchObject({
      status: 422,
      code: "INVALID_RESPONSE",
      message: "Phản hồi từ máy chủ không đúng định dạng mong đợi.",
    });
  });

  it("trả INVALID_RESPONSE khi response lỗi không phải JSON", async () => {
    fetchMock.mockResolvedValueOnce(createInvalidJsonResponse(500));

    const error = await expectApiError(login(loginRequest));

    expect(error).toMatchObject({
      status: 500,
      code: "INVALID_RESPONSE",
      fieldErrors: null,
      traceId: null,
    });
  });

  it("trả INVALID_RESPONSE khi response thành công có JSON không hợp lệ", async () => {
    fetchMock.mockResolvedValueOnce(createInvalidJsonResponse(200));

    const error = await expectApiError(login(loginRequest));

    expect(error).toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
  });

  it("trả NETWORK_ERROR khi fetch thất bại", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));

    const error = await expectApiError(login(loginRequest));

    expect(error).toMatchObject({
      status: null,
      code: "NETWORK_ERROR",
      fieldErrors: null,
      traceId: null,
    });
  });

  it("không thay thế ApiError đã được chuẩn hóa", async () => {
    const normalizedError = new ApiError({
      status: 429,
      code: "RATE_LIMITED",
      message: "Quá nhiều yêu cầu.",
      traceId: "trace-429",
    });
    fetchMock.mockRejectedValueOnce(normalizedError);

    await expect(login(loginRequest)).rejects.toBe(normalizedError);
  });
});
