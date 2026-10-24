import { cloneMoney } from "./calculations.js";
import type {
  CreditAccount,
  CreditCard,
  CreditPayment,
  CreditPaymentQuote,
  CreditStatement,
  CreditTransaction,
} from "./types.js";

function cloneTransaction(transaction: CreditTransaction): CreditTransaction {
  return { ...transaction, amount: cloneMoney(transaction.amount) };
}

export function cloneCreditStatement(statement: CreditStatement): CreditStatement {
  return {
    ...statement,
    openingBalance: cloneMoney(statement.openingBalance),
    purchaseTotal: cloneMoney(statement.purchaseTotal),
    refundTotal: cloneMoney(statement.refundTotal),
    feeTotal: cloneMoney(statement.feeTotal),
    interestTotal: cloneMoney(statement.interestTotal),
    closingBalance: cloneMoney(statement.closingBalance),
    remainingAmountDue: cloneMoney(statement.remainingAmountDue),
    minimumPaymentDue: cloneMoney(statement.minimumPaymentDue),
    minimumPaymentRemaining: cloneMoney(statement.minimumPaymentRemaining),
    paidAmount: cloneMoney(statement.paidAmount),
    items: statement.items.map(cloneTransaction),
    payments: statement.payments.map((payment) => ({
      ...payment,
      amount: cloneMoney(payment.amount),
    })),
  };
}

export function cloneCreditCard(card: CreditCard): CreditCard {
  return {
    ...card,
    creditLimit: cloneMoney(card.creditLimit),
    availableCredit: cloneMoney(card.availableCredit),
    postedOutstanding: cloneMoney(card.postedOutstanding),
    pendingAuthorizations: cloneMoney(card.pendingAuthorizations),
    remainingAmountDue: cloneMoney(card.remainingAmountDue),
    minimumPaymentRemaining: cloneMoney(card.minimumPaymentRemaining),
  };
}

export function cloneCreditAccount(account: CreditAccount): CreditAccount {
  return {
    ...account,
    creditLimit: cloneMoney(account.creditLimit),
    postedOutstanding: cloneMoney(account.postedOutstanding),
    pendingAuthorizations: cloneMoney(account.pendingAuthorizations),
    availableCredit: cloneMoney(account.availableCredit),
  };
}

export function cloneCreditTransaction(transaction: CreditTransaction): CreditTransaction {
  return cloneTransaction(transaction);
}

export function cloneCreditPayment(payment: CreditPayment): CreditPayment {
  return { ...payment, amount: cloneMoney(payment.amount) };
}

export function cloneCreditQuote(quote: CreditPaymentQuote): CreditPaymentQuote {
  return {
    ...quote,
    amount: cloneMoney(quote.amount),
    fee: cloneMoney(quote.fee),
    outstandingBefore: cloneMoney(quote.outstandingBefore),
    outstandingAfter: cloneMoney(quote.outstandingAfter),
    minimumPaymentRemainingBefore: cloneMoney(quote.minimumPaymentRemainingBefore),
    minimumPaymentRemainingAfter: cloneMoney(quote.minimumPaymentRemainingAfter),
  };
}
