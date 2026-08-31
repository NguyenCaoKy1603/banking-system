import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { getCreditTransactionTypeLabel } from "@/features/credit/presentation/creditPresentation";
import { getCreditCard, listCreditTransactions } from "@/features/credit/services/creditApi";
import type { CreditTransaction } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Không thể tải giao dịch thẻ.";
}

function getStatusLabel(status: CreditTransaction["status"]): string {
  if (status === "POSTED") return "Đã ghi nhận";
  if (status === "PENDING") return "Đang xử lý";
  if (status === "REVERSED") return "Đã hoàn tác";
  return "Từ chối";
}

function getStatusTone(
  status: CreditTransaction["status"],
): "success" | "warning" | "danger" | "neutral" {
  if (status === "POSTED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "DECLINED") return "danger";
  return "neutral";
}

export function CreditTransactionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [items, setItems] = useState<CreditTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!accessToken || !cardId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const detail = await getCreditCard(cardId, auth);
      const response = await listCreditTransactions(detail.creditAccount.creditAccountId, {
        auth,
        limit: 100,
      });
      setItems(response.items);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth, cardId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          backTestID="credit-transactions-back"
          eyebrow="Hoạt động thẻ"
          onBack={() => router.back()}
          subtitle="Theo dõi giao dịch đã ghi nhận, đang xử lý hoặc được hoàn tác."
          title="Giao dịch thẻ"
        />

        {isLoading ? (
          <StateCard loading message="Đang tải giao dịch thẻ..." testID="credit-transactions-loading" />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            actionTestID="credit-transactions-retry"
            icon="alert"
            message={error}
            onAction={load}
            title="Không thể tải giao dịch"
          />
        ) : items.length === 0 ? (
          <StateCard
            icon="history"
            message="Các giao dịch phát sinh từ thẻ sẽ xuất hiện tại đây."
            testID="credit-transactions-empty"
            title="Chưa có giao dịch"
          />
        ) : (
          <View style={styles.list} testID="credit-transactions-list">
            {items.map((item) => (
              <View key={item.transactionId} style={styles.row}>
                <View
                  style={[
                    styles.iconBox,
                    item.debtEffect === "DECREASE" ? styles.decreaseIcon : null,
                  ]}
                >
                  <AppIcon
                    color={item.debtEffect === "DECREASE" ? colors.success : colors.primary}
                    name={item.debtEffect === "DECREASE" ? "transfer" : "card"}
                    size={20}
                  />
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>{getCreditTransactionTypeLabel(item.type)}</Text>
                  <Text numberOfLines={1} style={styles.rowDescription}>{item.description}</Text>
                  <Text style={styles.rowDate}>{new Date(item.occurredAt).toLocaleString("vi-VN")}</Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={[styles.amount, item.debtEffect === "DECREASE" ? styles.decrease : null]}>
                    {item.debtEffect === "DECREASE" ? "−" : item.debtEffect === "INCREASE" ? "+" : ""}
                    {formatVndMinor(item.amount.amountMinor)}
                  </Text>
                  <StatusBadge label={getStatusLabel(item.status)} tone={getStatusTone(item.status)} />
                </View>
              </View>
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
  list: { gap: spacing.sm },
  row: {
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
  iconBox: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  decreaseIcon: { backgroundColor: colors.successSoft },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowDescription: { ...typography.caption, color: colors.muted },
  rowDate: { ...typography.caption, color: colors.subtle },
  rowRight: { alignItems: "flex-end", gap: spacing.xs },
  amount: { ...typography.bodyStrong, color: colors.danger, textAlign: "right" },
  decrease: { color: colors.success },
});
