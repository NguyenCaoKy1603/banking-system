import { useCallback, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  exportAccountStatement,
  getAccountSummary,
  listAccounts,
  listTransactions,
} from "@/features/accounts/services/accountsApi";
import type {
  AccountMonthlySummary,
  PaymentAccount,
  StatementExportFormat,
  Transaction,
  TransactionFilterParams,
} from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import {
  filterTransactions,
  type HistoryDirectionFilter,
  type HistoryStatusFilter,
} from "@/features/history/presentation/historyFilters";
import {
  formatSignedVndMinor,
  summarizeMonthlyCashFlow,
} from "@/features/history/presentation/historySummary";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

type HistoryPeriodPreset = "ALL" | "THIS_MONTH" | "LAST_MONTH" | "CUSTOM";

function formatDateYmd(year: number, monthIndexZeroBased: number, day: number): string {
  const month = String(monthIndexZeroBased + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${month}-${dd}`;
}

function resolveMonthParam(period: HistoryPeriodPreset, now: Date = new Date()): string {
  const year = period === "LAST_MONTH" && now.getMonth() === 0
    ? now.getFullYear() - 1
    : now.getFullYear();
  const monthIndex = period === "LAST_MONTH"
    ? (now.getMonth() + 11) % 12
    : now.getMonth();
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function resolveDateRange(
  period: HistoryPeriodPreset,
  customFrom: string,
  customTo: string,
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (period === "THIS_MONTH") {
    const y = now.getFullYear();
    const m = now.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    return {
      from: formatDateYmd(y, m, 1),
      to: formatDateYmd(y, m, lastDay),
    };
  }
  if (period === "LAST_MONTH") {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const y = prev.getFullYear();
    const m = prev.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    return {
      from: formatDateYmd(y, m, 1),
      to: formatDateYmd(y, m, lastDay),
    };
  }
  if (period === "CUSTOM") {
    const trimmedFrom = customFrom.trim();
    const trimmedTo = customTo.trim();
    return {
      ...(trimmedFrom ? { from: trimmedFrom } : {}),
      ...(trimmedTo ? { to: trimmedTo } : {}),
    };
  }
  return {};
}

const periodFilters: { value: HistoryPeriodPreset; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "THIS_MONTH", label: "Tháng này" },
  { value: "LAST_MONTH", label: "Tháng trước" },
  { value: "CUSTOM", label: "Tùy chọn" },
];

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
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const selectedAccountIdRef = useRef<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<unknown>();
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [serverSummary, setServerSummary] = useState<AccountMonthlySummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>("ALL");
  const [directionFilter, setDirectionFilter] = useState<HistoryDirectionFilter>("ALL");
  const [periodFilter, setPeriodFilter] = useState<HistoryPeriodPreset>("ALL");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  const buildFilterParams = useCallback(
    (overrides?: {
      status?: HistoryStatusFilter;
      direction?: HistoryDirectionFilter;
      period?: HistoryPeriodPreset;
      from?: string;
      to?: string;
      q?: string;
    }): TransactionFilterParams => {
      const nextStatus = overrides?.status ?? statusFilter;
      const nextDirection = overrides?.direction ?? directionFilter;
      const nextPeriod = overrides?.period ?? periodFilter;
      const nextFrom = overrides?.from ?? customFrom;
      const nextTo = overrides?.to ?? customTo;
      const nextQuery = (overrides?.q ?? appliedQuery).trim();
      const range = resolveDateRange(nextPeriod, nextFrom, nextTo);

      return {
        ...(nextStatus !== "ALL" ? { status: nextStatus } : {}),
        ...(nextDirection !== "ALL" ? { direction: nextDirection } : {}),
        ...range,
        ...(nextQuery ? { q: nextQuery } : {}),
      };
    },
    [appliedQuery, customFrom, customTo, directionFilter, periodFilter, statusFilter],
  );

  const fetchSummarySafely = useCallback(
    async (accountId: string, period: HistoryPeriodPreset) => {
      if (typeof getAccountSummary !== "function") {
        setServerSummary(null);
        return;
      }
      try {
        const month = resolveMonthParam(period);
        const summary = await getAccountSummary(accountId, { auth, month });
        setServerSummary(summary);
      } catch {
        setServerSummary(null);
      }
    },
    [auth],
  );

  const loadAccountTransactions = useCallback(
    async (accountId: string, filters?: TransactionFilterParams, period: HistoryPeriodPreset = periodFilter) => {
      setIsLoading(true);
      setError(undefined);
      setExportNotice(null);
      setTransactions([]);
      setNextCursor(null);
      try {
        const effectiveFilters = filters ?? buildFilterParams();
        const [page] = await Promise.all([
          listTransactions(accountId, { auth, limit: 20, ...effectiveFilters }),
          fetchSummarySafely(accountId, period),
        ]);
        setTransactions(page.items);
        setNextCursor(page.nextCursor);
      } catch (requestError: unknown) {
        setError(requestError);
      } finally {
        setIsLoading(false);
      }
    },
    [auth, buildFilterParams, fetchSummarySafely, periodFilter],
  );

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
      setAccounts(accountsResponse.accounts);
      const preferredId = selectedAccountIdRef.current;
      const activeAccount =
        accountsResponse.accounts.find((item) => item.id === preferredId) ??
        accountsResponse.accounts[0];

      if (!activeAccount) {
        selectedAccountIdRef.current = null;
        setSelectedAccountId(null);
        setServerSummary(null);
        setIsLoading(false);
        return;
      }

      selectedAccountIdRef.current = activeAccount.id;
      setSelectedAccountId(activeAccount.id);
      const activeFilters = buildFilterParams();
      const [page] = await Promise.all([
        listTransactions(activeAccount.id, { auth, limit: 20, ...activeFilters }),
        fetchSummarySafely(activeAccount.id, periodFilter),
      ]);
      setTransactions(page.items);
      setNextCursor(page.nextCursor);
    } catch (requestError: unknown) {
      setError(requestError);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth, buildFilterParams, fetchSummarySafely, periodFilter]);

  const handleSelectAccount = useCallback(
    (accountId: string) => {
      if (accountId === selectedAccountIdRef.current) return;
      selectedAccountIdRef.current = accountId;
      setSelectedAccountId(accountId);
      void loadAccountTransactions(accountId);
    },
    [loadAccountTransactions],
  );

  const handleSelectStatus = useCallback(
    (nextStatus: HistoryStatusFilter) => {
      setStatusFilter(nextStatus);
      if (!selectedAccountIdRef.current) return;
      void loadAccountTransactions(
        selectedAccountIdRef.current,
        buildFilterParams({ status: nextStatus }),
      );
    },
    [buildFilterParams, loadAccountTransactions],
  );

  const handleSelectDirection = useCallback(
    (nextDirection: HistoryDirectionFilter) => {
      setDirectionFilter(nextDirection);
      if (!selectedAccountIdRef.current) return;
      void loadAccountTransactions(
        selectedAccountIdRef.current,
        buildFilterParams({ direction: nextDirection }),
      );
    },
    [buildFilterParams, loadAccountTransactions],
  );

  const handleSelectPeriod = useCallback(
    (nextPeriod: HistoryPeriodPreset) => {
      setPeriodFilter(nextPeriod);
      if (!selectedAccountIdRef.current || nextPeriod === "CUSTOM") return;
      void loadAccountTransactions(
        selectedAccountIdRef.current,
        buildFilterParams({ period: nextPeriod }),
        nextPeriod,
      );
    },
    [buildFilterParams, loadAccountTransactions],
  );

  const handleApplySearchAndDates = useCallback(() => {
    const trimmed = searchInput.trim();
    setAppliedQuery(trimmed);
    if (!selectedAccountIdRef.current) return;
    void loadAccountTransactions(
      selectedAccountIdRef.current,
      buildFilterParams({ q: trimmed }),
    );
  }, [buildFilterParams, loadAccountTransactions, searchInput]);

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
        ...buildFilterParams(),
      });
      setTransactions((currentTransactions) => [...currentTransactions, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (requestError: unknown) {
      setError(requestError);
    } finally {
      setIsLoadingMore(false);
    }
  }, [auth, buildFilterParams, isLoadingMore, nextCursor, selectedAccountId]);

  const handleExportStatement = useCallback(
    async (format: StatementExportFormat) => {
      if (!selectedAccountId || isExporting) return;
      setIsExporting(true);
      setExportNotice(null);
      try {
        const range = resolveDateRange(periodFilter, customFrom, customTo);
        const content = await exportAccountStatement(selectedAccountId, {
          auth,
          ...range,
          format,
        });
        try {
          await Clipboard.setStringAsync(content);
        } catch {
          // Clipboard may not be available in all test/device contexts
        }
        await Share.share({
          title: `Sao kê tài khoản NOVA (${format.toUpperCase()})`,
          message: content,
        });
        setExportNotice(
          `Đã chuẩn bị sao kê ${format.toUpperCase()} (${range.from ?? "từ đầu"} → ${range.to ?? "hiện tại"}).`,
        );
      } catch (exportError: unknown) {
        setError(exportError);
      } finally {
        setIsExporting(false);
      }
    },
    [auth, customFrom, customTo, isExporting, periodFilter, selectedAccountId],
  );

  const visibleTransactions = filterTransactions(transactions, statusFilter, directionFilter);
  const localSummary = useMemo(() => summarizeMonthlyCashFlow(transactions), [transactions]);
  const monthlySummary = serverSummary ?? localSummary;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          eyebrow="Tài khoản thanh toán"
          onBack={() => router.back()}
          subtitle="Tra cứu các khoản tiền vào, tiền ra và trạng thái xử lý."
          title="Lịch sử giao dịch"
        />

        <Button
          icon="alert"
          label="Xem cảnh báo giao dịch bất thường"
          onPress={() => router.push("/anomalies")}
          testID="history-open-anomalies"
          variant="secondary"
        />

        {accounts.length > 1 ? (
          <View style={styles.filterCard} testID="history-account-switcher">
            <Text style={styles.filterLabel}>Tài khoản thanh toán</Text>
            <View style={styles.filterRow}>
              {accounts.map((account) => {
                const selected = account.id === selectedAccountId;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={account.id}
                    onPress={() => handleSelectAccount(account.id)}
                    style={[styles.filterChip, selected ? styles.filterChipSelected : null]}
                    testID={`history-account-${account.id}`}
                  >
                    <Text style={[styles.filterChipLabel, selected ? styles.filterChipLabelSelected : null]}>
                      {account.displayName} · {account.maskedNumber}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {!isLoading && !error && selectedAccountId ? (
          <View style={styles.summaryCard} testID="history-summary">
            <View style={styles.summaryHeader}>
              <Text style={styles.summaryTitle}>Thống kê tháng {monthlySummary.monthLabel}</Text>
              <Text style={styles.summaryCount}>{monthlySummary.succeededCount} giao dịch thành công</Text>
            </View>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryCellLabel}>Tiền vào (Thu)</Text>
                <Text style={[styles.summaryCellValue, styles.creditAmount]} testID="history-summary-income">
                  +{formatVndMinor(monthlySummary.totalIncomeMinor)}
                </Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryCellLabel}>Tiền ra (Chi)</Text>
                <Text style={styles.summaryCellValue} testID="history-summary-expense">
                  −{formatVndMinor(monthlySummary.totalExpenseMinor)}
                </Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryCellLabel}>Chênh lệch ròng</Text>
                <Text
                  style={[
                    styles.summaryCellValue,
                    monthlySummary.netMinor.startsWith("-") ? styles.debitAmount : styles.creditAmount,
                  ]}
                  testID="history-summary-net"
                >
                  {formatSignedVndMinor(monthlySummary.netMinor)}
                </Text>
              </View>
            </View>
            <Text style={styles.summaryHint}>
              {serverSummary
                ? `Thống kê chính xác toàn bộ ${serverSummary.succeededCount} giao dịch thành công trong tháng trên hệ thống.`
                : nextCursor
                  ? `Đang tổng hợp trên ${transactions.length} giao dịch mới nhất đã tải. Bấm "Tải thêm giao dịch" để tính thêm các trang cũ hơn.`
                  : `Tổng hợp trên toàn bộ ${transactions.length} giao dịch đã tải.`}
            </Text>
            <View style={styles.exportRow}>
              <Button
                label="Xuất sao kê"
                loading={isExporting}
                onPress={() => void handleExportStatement("csv")}
                testID="history-export-statement"
                variant="outline"
              />
              <Button
                label="Xuất sao kê HTML"
                loading={isExporting}
                onPress={() => void handleExportStatement("html")}
                testID="history-export-statement-html"
                variant="secondary"
              />
            </View>
            {exportNotice ? (
              <Text style={styles.exportNotice} testID="history-export-notice">
                {exportNotice}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.filterCard} testID="history-filters">
          <View style={styles.filterHeader}>
            <View style={styles.filterIcon}>
              <AppIcon color={colors.primary} name="history" size={20} />
            </View>
            <Text style={styles.filterTitle}>Bộ lọc giao dịch</Text>
          </View>
          <View style={styles.searchRow}>
            <View style={styles.searchFieldWrap}>
              <TextField
                autoCapitalize="none"
                label="Tìm kiếm theo nội dung, đối tác hoặc mã tham chiếu"
                onChangeText={setSearchInput}
                onSubmitEditing={handleApplySearchAndDates}
                placeholder="VD: Nhận lương, REF-..."
                returnKeyType="search"
                testID="history-search-input"
                value={searchInput}
              />
            </View>
            <Button
              label="Tìm"
              onPress={handleApplySearchAndDates}
              testID="history-search-submit"
              variant="secondary"
            />
          </View>
          <Text style={styles.filterLabel}>Khoảng thời gian</Text>
          <View style={styles.filterRow}>
            {periodFilters.map((filter) => {
              const selected = periodFilter === filter.value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={filter.value}
                  onPress={() => handleSelectPeriod(filter.value)}
                  style={[styles.filterChip, selected ? styles.filterChipSelected : null]}
                  testID={`history-period-${filter.value.toLowerCase()}`}
                >
                  <Text style={[styles.filterChipLabel, selected ? styles.filterChipLabelSelected : null]}>
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {periodFilter === "CUSTOM" ? (
            <View style={styles.customDateBlock}>
              <TextField
                autoCapitalize="none"
                label="Từ ngày (YYYY-MM-DD)"
                onChangeText={setCustomFrom}
                placeholder="2026-11-01"
                testID="history-custom-from"
                value={customFrom}
              />
              <TextField
                autoCapitalize="none"
                label="Đến ngày (YYYY-MM-DD)"
                onChangeText={setCustomTo}
                placeholder="2026-11-30"
                testID="history-custom-to"
                value={customTo}
              />
              <Button
                label="Áp dụng khoảng thời gian"
                onPress={handleApplySearchAndDates}
                testID="history-apply-custom-dates"
                variant="outline"
              />
            </View>
          ) : null}
          <Text style={styles.filterLabel}>Trạng thái</Text>
          <View style={styles.filterRow}>
            {statusFilters.map((filter) => {
              const selected = statusFilter === filter.value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={filter.value}
                  onPress={() => handleSelectStatus(filter.value)}
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
                  onPress={() => handleSelectDirection(filter.value)}
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
                : nextCursor
                  ? `Không thấy giao dịch khớp bộ lọc trong ${transactions.length} giao dịch đã tải. Hãy đổi bộ lọc hoặc bấm "Tải thêm giao dịch" bên dưới.`
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
            testID="history-load-more"
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
  summaryCard: {
    gap: spacing.md,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  summaryTitle: { ...typography.subheading, color: colors.text },
  summaryCount: { ...typography.caption, color: colors.muted },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  summaryCell: {
    flex: 1,
    minWidth: 120,
    gap: 2,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  summaryCellLabel: { ...typography.caption, color: colors.muted },
  summaryCellValue: { ...typography.bodyStrong, color: colors.text },
  summaryHint: { ...typography.caption, color: colors.subtle },
  exportRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  exportNotice: {
    ...typography.caption,
    color: colors.success,
    fontWeight: "600",
  },
  searchRow: {
    gap: spacing.sm,
  },
  searchFieldWrap: {
    width: "100%",
  },
  customDateBlock: {
    gap: spacing.sm,
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
  debitAmount: { color: colors.danger },
});
