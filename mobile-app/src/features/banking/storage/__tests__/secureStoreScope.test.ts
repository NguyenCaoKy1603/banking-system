import * as Crypto from "expo-crypto";

import { createSecureStoreScopedKey } from "@/features/banking/storage/secureStoreScope";

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(),
}));

const digestStringAsyncMock = jest.mocked(Crypto.digestStringAsync);

beforeEach(() => {
  digestStringAsyncMock.mockReset();
  digestStringAsyncMock.mockResolvedValue("abcdef0123456789");
});

describe("createSecureStoreScopedKey", () => {
  it("hashes normalized scope values into a key-safe suffix", async () => {
    await expect(
      createSecureStoreScopedKey("banking.intent.v2", " user-1 ", "card-1"),
    ).resolves.toBe("banking.intent.v2.abcdef0123456789");
    expect(digestStringAsyncMock).toHaveBeenCalledWith(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(["user-1", "card-1"]),
    );
  });

  it("rejects empty prefixes and scope parts", async () => {
    await expect(createSecureStoreScopedKey(" ", "user-1")).rejects.toThrow(
      TypeError,
    );
    await expect(createSecureStoreScopedKey("banking.intent.v2")).rejects.toThrow(
      TypeError,
    );
    await expect(
      createSecureStoreScopedKey("banking.intent.v2", " "),
    ).rejects.toThrow(TypeError);
    expect(digestStringAsyncMock).not.toHaveBeenCalled();
  });
});
