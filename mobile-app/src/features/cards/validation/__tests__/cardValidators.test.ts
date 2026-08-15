import {
  isCard,
  isCardsResponse,
  validateMockPin,
} from "@/features/cards/validation/cardValidators";

const validCard = {
  id: "card-1",
  displayName: "Thẻ thanh toán chính",
  brand: "VISA",
  maskedNumber: "•••• 2468",
  lastFour: "2468",
  expiryMonth: 12,
  expiryYear: 2030,
  status: "ACTIVE",
  contactlessEnabled: true,
  pinConfigured: false,
  dailyLimit: { currency: "VND", amountMinor: "50000000" },
  updatedAt: "2026-08-15T00:00:00.000Z",
} as const;

describe("cardValidators", () => {
  it("validates a card and cards response", () => {
    expect(isCard(validCard)).toBe(true);
    expect(isCardsResponse({ items: [validCard] })).toBe(true);
  });

  it("rejects malformed card data", () => {
    expect(isCard({ ...validCard, lastFour: "123" })).toBe(false);
    expect(isCardsResponse({ items: [{ ...validCard, status: "PENDING" }] })).toBe(false);
  });

  it("validates mock PIN policy", () => {
    expect(validateMockPin("2580", "2580")).toBeUndefined();
    expect(validateMockPin("123", "123")).toBeTruthy();
    expect(validateMockPin("1111", "1111")).toContain("lặp");
    expect(validateMockPin("2580", "2581")).toContain("không khớp");
  });
});
