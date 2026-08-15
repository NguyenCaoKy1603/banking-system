import type { Money } from "@/features/banking/types/money";

export type CardStatus = "ACTIVE" | "LOCKED";

export type Card = {
  id: string;
  displayName: string;
  brand: "VISA" | "MASTERCARD";
  maskedNumber: string;
  lastFour: string;
  expiryMonth: number;
  expiryYear: number;
  status: CardStatus;
  contactlessEnabled: boolean;
  pinConfigured: boolean;
  dailyLimit: Money;
  updatedAt: string;
};

export type CardsResponse = {
  items: Card[];
};

export type CardResponse = {
  card: Card;
};
