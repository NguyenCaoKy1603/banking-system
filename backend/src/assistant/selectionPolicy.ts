import type { AnswerSelectionId } from "./responseCatalog.js";

export type DeterministicSelection = {
  selectionId: AnswerSelectionId;
  reason:
    | "totp-bypass-request"
    | "secret-sharing-question"
    | "prompt-disclosure-request"
    | "direct-action-request"
    | "ambiguous-unlock-request"
    | "account-unlock-request";
};

function normalizeQuestion(question: string): string {
  return question
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsTotpBypassRequest(text: string): boolean {
  const hasAuthenticator = /\b(?:totp|otp|authenticator|ma xac thuc|ma 6 so)\b/.test(text);
  if (!hasAuthenticator) return false;

  const negatedSafetyStatement = /\bkhong (?:nen|duoc|the) (?:bo qua|tat|vo hieu hoa)\b/.test(text);
  const directBypassVerb = /\b(?:bo qua|bo|skip|bypass|tat|vo hieu hoa|disable|remove)\b/.test(text);
  const unlockWithoutCode = /\b(?:mo khoa|unlock)\b/.test(text) && /\b(?:khong can|without|khong nhap)\b/.test(text);

  return (directBypassVerb && !negatedSafetyStatement) || unlockWithoutCode;
}

function containsPromptDisclosureRequest(text: string): boolean {
  const internalTarget = /\b(?:system prompt|prompt noi bo|prompt he thong|api key|chi dan noi bo)\b/.test(text);
  const disclosureVerb = /\b(?:in|tiet lo|cho xem|hien|show|reveal|print|display|export)\b/.test(text);
  return internalTarget && disclosureVerb;
}

function containsSecretSharingQuestion(text: string): boolean {
  const secret = /\b(?:otp|totp|ma xac thuc|mat khau|password|pin|cvv|ma khoi phuc|token)\b/.test(text);
  const sharing = /\b(?:gui|send|share|chia se|cung cap|cho ban|vao chat|kiem tra giup)\b/.test(text);
  return secret && sharing;
}

function containsDirectActionRequest(text: string): boolean {
  const action = "(?:chuyen tien|gui tien|mo khoa the|khoa the|thanh toan|gui giao dich)";
  const asksForInstructions = /\b(?:huong dan|chi toi cach|cach thuc hien|lam the nao de)\b/.test(text);
  const directPhrase = new RegExp(`\\b${action}\\s+(?:ho|giup toi|thay toi)\\b`).test(text)
    || new RegExp(`\\bgiup toi\\s+${action}\\b`).test(text)
    || /\b(?:do it|transfer money|unlock the card) for me\b/.test(text)
    || /\b(?:thuc hien|bam nut) (?:giup toi|ho|thay toi)\b/.test(text);
  const directTransferWithDetails = /\b(?:chuyen|gui)\b[\s\S]{0,80}\b(?:ho toi|thay toi|giup toi)\b/.test(text);
  return !asksForInstructions && (directPhrase || directTransferWithDetails);
}

function isCardMention(text: string): boolean {
  if (/\b(?:the atm|the tin dung|the ghi no|the ngan hang|the cua|card|debit|credit)\b/.test(text)) {
    return true;
  }
  if (/\b(?:mo\s+)?khoa\s+the\b(?!\s*nao)/.test(text)) {
    return true;
  }
  return /\bthe\b/.test(text) && !/\b(?:the nao|co the|nhu the)\b/.test(text);
}

function containsAmbiguousUnlockRequest(text: string): boolean {
  const hasUnlock = /\b(?:mo khoa|unlock)\b/.test(text);
  if (!hasUnlock) return false;
  if (isCardMention(text)) return false;
  const hasOtherTarget = /\b(?:tai khoan|dang nhap|phien|app|ung dung|dien thoai|van tay|faceid|mat ma|pin)\b/.test(text);
  return !hasOtherTarget;
}

function containsAccountUnlockRequest(text: string): boolean {
  if (isCardMention(text)) return false;
  const mentionsAccountOrLogin = /\b(?:tai khoan|dang nhap|phien|user|account|login)\b/.test(text);
  const mentionsLockOrUnlock = /\b(?:khoa|mo khoa|unlock|lock)\b/.test(text);
  return mentionsAccountOrLogin && mentionsLockOrUnlock && /\b(?:mo khoa|unlock|bi khoa|khoa dang nhap|khoa tai khoan|khoa phien)\b/.test(text);
}

/**
 * Narrow, intent-specific pre-routing for requests the model should not decide.
 * This is not a general prompt-injection detector; unmatched input still goes
 * through the closed-ID selector and can only resolve to catalog text.
 */
export function resolveDeterministicSelection(question: string): DeterministicSelection | undefined {
  const normalized = normalizeQuestion(question);
  if (containsTotpBypassRequest(normalized)) {
    return { selectionId: "TOTP_BYPASS", reason: "totp-bypass-request" };
  }
  if (containsSecretSharingQuestion(normalized)) {
    return { selectionId: "SECRET_PROTECTION", reason: "secret-sharing-question" };
  }
  if (containsPromptDisclosureRequest(normalized)) {
    return { selectionId: "OUT_OF_SCOPE", reason: "prompt-disclosure-request" };
  }
  if (containsDirectActionRequest(normalized)) {
    return { selectionId: "ACTION_REQUEST", reason: "direct-action-request" };
  }
  if (containsAmbiguousUnlockRequest(normalized)) {
    return { selectionId: "CLARIFY", reason: "ambiguous-unlock-request" };
  }
  if (containsAccountUnlockRequest(normalized)) {
    return { selectionId: "OUT_OF_SCOPE", reason: "account-unlock-request" };
  }
  return undefined;
}
