import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getCreditCardStatusLabel } from "@/features/credit/presentation/creditPresentation";
import { listCreditCards } from "@/features/credit/services/creditApi";
import type { CreditCard } from "@/features/credit/types/credit";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải thẻ tín dụng sandbox. Vui lòng thử lại.";
}

type CardsScreenProps = { showBackButton?: boolean };

export function CardsScreen({ showBackButton = true }: CardsScreenProps) {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(() => ({ accessToken, deviceId, refreshAccessToken }), [accessToken, deviceId, refreshAccessToken]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const loadCards = useCallback(async () => {
    if (!accessToken) {
      setCards([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      setCards((await listCreditCards(auth)).items);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth]);

  useFocusEffect(
    useCallback(() => {
      void loadCards();
    }, [loadCards]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {showBackButton ? (
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton} testID="cards-back">
            <Text style={styles.backLabel}>‹ Quay lại</Text>
          </Pressable>
        ) : null}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>M7 · CREDIT SANDBOX</Text>
          <Text style={styles.title}>Thẻ tín dụng</Text>
          <Text style={styles.description}>
            Dữ liệu thẻ, hạn mức và dư nợ lấy từ backend reference. Đây không phải thẻ tín dụng thật.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.centerState} testID="credit-cards-loading"><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : error ? (
          <View style={styles.stateCard} testID="credit-cards-error">
            <Text style={styles.errorText}>{error}</Text>
            <PrimaryButton label="Thử lại" onPress={loadCards} testID="credit-cards-retry" />
          </View>
        ) : cards.length === 0 ? (
          <View style={styles.stateCard} testID="credit-cards-empty"><Text style={styles.emptyText}>Chưa có thẻ trong sandbox.</Text></View>
        ) : (
          <View style={styles.listCard} testID="credit-cards-list">
            {cards.map((card, index) => (
              <Pressable
                accessibilityRole="button"
                key={card.cardId}
                onPress={() => router.push({ pathname: "/cards/[cardId]", params: { cardId: card.cardId } })}
                style={({ pressed }) => [styles.cardRow, pressed ? styles.pressedRow : null]}
                testID={index === 0 ? "card-first" : `credit-card-${card.cardId}`}
              >
                <View style={styles.cardMain}>
                  <Text style={styles.cardName}>{card.displayName}</Text>
                  <Text style={styles.cardNumber}>{card.brand} · {card.maskedNumber}</Text>
                  <Text style={styles.cardMeta}>Dư nợ {formatVndMinor(card.postedOutstanding.amountMinor)} · Còn khả dụng {formatVndMinor(card.availableCredit.amountMinor)}</Text>
                </View>
                <Text style={[styles.status, card.status === "LOCKED" ? styles.locked : null]}>{getCreditCardStatusLabel(card.status)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  backButton: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  backLabel: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  header: { gap: spacing.sm },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700" },
  description: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  centerState: { minHeight: 180, alignItems: "center", justifyContent: "center" },
  stateCard: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.md, backgroundColor: colors.surface },
  listCard: { borderWidth: 1, borderColor: colors.border, borderRadius: spacing.md, backgroundColor: colors.surface, overflow: "hidden" },
  cardRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  pressedRow: { opacity: 0.72 },
  cardMain: { flex: 1, gap: spacing.xs },
  cardName: { color: colors.text, fontSize: 17, fontWeight: "700" },
  cardNumber: { color: colors.muted, fontSize: 14 },
  cardMeta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  status: { color: colors.success, fontSize: 12, fontWeight: "700", textAlign: "right" },
  locked: { color: colors.danger },
  emptyText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
