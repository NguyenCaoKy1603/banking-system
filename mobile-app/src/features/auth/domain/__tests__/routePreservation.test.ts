import {
  buildCurrentAuthenticatedHref,
  shouldUseReplaceForRestore,
} from "@/features/auth/domain/routePreservation";

describe("routePreservation", () => {
  it("excludes auth and system routes", () => {
    expect(buildCurrentAuthenticatedHref("/login", ["(auth)", "login"], {})).toBeNull();
    expect(buildCurrentAuthenticatedHref("/register", ["(auth)", "register"], {})).toBeNull();
    expect(buildCurrentAuthenticatedHref("/recover", ["(auth)", "recover"], {})).toBeNull();
    expect(buildCurrentAuthenticatedHref("/+not-found", ["+not-found"], {})).toBeNull();
  });

  it("normalizes tab routes accurately", () => {
    expect(buildCurrentAuthenticatedHref("/", ["(tabs)"], {})).toBe("/");
    expect(buildCurrentAuthenticatedHref("/", ["(tabs)", "index"], {})).toBe("/");
    expect(buildCurrentAuthenticatedHref("/profile", ["(tabs)", "profile"], {})).toBe(
      "/(tabs)/profile",
    );
    expect(buildCurrentAuthenticatedHref("/cards", ["(tabs)", "cards"], {})).toBe(
      "/(tabs)/cards",
    );
  });

  it("preserves query parameters while stripping dynamic segment and internal navigation params", () => {
    expect(
      buildCurrentAuthenticatedHref(
        "/cards/card-1/pay",
        ["cards", "[cardId]", "pay"],
        { cardId: "card-1", statementId: "stmt-99", screen: "pay" },
      ),
    ).toBe("/cards/card-1/pay?statementId=stmt-99");

    expect(
      buildCurrentAuthenticatedHref("/transfer", ["transfer"], {
        beneficiaryId: "ben-42",
      }),
    ).toBe("/transfer?beneficiaryId=ben-42");

    expect(buildCurrentAuthenticatedHref("/mfa", ["mfa"], {})).toBe("/mfa");
  });

  it("uses replace only for tab destinations and push for sub-screens", () => {
    expect(shouldUseReplaceForRestore("/")).toBe(true);
    expect(shouldUseReplaceForRestore("/(tabs)/profile")).toBe(true);
    expect(shouldUseReplaceForRestore("/transfer")).toBe(false);
    expect(shouldUseReplaceForRestore("/mfa")).toBe(false);
    expect(shouldUseReplaceForRestore("/cards/card-1/pay?statementId=stmt-99")).toBe(false);
  });
});
