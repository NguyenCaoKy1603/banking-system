export type SupportedCurrency = "VND";

export type Money = {
  currency: SupportedCurrency;
  amountMinor: string;
};
