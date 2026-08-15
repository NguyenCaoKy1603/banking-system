import {
  isBeneficiariesResponse,
  isBeneficiaryResponse,
  isTransferQuote,
  isTransferReceipt,
} from "@/features/transfers/validation/transferResponseValidators";

const beneficiary = {
  id: "beneficiary-1",
  displayName: "Người nhận",
  maskedAccountNumber: "•••• 9876",
  bankName: "Ngân hàng thử nghiệm",
  status: "ACTIVE" as const,
};

const money = {
  currency: "VND" as const,
  amountMinor: "100000",
};

describe("transfer response validators", () => {
  it("validate beneficiary response", () => {
    expect(isBeneficiaryResponse({ beneficiary })).toBe(true);
    expect(isBeneficiariesResponse({ items: [beneficiary] })).toBe(true);
    expect(isBeneficiariesResponse({ items: [] })).toBe(true);
    expect(isBeneficiariesResponse({ items: [{ ...beneficiary, status: "UNKNOWN" }] })).toBe(false);
    expect(
      isBeneficiaryResponse({ beneficiary: { ...beneficiary, status: "UNKNOWN" } }),
    ).toBe(false);
  });

  it("validate quote và receipt", () => {
    expect(
      isTransferQuote({
        quoteId: "quote-1",
        sourceAccountId: "account-1",
        beneficiary,
        amount: money,
        fee: { currency: "VND", amountMinor: "1000" },
        totalDebit: { currency: "VND", amountMinor: "101000" },
        expiresAt: "2026-08-14T00:05:00Z",
      }),
    ).toBe(true);
    expect(
      isTransferReceipt({
        transferId: "transfer-1",
        reference: "REF-1",
        status: "PENDING",
        amount: money,
        fee: { currency: "VND", amountMinor: "1000" },
        createdAt: "2026-08-14T00:00:00Z",
        updatedAt: "2026-08-14T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      isTransferReceipt({
        transferId: "transfer-1",
        reference: "REF-1",
        status: "COMPLETED",
        amount: money,
        fee: { currency: "VND", amountMinor: "1000" },
        createdAt: "2026-08-14T00:00:00Z",
        updatedAt: "2026-08-14T00:00:00Z",
      }),
    ).toBe(false);
  });
});
