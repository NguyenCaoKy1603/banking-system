import { isRegistrationChallengeResponse } from "../authResponseValidators";

describe("isRegistrationChallengeResponse", () => {
  const expiresAt = "2030-01-01T00:00:00.000Z";

  it("accepts canonical registration challenge", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: ["EMAIL_OTP"],
        expiresAt,
      })
    ).toBe(true);
  });

  it("rejects empty methods array", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: [],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects OTP method", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: ["OTP"],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects TOTP method", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: ["TOTP"],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects BIOMETRIC method", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: ["BIOMETRIC"],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects multiple methods including EMAIL_OTP and OTP", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: ["EMAIL_OTP", "OTP"],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects multiple methods including EMAIL_OTP and BIOMETRIC", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: ["EMAIL_OTP", "BIOMETRIC"],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects duplicate EMAIL_OTP method", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: ["EMAIL_OTP", "EMAIL_OTP"],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects REGISTRATION_VERIFY alias", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "REGISTRATION_VERIFY",
        methods: ["EMAIL_OTP"],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects non-registration auth challenge", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: "chl_123",
        purpose: "LOGIN",
        methods: ["EMAIL_OTP"],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects invalid challengeId", () => {
    expect(
      isRegistrationChallengeResponse({
        challengeId: 123,
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: ["EMAIL_OTP"],
        expiresAt,
      })
    ).toBe(false);
  });

  it("rejects missing challengeId", () => {
    expect(
      isRegistrationChallengeResponse({
        purpose: "REGISTRATION_EMAIL_VERIFY",
        methods: ["EMAIL_OTP"],
        expiresAt,
      })
    ).toBe(false);
  });
});
