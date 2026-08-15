import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { getSavingsDepositStatusLabel } from "@/features/savings/presentation/savingsPresentation";
import { listSavingsDeposits } from "@/features/savings/services/savingsApi";
import type { SavingsDeposit, SavingsDepositsResponse } from "@/features/savings/types/savings";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

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
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
          testID="savings-list-back"
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.titleBlock}>
              <Text style={styles.eyebrow}>M6 · TIỀN GỬI</Text>
              <Text style={styles.title}>Tiền gửi tiết kiệm</Text>
            </View>
            <View style={styles.sandboxBadge}>
              <Text style={styles.sandboxText}>SANDBOX</Text>
            </View>
          </View>
          <Text style={styles.description}>
            Dữ liệu mô phỏng VND; lãi suất và ngày đáo hạn do backend trả về.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.centerState} testID="savings-list-loading">
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.stateText}>Đang tải danh sách tiền gửi...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard} testID="savings-list-error">
            <Text style={styles.stateTitle}>Không thể tải dữ liệu</Text>
            <Text style={styles.errorText}>{error}</Text>
            <PrimaryButton label="Thử lại" onPress={loadDeposits} testID="savings-list-retry" />
          </View>
        ) : (
          <>
            <View style={styles.totalCard} testID="savings-total-principal">
              <Text style={styles.totalLabel}>Tổng gốc đang gửi</Text>
              <Text style={styles.totalValue}>
                {response ? formatVndMinor(response.totalPrincipal.amountMinor) : "—"}
              </Text>
              <Text style={styles.totalHint}>Tổng này do server tính, Mobile không tự cộng.</Text>
            </View>

            <View style={styles.filterRow}>
              {(["ACTIVE", "COMPLETED"] as const).map((item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === item }}
                  key={item}
                  onPress={() => setFilter(item)}
                  style={[styles.filterButton, filter === item ? styles.filterButtonSelected : null]}
                  testID={`savings-filter-${item.toLowerCase()}`}
                >
                  <Text style={[styles.filterText, filter === item ? styles.filterTextSelected : null]}>
                    {item === "ACTIVE" ? "Đang hoạt động" : "Đã hoàn tất"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {deposits.length === 0 ? (
              <View style={styles.stateCard} testID="savings-list-empty">
                <Text style={styles.stateTitle}>Chưa có khoản tiền gửi</Text>
                <Text style={styles.stateText}>
                  Chọn kỳ hạn và số tiền để mở khoản tiết kiệm sandbox đầu tiên.
                </Text>
              </View>
            ) : (
              <View style={styles.list} testID="savings-list-items">
                {deposits.map((deposit) => (
                  <Pressable
                    accessibilityRole="button"
                    key={deposit.depositId}
                    onPress={() =>
                      router.push({ pathname: "/savings/[depositId]", params: { depositId: deposit.depositId } })
                    }
                    style={({ pressed }) => [styles.depositCard, pressed ? styles.pressed : null]}
                    testID={`savings-item-${deposit.depositId}`}
                  >
                    <View style={styles.depositTopRow}>
                      <View style={styles.depositTitleBlock}>
                        <Text style={styles.depositName}>{deposit.productName}</Text>
                        <Text style={styles.depositMeta}>{deposit.termMonths} tháng · {deposit.sourceAccountMaskedNumber}</Text>
                      </View>
                      <Text style={styles.depositStatus}>{getSavingsDepositStatusLabel(deposit.status)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Tiền gốc</Text>
                      <Text style={styles.summaryValue}>{formatVndMinor(deposit.principal.amountMinor)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Lãi dự kiến · đáo hạn</Text>
                      <Text style={styles.summaryValue}>{formatDate(deposit.maturityAt)}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            <PrimaryButton
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
    maxWidth: 720,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  backButton: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  backLabel: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  header: { gap: spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  titleBlock: { flex: 1, gap: spacing.sm },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700" },
  description: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  sandboxBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 999, backgroundColor: colors.primarySoft },
  sandboxText: { color: colors.primary, fontSize: 10, fontWeight: "800" },
  centerState: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.md },
  stateCard: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: spacing.md, backgroundColor: colors.surface },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  stateText: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  totalCard: { gap: spacing.xs, padding: spacing.lg, borderRadius: 20, backgroundColor: colors.primary },
  totalLabel: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: "700" },
  totalValue: { color: colors.surface, fontSize: 26, fontWeight: "800" },
  totalHint: { color: "rgba(255,255,255,0.75)", fontSize: 12 },
  filterRow: { flexDirection: "row", gap: spacing.sm },
  filterButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface },
  filterButtonSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  filterText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  filterTextSelected: { color: colors.primary },
  list: { gap: spacing.md },
  depositCard: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface },
  pressed: { opacity: 0.75 },
  depositTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  depositTitleBlock: { flex: 1, gap: spacing.xs },
  depositName: { color: colors.text, fontSize: 16, fontWeight: "800" },
  depositMeta: { color: colors.muted, fontSize: 13 },
  depositStatus: { color: colors.success, fontSize: 11, fontWeight: "800", textAlign: "right" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  summaryLabel: { color: colors.muted, fontSize: 13 },
  summaryValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700", textAlign: "right" },
});
