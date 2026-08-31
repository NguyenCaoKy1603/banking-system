import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { getSavingsDepositStatusLabel } from "@/features/savings/presentation/savingsPresentation";
import { listSavingsDeposits } from "@/features/savings/services/savingsApi";
import type {
  SavingsDeposit,
  SavingsDepositStatus,
  SavingsDepositsResponse,
} from "@/features/savings/types/savings";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

type DepositFilter = "ACTIVE" | "COMPLETED";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải danh sách tiền gửi. Vui lòng thử lại.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("vi-VN");
}

function matchesFilter(deposit: SavingsDeposit, filter: DepositFilter): boolean {
  return filter === "ACTIVE" ? deposit.status === "ACTIVE" : deposit.status !== "ACTIVE";
}

function getStatusTone(status: SavingsDepositStatus): "success" | "neutral" {
  return status === "ACTIVE" ? "success" : "neutral";
}

export function SavingsListScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [response, setResponse] = useState<SavingsDepositsResponse | null>(null);
  const [filter, setFilter] = useState<DepositFilter>("ACTIVE");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const loadDeposits = useCallback(async () => {
    if (!accessToken) {
      setResponse(null);
      setError("Phiên đăng nhập không còn hợp lệ.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      setResponse(await listSavingsDeposits(auth));
    } catch (requestError: unknown) {
      setResponse(null);
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth]);

  useFocusEffect(
    useCallback(() => {
      void loadDeposits();
    }, [loadDeposits]),
  );

  const deposits = response?.items.filter((item) => matchesFilter(item, filter)) ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          backTestID="savings-list-back"
          eyebrow="Tích lũy"
          onBack={() => router.back()}
          subtitle="Theo dõi tiền gốc, lãi dự kiến và ngày đáo hạn."
          title="Tiền gửi tiết kiệm"
        />
        <EnvironmentBadge />

        {isLoading ? (
          <StateCard loading message="Đang tải danh sách tiền gửi..." testID="savings-list-loading" />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            actionTestID="savings-list-retry"
            icon="alert"
            message={error}
            onAction={loadDeposits}
            testID="savings-list-error"
            title="Không thể tải dữ liệu"
          />
        ) : (
          <>
            <View style={styles.totalCard} testID="savings-total-principal">
              <View style={styles.totalTopRow}>
                <View style={styles.totalIcon}>
                  <AppIcon color={colors.onPrimary} name="savings" size={22} />
                </View>
                <Text style={styles.totalCurrency}>VND</Text>
              </View>
              <Text style={styles.totalLabel}>Tổng tiền gốc đang gửi</Text>
              <Text style={styles.totalValue}>
                {response ? formatVndMinor(response.totalPrincipal.amountMinor) : "—"}
              </Text>
              <Text style={styles.totalHint}>Giá trị được cập nhật theo dữ liệu tài khoản của bạn.</Text>
            </View>

            <View style={styles.filterRow} testID="savings-filters">
              {(["ACTIVE", "COMPLETED"] as const).map((item) => {
                const selected = filter === item;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={item}
                    onPress={() => setFilter(item)}
                    style={[styles.filterButton, selected ? styles.filterButtonSelected : null]}
                    testID={`savings-filter-${item.toLowerCase()}`}
                  >
                    <Text style={[styles.filterText, selected ? styles.filterTextSelected : null]}>
                      {item === "ACTIVE" ? "Đang hoạt động" : "Đã hoàn tất"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {deposits.length === 0 ? (
              <StateCard
                icon="savings"
                message={
                  filter === "ACTIVE"
                    ? "Hãy chọn kỳ hạn và số tiền để mở khoản tiết kiệm đầu tiên."
                    : "Bạn chưa có khoản tiền gửi đã hoàn tất."
                }
                testID="savings-list-empty"
                title={filter === "ACTIVE" ? "Chưa có khoản tiền gửi" : "Chưa có dữ liệu"}
              />
            ) : (
              <View style={styles.list} testID="savings-list-items">
                {deposits.map((deposit) => (
                  <Pressable
                    accessibilityLabel={`Mở chi tiết ${deposit.productName}`}
                    accessibilityRole="button"
                    key={deposit.depositId}
                    onPress={() =>
                      router.push({
                        pathname: "/savings/[depositId]",
                        params: { depositId: deposit.depositId },
                      })
                    }
                    style={({ pressed }) => [styles.depositCard, pressed ? styles.pressed : null]}
                    testID={`savings-item-${deposit.depositId}`}
                  >
                    <View style={styles.depositTopRow}>
                      <View style={styles.depositIdentity}>
                        <View style={styles.depositIcon}>
                          <AppIcon color={colors.primary} name="savings" size={21} />
                        </View>
                        <View style={styles.depositTitleBlock}>
                          <Text style={styles.depositName}>{deposit.productName}</Text>
                          <Text style={styles.depositMeta}>
                            Kỳ hạn {deposit.termMonths} tháng · {deposit.sourceAccountMaskedNumber}
                          </Text>
                        </View>
                      </View>
                      <StatusBadge
                        label={getSavingsDepositStatusLabel(deposit.status)}
                        tone={getStatusTone(deposit.status)}
                      />
                    </View>
                    <View style={styles.amountBlock}>
                      <Text style={styles.amountLabel}>Tiền gốc</Text>
                      <Text style={styles.amountValue}>{formatVndMinor(deposit.principal.amountMinor)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Lãi suất</Text>
                        <Text style={styles.summaryValue}>
                          {(deposit.annualRateBasisPoints / 100).toLocaleString("vi-VN")}%/năm
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Ngày đáo hạn</Text>
                        <Text style={styles.summaryValue}>{formatDate(deposit.maturityAt)}</Text>
                      </View>
                      <AppIcon color={colors.subtle} name="chevronRight" size={20} />
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            <Button
              icon="savings"
              label="Mở khoản tiền gửi"
              onPress={() => router.push("/savings/open")}
              testID="savings-open-button"
            />
          </>
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
  totalCard: {
    gap: spacing.sm,
    padding: spacing.mlg,
    borderRadius: radius.xl,
    backgroundColor: colors.navy,
    ...shadows.card,
  },
  totalTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  totalCurrency: { ...typography.label, color: "rgba(255,255,255,0.72)", letterSpacing: 1 },
  totalLabel: { ...typography.label, color: "rgba(255,255,255,0.72)" },
  totalValue: { ...typography.amount, color: colors.onPrimary },
  totalHint: { ...typography.caption, color: "rgba(255,255,255,0.68)" },
  filterRow: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  filterButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  filterButtonSelected: { backgroundColor: colors.surface, ...shadows.card },
  filterText: { ...typography.label, color: colors.muted },
  filterTextSelected: { color: colors.primary },
  list: { gap: spacing.md },
  depositCard: {
    gap: spacing.md,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.995 }] },
  depositTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  depositIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  depositIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  depositTitleBlock: { flex: 1, gap: spacing.xs },
  depositName: { ...typography.subheading, color: colors.text },
  depositMeta: { ...typography.caption, color: colors.muted },
  amountBlock: { gap: spacing.xs },
  amountLabel: { ...typography.caption, color: colors.muted },
  amountValue: { ...typography.heading, color: colors.text },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  summaryItem: { flex: 1, gap: spacing.xs },
  summaryLabel: { ...typography.caption, color: colors.muted },
  summaryValue: { ...typography.label, color: colors.text },
});
