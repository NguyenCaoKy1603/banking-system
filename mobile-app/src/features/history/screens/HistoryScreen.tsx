import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  listAccounts,
  listTransactions,
} from "@/features/accounts/services/accountsApi";
import type { Transaction } from "@/features/accounts/types/account";
import { filterTransactions, type HistoryDirectionFilter, type HistoryStatusFilter } from "@/features/history/presentation/historyFilters";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { colors, spacing } from "@/theme";

function getTransactionAmount(transaction: Transaction): string {
  const prefix = transaction.direction === "CREDIT" ? "+" : "-";
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
      const page = await listTransactions(account.id, {
        auth,
        limit: 20,
      });
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
    if (!selectedAccountId || !nextCursor || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);

    try {
      const page = await listTransactions(selectedAccountId, {
        auth,
        cursor: nextCursor,
        limit: 20,
      });
      setTransactions((currentTransactions) => [
        ...currentTransactions,
        ...page.items,
      ]);
      setNextCursor(page.nextCursor);
    } catch (requestError: unknown) {
      setError(requestError);
    } finally {
      setIsLoadingMore(false);
    }
  }, [auth, isLoadingMore, nextCursor, selectedAccountId]);

  const visibleTransactions = filterTransactions(
    transactions,
    statusFilter,
    directionFilter,
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>TÀI KHOẢN</Text>
          <Text style={styles.title}>Lịch sử giao dịch</Text>
          <Text style={styles.description}>
            Dữ liệu được tải từ server và phân trang bằng cursor.
          </Text>
        </View>

        <View style={styles.filterCard} testID="history-filters">
          <Text style={styles.filterTitle}>Bộ lọc trên dữ liệu đã tải</Text>
          <Text style={styles.filterLabel}>Trạng thái</Text>
          <View style={styles.filterRow}>
            {statusFilters.map((filter) => (
              <Pressable
                accessibilityRole="button"
                key={filter.value}
                onPress={() => setStatusFilter(filter.value)}
                style={[styles.filterChip, statusFilter === filter.value ? styles.filterChipSelected : null]}
                testID={`history-status-${filter.value.toLowerCase()}`}
              >
                <Text style={[styles.filterChipLabel, statusFilter === filter.value ? styles.filterChipLabelSelected : null]}>
                  {filter.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.filterLabel}>Chiều tiền</Text>
          <View style={styles.filterRow}>
            {directionFilters.map((filter) => (
              <Pressable
                accessibilityRole="button"
                key={filter.value}
                onPress={() => setDirectionFilter(filter.value)}
                style={[styles.filterChip, directionFilter === filter.value ? styles.filterChipSelected : null]}
                testID={`history-direction-${filter.value.toLowerCase()}`}
              >
                <Text style={[styles.filterChipLabel, directionFilter === filter.value ? styles.filterChipLabelSelected : null]}>
                  {filter.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : error ? (
          <RequestErrorNotice
            error={error}
            fallbackMessage="Không thể tải lịch sử giao dịch. Vui lòng thử lại."
            onRetry={loadInitial}
            testID="history-error"
          />
        ) : !selectedAccountId ? (
          <View style={styles.stateCard}>
            <Text style={styles.emptyState}>Chưa có tài khoản để hiển thị.</Text>
          </View>
        ) : visibleTransactions.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.emptyState}>
              {transactions.length === 0 ? "Chưa có giao dịch." : "Không có giao dịch phù hợp bộ lọc."}
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {visibleTransactions.map((transaction, index) => (
              <Pressable
                key={transaction.id}
                accessibilityRole="button"
                accessibilityLabel={`Mở chi tiết giao dịch ${transaction.description}`}
                onPress={() => {
                  if (!selectedAccountId) {
                    return;
                  }

                  router.push({
                    pathname: "/transaction/[transactionId]",
                    params: {
                      accountId: selectedAccountId,
                      transactionId: transaction.id,
                    },
                  });
                }}
                testID={index === 0 ? "first-transaction" : `transaction-${transaction.id}`}
                style={({ pressed }) => [
                  styles.transactionRow,
                  pressed ? styles.transactionRowPressed : null,
                ]}
              >
                <View style={styles.transactionContent}>
                  <Text style={styles.transactionDescription}>
                    {transaction.description}
                  </Text>
                  <Text style={styles.transactionMeta}>
                    {transaction.counterpartyName ?? "Không có thông tin đối tác"}
                  </Text>
                  <Text style={styles.transactionStatus}>
                    {getStatusLabel(transaction.status)}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.transactionAmount,
                    transaction.direction === "CREDIT"
                      ? styles.creditAmount
                      : null,
                  ]}
                >
                  {getTransactionAmount(transaction)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {!isLoading && !error && nextCursor ? (
          <PrimaryButton
            disabled={isLoadingMore}
            label={isLoadingMore ? "Đang tải..." : "Tải thêm"}
            onPress={loadMore}
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
    maxWidth: 720,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  backLabel: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  header: {
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
  },
  description: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  filterCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  filterTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  filterLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
  },
  filterChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  filterChipLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
  },
  filterChipLabelSelected: {
    color: colors.surface,
  },
  centerState: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  stateCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  emptyState: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "600",
  },
  listCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  transactionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  transactionRowPressed: {
    opacity: 0.72,
  },
  transactionContent: {
    flex: 1,
    gap: spacing.xs,
  },
  transactionDescription: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  transactionMeta: {
    color: colors.muted,
    fontSize: 13,
  },
  transactionStatus: {
    color: colors.muted,
    fontSize: 12,
  },
  transactionAmount: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  creditAmount: {
    color: colors.success,
  },
});
