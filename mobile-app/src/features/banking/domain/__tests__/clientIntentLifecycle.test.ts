import {
  canDiscardExpiredIntent,
  normalizeClientIntentLifecycle,
} from "@/features/banking/domain/clientIntentLifecycle";

describe("clientIntentLifecycle", () => {
  it("migrates a legacy draft that has never been submitted", () => {
    expect(normalizeClientIntentLifecycle({}, null)).toEqual({
      phase: "DRAFT_QUOTE",
      submitAttempted: false,
    });
  });

  it("migrates a legacy attempted submission without an operation id", () => {
    expect(
      normalizeClientIntentLifecycle({ submitAttempted: true }, null),
    ).toEqual({
      phase: "SUBMIT_UNKNOWN",
      submitAttempted: true,
    });
  });

  it("treats any persisted operation id as accepted", () => {
    expect(
      normalizeClientIntentLifecycle(
        { phase: "DRAFT_QUOTE", submitAttempted: false },
        "ACCEPTED_PENDING",
      ),
    ).toEqual({
      phase: "ACCEPTED_PENDING",
      submitAttempted: true,
    });
  });

  it("derives and migrates an accepted terminal operation", () => {
    expect(
      normalizeClientIntentLifecycle(
        { phase: "ACCEPTED_PENDING", submitAttempted: true },
        "ACCEPTED_TERMINAL",
      ),
    ).toEqual({
      phase: "ACCEPTED_TERMINAL",
      submitAttempted: true,
    });
  });

  it("only discards an expired intent before the first submit attempt", () => {
    expect(
      canDiscardExpiredIntent({
        phase: "DRAFT_QUOTE",
        submitAttempted: false,
      }),
    ).toBe(true);
    expect(
      canDiscardExpiredIntent({
        phase: "SUBMIT_UNKNOWN",
        submitAttempted: true,
      }),
    ).toBe(false);
    expect(
      canDiscardExpiredIntent({
        phase: "ACCEPTED_PENDING",
        submitAttempted: true,
      }),
    ).toBe(false);
    expect(
      canDiscardExpiredIntent({
        phase: "ACCEPTED_TERMINAL",
        submitAttempted: true,
      }),
    ).toBe(false);
  });

  it("rejects contradictory or unknown lifecycle data", () => {
    expect(
      normalizeClientIntentLifecycle(
        { phase: "DRAFT_QUOTE", submitAttempted: true },
        null,
      ),
    ).toBeNull();
    expect(
      normalizeClientIntentLifecycle(
        { phase: "TERMINAL", submitAttempted: true },
        null,
      ),
    ).toBeNull();
  });
});
