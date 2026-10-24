import { idempotencyKey, isIndeterminateError, type ApiError } from "../../api.ts";

export type IntentTargetType = "ACCOUNT" | "CUSTOMER";
export type IntentStatus =
  | "DRAFT"
  | "REVIEWING"
  | "SUBMITTING"
  | "INDETERMINATE"
  | "SUCCEEDED"
  | "FAILED";

export interface SessionScope {
  staffId: string;
  generation: number;
}

let activeSessionScope: SessionScope | null = null;
let sessionGenerationCounter = 0;

export function getActiveSessionScope(): SessionScope | null {
  return activeSessionScope ? { ...activeSessionScope } : null;
}

export function isSessionScopeActive(scope: SessionScope | null | undefined): boolean {
  if (!scope || !activeSessionScope) return false;
  return scope.staffId === activeSessionScope.staffId && scope.generation === activeSessionScope.generation;
}

export interface ActionIntent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  targetType: IntentTargetType;
  targetId: string;
  targetLabel: string;
  kind: string;
  path: string;
  method: "POST";
  payload: TPayload;
  idempotencyKey: string;
  status: IntentStatus;
  error: ApiError | null;
  result: { actionId?: string; action?: { id: string } } | null;
  createdAt: number;
  submittedAt?: number;
  staffId?: string;
  hasBeenIndeterminate?: boolean;
  sessionScope?: SessionScope;
}

/**
 * Creates a fresh ActionIntent in DRAFT status with a new unique idempotency key.
 */
export function createActionIntent<TPayload extends Record<string, unknown>>(params: {
  targetType: IntentTargetType;
  targetId: string;
  targetLabel: string;
  kind: string;
  path: string;
  payload: TPayload;
  prefix?: string;
  staffId?: string;
  sessionScope?: SessionScope | null;
}): ActionIntent<TPayload> {
  const prefix = params.prefix ?? `${params.targetType.toLowerCase()}-${params.kind.toLowerCase()}`;
  const resolvedScope =
    params.sessionScope ??
    (params.staffId && activeSessionScope && activeSessionScope.staffId === params.staffId
      ? activeSessionScope
      : undefined);
  return {
    id: crypto.randomUUID(),
    targetType: params.targetType,
    targetId: params.targetId,
    targetLabel: params.targetLabel,
    kind: params.kind,
    path: params.path,
    method: "POST",
    payload: { ...params.payload },
    idempotencyKey: idempotencyKey(prefix),
    status: "DRAFT",
    error: null,
    result: null,
    createdAt: Date.now(),
    staffId: params.staffId ?? resolvedScope?.staffId,
    sessionScope: resolvedScope ? { ...resolvedScope } : undefined,
  };
}

/**
 * Normalizes string records by trimming whitespace and stripping empty/undefined values.
 */
export function normalizePayload<T extends Record<string, unknown>>(payload: T): T {
  const normalized = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string") {
      normalized[k] = v.trim();
    } else {
      normalized[k] = v;
    }
  }
  return normalized as T;
}

/**
 * Checks if two payloads are functionally equivalent after normalization.
 */
export function arePayloadsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const normA = normalizePayload(a);
  const normB = normalizePayload(b);
  const keysA = Object.keys(normA);
  const keysB = Object.keys(normB);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => normA[k] === normB[k]);
}

/**
 * Updates the intent payload.
 * - If status is INDETERMINATE: Modifying payload is strictly rejected to prevent sending
 *   a modified payload with an old or compromised idempotency key.
 * - If status is REVIEWING or FAILED and payload changed: resets status to DRAFT and regenerates a fresh key.
 * - If status is DRAFT: updates payload; if normalized values changed, a new key is allocated.
 */
export function updateIntentPayload<TPayload extends Record<string, unknown>>(
  intent: ActionIntent<TPayload>,
  newPayload: TPayload,
  prefix?: string
): ActionIntent<TPayload> {
  if (intent.status === "INDETERMINATE") {
    // Cannot silently modify payload of an indeterminate intent awaiting reconciliation
    return intent;
  }

  const isChanged = !arePayloadsEqual(intent.payload, newPayload);
  if (!isChanged) {
    return {
      ...intent,
      payload: newPayload,
    };
  }

  // Modifying form fields changes the intent payload:
  // Must regenerate a fresh idempotency key and return to DRAFT so user must review again!
  const keyPrefix = prefix ?? `${intent.targetType.toLowerCase()}-${intent.kind.toLowerCase()}`;
  return {
    ...intent,
    payload: newPayload,
    idempotencyKey: idempotencyKey(keyPrefix),
    status: "DRAFT",
    error: null,
  };
}

/**
 * Advances intent to REVIEWING status with normalized snapshot.
 */
export function enterReviewStep<TPayload extends Record<string, unknown>>(
  intent: ActionIntent<TPayload>,
  normalizedPayload?: TPayload
): ActionIntent<TPayload> {
  if (intent.status === "SUBMITTING" || intent.status === "INDETERMINATE") {
    return intent;
  }
  return {
    ...intent,
    payload: normalizedPayload ? normalizePayload(normalizedPayload) : normalizePayload(intent.payload),
    status: "REVIEWING",
    error: null,
  };
}

/**
 * Returns to DRAFT from REVIEWING or FAILED.
 * Notice: Cannot be called when status is INDETERMINATE (must explicitly discard if reconciled).
 */
export function backToEditStep<TPayload extends Record<string, unknown>>(
  intent: ActionIntent<TPayload>
): ActionIntent<TPayload> {
  if (intent.status === "INDETERMINATE") {
    // When indeterminate, 'Back to edit' cannot silently clear warning or payload
    return intent;
  }
  return {
    ...intent,
    status: "DRAFT",
    error: null,
  };
}

/**
 * Transitions intent to SUBMITTING status before initiating API call.
 */
export function startIntentSubmit<TPayload extends Record<string, unknown>>(
  intent: ActionIntent<TPayload>
): ActionIntent<TPayload> {
  return {
    ...intent,
    status: "SUBMITTING",
    submittedAt: Date.now(),
    hasBeenIndeterminate: intent.status === "INDETERMINATE" || Boolean(intent.hasBeenIndeterminate),
  };
}

/**
 * Validates that an API mutating response contains an action ID.
 */
export function isValidActionResponse(
  result: unknown
): result is { action: { id: string } } | { actionId: string } {
  if (!result || typeof result !== "object") return false;
  const res = result as Record<string, unknown>;
  if (typeof res.actionId === "string" && res.actionId.trim().length > 0) return true;
  if (res.action && typeof res.action === "object") {
    const act = res.action as Record<string, unknown>;
    return typeof act.id === "string" && act.id.trim().length > 0;
  }
  return false;
}

/**
 * Transitions intent to SUCCEEDED after successful server response.
 * Throws INVALID_RESPONSE if server returned an empty or malformed body lacking an action ID.
 */
export function resolveIntentSuccess<TPayload extends Record<string, unknown>>(
  intent: ActionIntent<TPayload>,
  result: { actionId?: string; action?: { id: string } }
): ActionIntent<TPayload> {
  if (!isValidActionResponse(result)) {
    throw {
      status: 502,
      code: "INVALID_RESPONSE",
      message: "Phản hồi máy chủ thiếu action ID hợp lệ.",
      isNetworkOrTimeout: true,
    } as ApiError;
  }
  return {
    ...intent,
    status: "SUCCEEDED",
    result,
    error: null,
  };
}

/**
 * Transitions intent to INDETERMINATE or FAILED based on error semantics.
 * CRITICAL:
 * - On indeterminate error, idempotencyKey and normalized payload snapshot MUST BE PRESERVED.
 * - If an intent that was INDETERMINATE (or retrying) encounters IDEMPOTENCY_CONFLICT,
 *   ACCOUNT_STATUS_CONFLICT, or 409, it MUST REMAIN INDETERMINATE with reconciliation details,
 *   and NOT transition to FAILED (which would allow silent payload modification and key rotation).
 */
export function resolveIntentFailure<TPayload extends Record<string, unknown>>(
  intent: ActionIntent<TPayload>,
  error: ApiError
): ActionIntent<TPayload> {
  const isIndeterminate = isIndeterminateError(error);
  const wasIndeterminate = intent.status === "INDETERMINATE" || Boolean(intent.hasBeenIndeterminate);
  const isConflictOnRetry =
    error.code === "IDEMPOTENCY_CONFLICT" ||
    error.code === "ACCOUNT_STATUS_CONFLICT" ||
    error.status === 409;

  if (isIndeterminate || (wasIndeterminate && isConflictOnRetry)) {
    return {
      ...intent,
      status: "INDETERMINATE",
      hasBeenIndeterminate: true,
      error: {
        ...error,
        message:
          error.code === "IDEMPOTENCY_CONFLICT"
            ? "Phát hiện xung đột khóa xử lý (IDEMPOTENCY_CONFLICT). Yêu cầu trước đó có thể đã được máy chủ tiếp nhận hoặc xử lý. Vui lòng đối soát trong Approval Inbox thay vì đổi nội dung và tạo yêu cầu mới."
            : error.message,
      },
    };
  }

  return {
    ...intent,
    status: "FAILED",
    error,
  };
}

/**
 * Explicitly discards an indeterminate intent after reconciliation.
 */
export function discardIntent<TPayload extends Record<string, unknown>>(
  intent: ActionIntent<TPayload>,
  prefix?: string
): ActionIntent<TPayload> {
  const keyPrefix = prefix ?? `${intent.targetType.toLowerCase()}-${intent.kind.toLowerCase()}`;
  return {
    ...intent,
    status: "DRAFT",
    idempotencyKey: idempotencyKey(keyPrefix),
    error: null,
    result: null,
    hasBeenIndeterminate: false,
  };
}

// --- In-Memory Session Pending Intent Store (survives tab switches within session) ---
const sessionPendingIntents = new Map<string, ActionIntent>();
const sessionListeners = new Set<(intents: Map<string, ActionIntent>) => void>();

function notifySessionListeners(): void {
  const snapshot = activeSessionScope ? getSessionPendingIntents(activeSessionScope) : new Map<string, ActionIntent>();
  for (const listener of sessionListeners) {
    listener(new Map(snapshot));
  }
}

/**
 * Initiates a new session scope generation for a staff member.
 * Automatically clears previous session's pending intents so stale callbacks cannot leak.
 */
export function startNewSessionScope(staffId: string): SessionScope {
  sessionGenerationCounter += 1;
  activeSessionScope = {
    staffId,
    generation: sessionGenerationCounter,
  };
  sessionPendingIntents.clear();
  notifySessionListeners();
  return { ...activeSessionScope };
}

/**
 * Explicitly invalidates the active session scope and clears all pending intents.
 * Called immediately on logout or session expiration.
 */
export function invalidateSessionScope(): void {
  activeSessionScope = null;
  sessionPendingIntents.clear();
  notifySessionListeners();
}

/**
 * Retrieves the pending intents belonging to the specified session scope.
 * If scope is missing or inactive, safely returns an empty map.
 */
export function getSessionPendingIntents(scope?: SessionScope | null): Map<string, ActionIntent> {
  if (!scope || !isSessionScopeActive(scope)) {
    return new Map();
  }
  const result = new Map<string, ActionIntent>();
  for (const [k, v] of sessionPendingIntents.entries()) {
    if (v.sessionScope && isSessionScopeActive(v.sessionScope)) {
      result.set(k, v);
    }
  }
  return result;
}

/**
 * Retrieves an intent by key, ensuring it strictly matches the active session scope.
 */
export function getSessionPendingIntent(
  key: string,
  scopeOrStaffId?: SessionScope | string | null
): ActionIntent | undefined {
  if (!scopeOrStaffId) return undefined;

  let targetStaffId: string;
  if (typeof scopeOrStaffId === "string") {
    if (!activeSessionScope || activeSessionScope.staffId !== scopeOrStaffId) {
      return undefined;
    }
    targetStaffId = scopeOrStaffId;
  } else {
    if (!isSessionScopeActive(scopeOrStaffId)) {
      return undefined;
    }
    targetStaffId = scopeOrStaffId.staffId;
  }

  const intent = sessionPendingIntents.get(key);
  if (!intent) return undefined;
  if (intent.sessionScope && !isSessionScopeActive(intent.sessionScope)) {
    return undefined;
  }
  if (intent.staffId && intent.staffId !== targetStaffId) {
    return undefined;
  }
  return intent;
}

/**
 * Sets or deletes an intent in the session store.
 * Rejects operations if the provided scope is no longer active (guarding against late callbacks).
 * For deletions, verifies expectedIntentId if supplied to avoid deleting replacement intents.
 */
export function setSessionPendingIntent(
  key: string,
  intent: ActionIntent | null,
  scopeOrStaffId?: SessionScope | string | null,
  expectedIntentId?: string
): boolean {
  if (!scopeOrStaffId) return false;

  let targetScope: SessionScope;
  if (typeof scopeOrStaffId === "string") {
    if (!activeSessionScope || activeSessionScope.staffId !== scopeOrStaffId) {
      return false;
    }
    targetScope = activeSessionScope;
  } else {
    if (!isSessionScopeActive(scopeOrStaffId)) {
      return false;
    }
    targetScope = scopeOrStaffId;
  }

  if (!intent) {
    // Delete case
    if (expectedIntentId) {
      const existing = sessionPendingIntents.get(key);
      if (existing && existing.id !== expectedIntentId) {
        return false;
      }
    }
    sessionPendingIntents.delete(key);
  } else {
    const withScope: ActionIntent = {
      ...intent,
      staffId: targetScope.staffId,
      sessionScope: targetScope,
    };
    sessionPendingIntents.set(key, withScope);
  }
  notifySessionListeners();
  return true;
}

export function clearSessionPendingIntents(): void {
  sessionPendingIntents.clear();
  notifySessionListeners();
}

export function subscribeSessionPendingIntents(
  listener: (intents: Map<string, ActionIntent>) => void
): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}
