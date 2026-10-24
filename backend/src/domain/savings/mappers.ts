import type {
  SavingsDeposit,
  SavingsDepositRecord,
  SavingsOpening,
  SavingsOpeningRecord,
  SavingsQuote,
  SavingsQuoteRecord,
} from "./types.js";

export function cloneSavingsQuote(quote: SavingsQuoteRecord): SavingsQuoteRecord {
  return {
    ...quote,
    principal: { ...quote.principal },
    expectedInterest: { ...quote.expectedInterest },
    totalAtMaturity: { ...quote.totalAtMaturity },
  };
}

export function toPublicSavingsQuote(quote: SavingsQuoteRecord): SavingsQuote {
  const {
    userId: _userId,
    fingerprint: _fingerprint,
    consumedOpeningId: _consumedOpeningId,
    ...publicQuote
  } = cloneSavingsQuote(quote);
  return publicQuote;
}

export function cloneSavingsOpening(
  opening: SavingsOpeningRecord,
): SavingsOpeningRecord {
  return { ...opening };
}

export function toPublicSavingsOpening(opening: SavingsOpeningRecord): SavingsOpening {
  const { userId: _userId, idempotencyKey: _idempotencyKey, ...publicOpening } =
    cloneSavingsOpening(opening);
  return publicOpening;
}

export function cloneSavingsDeposit(
  deposit: SavingsDepositRecord,
): SavingsDepositRecord {
  return {
    ...deposit,
    principal: { ...deposit.principal },
    expectedInterest: { ...deposit.expectedInterest },
    totalAtMaturity: { ...deposit.totalAtMaturity },
  };
}

export function toPublicSavingsDeposit(deposit: SavingsDepositRecord): SavingsDeposit {
  const {
    userId: _userId,
    sourceAccountId: _sourceAccountId,
    openingId: _openingId,
    ...publicDeposit
  } = cloneSavingsDeposit(deposit);
  return publicDeposit;
}
