export type ClientIntentPhase =
  | "DRAFT_QUOTE"
  | "SUBMIT_UNKNOWN"
  | "ACCEPTED_PENDING"
  | "ACCEPTED_TERMINAL";

export type AcceptedClientIntentPhase = Extract<
  ClientIntentPhase,
  "ACCEPTED_PENDING" | "ACCEPTED_TERMINAL"
>;

export type ClientIntentLifecycle = {
  phase: ClientIntentPhase;
  submitAttempted: boolean;
};

function isClientIntentPhase(value: unknown): value is ClientIntentPhase {
  return (
    value === "DRAFT_QUOTE" ||
    value === "SUBMIT_UNKNOWN" ||
    value === "ACCEPTED_PENDING" ||
    value === "ACCEPTED_TERMINAL"
  );
}

export function normalizeClientIntentLifecycle(
  value: Record<string, unknown>,
  acceptedPhase: AcceptedClientIntentPhase | null,
): ClientIntentLifecycle | null {
  const storedPhase = value.phase;
  const storedSubmitAttempted = value.submitAttempted;

  if (storedPhase !== undefined && !isClientIntentPhase(storedPhase)) {
    return null;
  }

  if (
    storedSubmitAttempted !== undefined &&
    typeof storedSubmitAttempted !== "boolean"
  ) {
    return null;
  }

  if (acceptedPhase) {
    return { phase: acceptedPhase, submitAttempted: true };
  }

  const phase =
    storedPhase ??
    (storedSubmitAttempted === true ? "SUBMIT_UNKNOWN" : "DRAFT_QUOTE");
  const submitAttempted =
    storedSubmitAttempted ?? phase !== "DRAFT_QUOTE";

  if (
    (phase === "DRAFT_QUOTE" && submitAttempted) ||
    (phase !== "DRAFT_QUOTE" && !submitAttempted) ||
    phase === "ACCEPTED_PENDING" ||
    phase === "ACCEPTED_TERMINAL"
  ) {
    return null;
  }

  return { phase, submitAttempted };
}

export function canDiscardExpiredIntent(
  lifecycle: ClientIntentLifecycle,
): boolean {
  return lifecycle.phase === "DRAFT_QUOTE" && !lifecycle.submitAttempted;
}
