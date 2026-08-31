import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  listAccounts,
  listTransactions,
} from "@/features/accounts/services/accountsApi";
import type { Transaction } from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import {
  filterTransactions,
  type HistoryDirectionFilter,
  type HistoryStatusFilter,
} from "@/features/history/presentation/historyFilters";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getTransactionAmount(transaction: Transaction): string {
  const prefix = transaction.direction === "CREDIT" ? "+" : "−";
  return `${prefix}${formatVndMinor(transaction.amount.amountMinor)}`;
}

function getStatusLabel(status: Transaction["status"]): string {
  switch (status) {
    case "PENDING":
      return "Đang xử lý";
    case "SUCCEEDED":
      return "Thành công";
    case "FAILED":
      return "Thất bại";
    case "REVERSED":
      return "Đã hoàn tác";
  }
}

function getStatusTone(
  status: Transaction["status"],
): "success" | "warning" | "danger" | "neutral" {
  if (status === "SUCCEEDED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "FAILED") return "danger";
  return "neutral";
}

function formatTransactionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const statusFilters: { value: HistoryStatusFilter; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "SUCCEEDED", label: "Thành công" },
  { value: "PENDING", label: "Đang xử lý" },
  { value: "FAILED", label: "Thất bại" },
  { value: "REVERSED", label: "Hoàn tác" },
];

const directionFilters: { value: HistoryDirectionFilter; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "CREDIT", label: "Tiền vào" },
  { value: "DEBIT", label: "Tiền ra" },
];

export function HistoryScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>();
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>("ALL");
  const [directionFilter, setDirectionFilter] = useState<HistoryDirectionFilter>("ALL");

  const loadInitial = useCallback(async () => {
    if (!accessToken) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(undefined);
    setTransactions([]);
    setNextCursor(null);

    try {
      const accountsResponse = await listAccounts(auth);
      const account = accountsResponse.accounts[0];

      if (!account) {
        setSelectedAccountId(null);
        return;
      }

      setSelectedAccountId(account.id);
      const page = await listTransactions(account.id, { auth, limit: 20 });
      setTransactions(page.items);
      setNextCursor(page.nextCursor);
    } catch (requestError: unknown) {
      setError(requestError);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth]);

  useFocusEffect(
    useCallback(() => {
      void loadInitial();
    }, [loadInitial]),
  );

  const loadMore = useCallback(async () => {
    if (!selectedAccountId || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);

    try {
      const page = await listTransactions(selectedAccountId, {
        auth,
        cursor: nextCursor,
        limit: 20,
      });
      setTransactions((currentTransactions) => [...currentTransactions, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (requestError: unknown) {
      setError(requestError);
    } finally {
      setIsLoadingMore(false);
    }
  }, [auth, isLoadingMore, nextCursor, selectedAccountId]);

  const visibleTransactions = filterTransactions(transactions, statusFilter, directionFilter);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          eyebrow="Tài khoản thanh toán"
          onBack={() => router.back()}
          subtitle="Tra cứu các khoản tiền vào, tiền ra và trạng thái xử lý."
          title="Lịch sử giao dịch"
        />

        <View style={styles.filterCard} testID="history-filters">
          <View style={styles.filterHeader}>
            <View style={styles.filterIcon}>
              <AppIcon color={colors.primary} name="history" size={20} />
            </View>
            <Text style={styles.filterTitle}>Bộ lọc giao dịch</Text>
          </View>
          <Text style={styles.filterLabel}>Trạng thái</Text>
          <View style={styles.filterRow}>
            {statusFilters.map((filter) => {
              const selected = statusFilter === filter.value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={filter.value}
                  onPress={() => setStatusFilter(filter.value)}
                  style={[styles.filterChip, selected ? styles.filterChipSelected : null]}
                  testID={`history-status-${filter.value.toLowerCase()}`}
                >
                  <Text style={[styles.filterChipLabel, selected ? styles.filterChipLabelSelected : null]}>
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.filterLabel}>Loại giao dịch</Text>
          <View style={styles.filterRow}>
            {directionFilters.map((filter) => {
              const selected = directionFilter === filter.value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={filter.value}
                  onPress={() => setDirectionFilter(filter.value)}
                  style={[styles.filterChip, selected ? styles.filterChipSelected : null]}
                  testID={`history-direction-${filter.value.toLowerCase()}`}
                >
                  <Text style={[styles.filterChipLabel, selected ? styles.filterChipLabelSelected : null]}>
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {isLoading ? (
          <StateCard loading message="Đang tải lịch sử giao dịch..." />
        ) : error ? (
          <RequestErrorNotice
            error={error}
            fallbackMessage="Không thể tải lịch sử giao dịch. Vui lòng thử lại."
            onRetry={loadInitial}
            testID="history-error"
          />
        ) : !selectedAccountId ? (
          <StateCard icon="account" message="Bạn chưa có tài khoản để hiển thị giao dịch." title="Chưa có tài khoản" />
        ) : visibleTransactions.length === 0 ? (
          <StateCard
            icon="history"
            message={
              transactions.length === 0
                ? "Các giao dịch mới sẽ xuất hiện tại đây."
                : "Hãy thay đổi bộ lọc để xem các giao dịch khác."
            }
            title={transactions.length === 0 ? "Chưa có giao dịch" : "Không tìm thấy kết quả"}
          />
        ) : (
          <View style={styles.list}>
            {visibleTransactions.map((transaction, index) => (
              <Pressable
                accessibilityLabel={`Mở chi tiết giao dịch ${transaction.description}`}
                accessibilityRole="button"
                key={transaction.id}
                onPress={() => {
                  if (!selectedAccountId) return;
                  router.push({
                    pathname: "/transaction/[transactionId]",
                    params: { accountId: selectedAccountId, transactionId: transaction.id },
                  });
                }}
                style={({ pressed }) => [styles.transactionCard, pressed ? styles.pressed : null]}
                testID={index === 0 ? "first-transaction" : `transaction-${transaction.id}`}
              >
                <View
                  style={[
                    styles.directionIcon,
                    transaction.direction === "CREDIT" ? styles.creditIcon : styles.debitIcon,
                  ]}
                >
                  <AppIcon
                    color={transaction.direction === "CREDIT" ? colors.success : colors.primary}
                    name="transfer"
                    size={20}
                  />
                </View>
                <View style={styles.transactionContent}>
                  <Text numberOfLines={1} style={styles.transactionDescription}>
                    {transaction.description}
                  </Text>
                  <Text numberOfLines={1} style={styles.transactionMeta}>
                    {transaction.counterpartyName ?? "Giao dịch tài khoản"}
                  </Text>
                  <Text style={styles.transactionDate}>{formatTransactionDate(transaction.occurredAt)}</Text>
                </View>
                <View style={styles.transactionRight}>
                  <Text
                    style={[
                      styles.transactionAmount,
                      transaction.direction === "CREDIT" ? styles.creditAmount : null,
                    ]}
                  >
                    {getTransactionAmount(transaction)}
                  </Text>
                  <StatusBadge
                    label={getStatusLabel(transaction.status)}
                    tone={getStatusTone(transaction.status)}
                  />
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {!isLoading && !error && nextCursor ? (
          <Button
            loading={isLoadingMore}
            label="Tải thêm giao dịch"
            onPress={loadMore}
            variant="outline"
          />
        ) : null}
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
  filterCard: {
    gap: spacing.sm,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  filterHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  filterIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  filterTitle: { ...typography.subheading, color: colors.text },
  filterLabel: { ...typography.caption, color: colors.muted },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  filterChip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.smd,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  filterChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  filterChipLabel: { ...typography.caption, color: colors.muted, fontWeight: "700" },
  filterChipLabelSelected: { color: colors.primary },
  list: { gap: spacing.sm },
  transactionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  directionIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  creditIcon: { backgroundColor: colors.successSoft, transform: [{ rotate: "180deg" }] },
  debitIcon: { backgroundColor: colors.primarySoft },
  transactionContent: { flex: 1, gap: 2 },
  transactionDescription: { ...typography.bodyStrong, color: colors.text },
  transactionMeta: { ...typography.caption, color: colors.muted },
  transactionDate: { ...typography.caption, color: colors.subtle },
  transactionRight: { alignItems: "flex-end", gap: spacing.xs },
  transactionAmount: { ...typography.bodyStrong, color: colors.text },
  creditAmount: { color: colors.success },
});
