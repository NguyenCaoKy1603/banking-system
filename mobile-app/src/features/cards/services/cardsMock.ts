import type { Card, CardStatus } from "@/features/cards/types/card";
import {
  MockServiceError,
  nowIso,
  requireMockId,
  requireMockUserId,
} from "@/services/mock/mockService";

const cardsByUser = new Map<string, Card[]>();

function seedCards(userId: string): Card[] {
  return [
    {
      id: `card-${userId}-primary`,
      displayName: "Thẻ thanh toán chính",
      brand: "VISA",
      maskedNumber: "•••• •••• •••• 2468",
      lastFour: "2468",
      expiryMonth: 12,
      expiryYear: 29,
      status: "ACTIVE",
      contactlessEnabled: true,
      pinConfigured: true,
      dailyLimit: { currency: "VND", amountMinor: "10000000" },
      updatedAt: nowIso(),
    },
  ];
}

function getCards(userId: string): Card[] {
  const normalizedUserId = requireMockUserId(userId);
  const current = cardsByUser.get(normalizedUserId);
  if (current) {
    return current;
  }
  const seeded = seedCards(normalizedUserId);
  cardsByUser.set(normalizedUserId, seeded);
  return seeded;
}

function clone(card: Card): Card {
  return { ...card, dailyLimit: { ...card.dailyLimit } };
}

function findCard(userId: string, cardId: string): Card {
  const id = requireMockId(cardId, "cardId");
  const card = getCards(userId).find((item) => item.id === id);
  if (!card) {
    throw new MockServiceError("NOT_FOUND", "Không tìm thấy thẻ.");
  }
  return card;
}

export async function listCards(userId: string): Promise<{ items: Card[] }> {
  return { items: getCards(userId).map(clone) };
}

export async function getCard(userId: string, cardId: string): Promise<{ card: Card }> {
  return { card: clone(findCard(userId, cardId)) };
}

export async function setCardStatus(
  userId: string,
  cardId: string,
  status: CardStatus,
): Promise<{ card: Card }> {
  if (status !== "ACTIVE" && status !== "LOCKED") {
    throw new MockServiceError("VALIDATION_ERROR", "Trạng thái thẻ không hợp lệ.");
  }
  const card = findCard(userId, cardId);
  card.status = status;
  card.updatedAt = nowIso();
  return { card: clone(card) };
}

export async function changeMockPin(
  userId: string,
  cardId: string,
  pin: string,
): Promise<{ card: Card }> {
  if (!/^\d{4,6}$/.test(pin) || /^(\d)\1+$/.test(pin)) {
    throw new MockServiceError("VALIDATION_ERROR", "PIN không hợp lệ.");
  }
  const card = findCard(userId, cardId);
  card.pinConfigured = true;
  card.updatedAt = nowIso();
  return { card: clone(card) };
}

export function resetCardsMock(): void {
  cardsByUser.clear();
}
