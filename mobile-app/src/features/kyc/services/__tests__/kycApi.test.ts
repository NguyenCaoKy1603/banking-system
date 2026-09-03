import {
  saveKycDraft,
  submitKycApplication,
} from "@/features/kyc/services/kycApi";

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
const originalFetch = globalThis.fetch;

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const draft = {
  fullName: "Synthetic Applicant",
  identityNumber: "123456789012",
  address: "Synthetic address fixture",
  documentUri: "mock://identity-card-front",
  syntheticDataConfirmed: true,
};

const response = {
  application: {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    fullName: draft.fullName,
    identityNumberLast4: "9012",
    address: draft.address,
    documentUri: draft.documentUri,
    status: "DRAFT",
    rejectionReason: null,
    submittedAt: null,
    updatedAt: "2026-09-02T00:00:00.000Z",
    version: 1,
  },
};

const auth = { accessToken: "<redacted>", deviceId: "<redacted>" };

function requestBody(callIndex = 0): Record<string, unknown> {
  const options = fetchMock.mock.calls[callIndex]?.[1];
  return JSON.parse(String(options?.body)) as Record<string, unknown>;
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

describe("KYC API request contract", () => {
  it("sends the full identity when creating or explicitly changing identity", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(response));

    await saveKycDraft(draft, auth, { includeIdentityNumber: true });

    const body = requestBody();
    expect(Object.prototype.hasOwnProperty.call(body, "identityNumber")).toBe(true);
    expect(/^\d{6,24}$/.test(String(body.identityNumber))).toBe(true);
  });

  it("omits identityNumber completely when an existing identity is unchanged", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(response));

    await submitKycApplication({ ...draft, identityNumber: "9012" }, auth, { includeIdentityNumber: false });

    const body = requestBody();
    expect(Object.prototype.hasOwnProperty.call(body, "identityNumber")).toBe(false);
    expect(body).toEqual(expect.objectContaining({
      fullName: draft.fullName,
      address: draft.address,
      documentUri: draft.documentUri,
      syntheticDataConfirmed: true,
    }));
  });

  it("omits identityNumber when draft has empty or whitespace identity", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(response));

    await saveKycDraft({ ...draft, identityNumber: "" }, auth, { includeIdentityNumber: true });

    const body = requestBody();
    expect(Object.prototype.hasOwnProperty.call(body, "identityNumber")).toBe(false);
  });

  it("omits identityNumber when draft contains a masked identity value", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(response));

    await saveKycDraft({ ...draft, identityNumber: "••••9012" }, auth, { includeIdentityNumber: true });

    const body = requestBody();
    expect(Object.prototype.hasOwnProperty.call(body, "identityNumber")).toBe(false);
  });
});
