import {
  changeMockPin,
  getCard,
  listCards,
  resetCardsMock,
  setCardStatus,
} from "@/features/cards/services/cardsMock";

describe("cardsMock", () => {
  beforeEach(() => resetCardsMock());

  it("lists a masked card and supports lock/unlock", async () => {
    const initial = await listCards("user-card-1");
    expect(initial.items).toHaveLength(1);
    expect(initial.items[0]?.maskedNumber).toContain("2468");
    expect(initial.items[0]?.status).toBe("ACTIVE");

    const locked = await setCardStatus("user-card-1", initial.items[0]!.id, "LOCKED");
    expect(locked.card.status).toBe("LOCKED");
    const active = await setCardStatus("user-card-1", initial.items[0]!.id, "ACTIVE");
    expect(active.card.status).toBe("ACTIVE");
  });

  it("changes a mock PIN without storing or returning the PIN", async () => {
    const card = (await listCards("user-card-2")).items[0]!;
    const result = await changeMockPin("user-card-2", card.id, "2580");
    expect(result.card.pinConfigured).toBe(true);
    expect(result.card).not.toHaveProperty("pin");
    await expect(changeMockPin("user-card-2", card.id, "1111")).rejects.toThrow();
    expect((await getCard("user-card-2", card.id)).card.pinConfigured).toBe(true);
  });
});
