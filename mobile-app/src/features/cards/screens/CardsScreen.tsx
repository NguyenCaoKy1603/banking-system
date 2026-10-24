import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { getCreditCardStatusLabel } from "@/features/credit/presentation/creditPresentation";
import { listCreditApplications, listCreditCards } from "@/features/credit/services/creditApi";
import type { CreditApplication, CreditCard, CreditCardStatus } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải danh sách thẻ. Vui lòng thử lại.";
}

function getStatusTone(status: CreditCardStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "LOCKED") return "warning";
  if (status === "BLOCKED") return "danger";
  return "neutral";
}

type CardsScreenProps = { showBackButton?: boolean };

export function CardsScreen({ showBackButton = true }: CardsScreenProps) {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [application, setApplication] = useState<CreditApplication | null>(null);
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
      const [cardsResponse, applicationsResponse] = await Promise.all([
        listCreditCards(auth),
        listCreditApplications(auth),
      ]);
      setCards(cardsResponse.items);
      setApplication(
        applicationsResponse.items.find((item) => item.status !== "REJECTED" && item.status !== "ACTIVE") ?? null,
      );
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
        <AppHeader
          backTestID="cards-back"
          eyebrow="Quản lý tài chính"
          onBack={showBackButton ? () => router.back() : undefined}
          subtitle="Theo dõi hạn mức, dư nợ và trạng thái thẻ tại một nơi."
          title="Thẻ tín dụng"
        />
        <EnvironmentBadge />

        {isLoading ? (
          <StateCard loading message="Đang tải danh sách thẻ..." testID="credit-cards-loading" />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            actionTestID="credit-cards-retry"
            icon="alert"
            message={error}
            onAction={loadCards}
            testID="credit-cards-error"
            title="Không thể tải dữ liệu"
          />
        ) : cards.length === 0 ? (
          <StateCard
            actionLabel={application ? "Xem hồ sơ đăng ký" : "Đăng ký thẻ"}
            icon="card"
            message={
              application
                ? "Hồ sơ thẻ của bạn đang được xử lý. Mở hồ sơ để xem trạng thái và bước tiếp theo."
                : "Bạn chưa có thẻ tín dụng. Hãy gửi đăng ký để bắt đầu."
            }
            onAction={() => router.push("/cards/apply")}
            testID="credit-cards-empty"
            title="Chưa có thẻ"
          />
        ) : (
          <View style={styles.list} testID="credit-cards-list">
            {cards.map((card, index) => (
              <Pressable
                accessibilityLabel={`Mở chi tiết ${card.displayName}`}
                accessibilityRole="button"
                key={card.cardId}
                onPress={() =>
                  router.push({ pathname: "/cards/[cardId]", params: { cardId: card.cardId } })
                }
                style={({ pressed }) => [styles.cardShell, pressed ? styles.pressed : null]}
                testID={index === 0 ? "card-first" : `credit-card-${card.cardId}`}
              >
                <View style={styles.bankCard}>
                  <View style={styles.cardTopRow}>
                    <View style={styles.cardBrandRow}>
                      <View style={styles.cardIcon}>
                        <AppIcon color={colors.onPrimary} name="card" size={19} />
                      </View>
                      <Text style={styles.novaLabel}>NOVA</Text>
                    </View>
                    <Text style={styles.networkLabel}>{card.brand}</Text>
                  </View>
                  <Text style={styles.cardName}>{card.displayName}</Text>
                  <Text style={styles.cardNumber}>{card.maskedNumber}</Text>
                  <View style={styles.cardBottomRow}>
                    <View>
                      <Text style={styles.cardCaption}>Hiệu lực đến</Text>
                      <Text style={styles.cardExpiry}>
                        {String(card.expiryMonth).padStart(2, "0")}/{String(card.expiryYear).slice(-2)}
                      </Text>
                    </View>
                    <StatusBadge label={getCreditCardStatusLabel(card.status)} tone={getStatusTone(card.status)} />
                  </View>
                </View>

                <View style={styles.balancePanel}>
                  <View style={styles.balanceItem}>
                    <Text style={styles.balanceLabel}>Dư nợ hiện tại</Text>
                    <Text style={styles.balanceValue}>{formatVndMinor(card.postedOutstanding.amountMinor)}</Text>
                  </View>
                  <View style={styles.divider} />
                  <View style={styles.balanceItem}>
                    <Text style={styles.balanceLabel}>Hạn mức khả dụng</Text>
                    <Text style={[styles.balanceValue, styles.availableValue]}>
                      {formatVndMinor(card.availableCredit.amountMinor)}
                    </Text>
                  </View>
                  <AppIcon color={colors.subtle} name="chevronRight" size={20} />
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: sizes.contentMaxWidth,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  list: { gap: spacing.lg },
  cardShell: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.995 }] },
  bankCard: {
    minHeight: 210,
    justifyContent: "space-between",
    padding: spacing.mlg,
    backgroundColor: colors.navy,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardBrandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  novaLabel: { ...typography.label, color: colors.onPrimary, letterSpacing: 1.2 },
  networkLabel: { ...typography.subheading, color: colors.onPrimary, fontStyle: "italic" },
  cardName: { ...typography.bodyStrong, color: "rgba(255,255,255,0.78)" },
  cardNumber: { ...typography.heading, color: colors.onPrimary, letterSpacing: 2.2 },
  cardBottomRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  cardCaption: { ...typography.caption, color: "rgba(255,255,255,0.62)" },
  cardExpiry: { ...typography.bodyStrong, color: colors.onPrimary },
  balancePanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.mlg,
  },
  balanceItem: { flex: 1, gap: spacing.xs },
  balanceLabel: { ...typography.caption, color: colors.muted },
  balanceValue: { ...typography.bodyStrong, color: colors.text },
  availableValue: { color: colors.success },
  divider: { width: 1, height: 40, backgroundColor: colors.divider },
});
