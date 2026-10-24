import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import {
  formatCreditDate,
  getCreditStatementStatusLabel,
} from "@/features/credit/presentation/creditPresentation";
import { getCreditCard, listCreditStatements } from "@/features/credit/services/creditApi";
import type { CreditStatement } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Không thể tải sao kê thẻ.";
}

function getStatusTone(
  status: CreditStatement["status"],
): "success" | "warning" | "danger" | "info" {
  if (status === "PAID") return "success";
  if (status === "OVERDUE") return "danger";
  if (status === "PARTIALLY_PAID") return "warning";
  return "info";
}

export function CreditStatementsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [items, setItems] = useState<CreditStatement[]>([]);
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
      const response = await listCreditStatements(detail.creditAccount.creditAccountId, {
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
          backTestID="credit-statements-back"
          eyebrow="Quản lý dư nợ"
          onBack={() => router.back()}
          subtitle="Theo dõi kỳ sao kê, hạn thanh toán và số tiền còn phải trả."
          title="Sao kê thẻ"
        />

        {isLoading ? (
          <StateCard loading message="Đang tải sao kê..." testID="credit-statements-loading" />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            actionTestID="credit-statements-retry"
            icon="alert"
            message={error}
            onAction={load}
            title="Không thể tải sao kê"
          />
        ) : items.length === 0 ? (
          <StateCard
            icon="card"
            message="Sao kê sẽ xuất hiện sau khi kết thúc kỳ đầu tiên."
            testID="credit-statements-empty"
            title="Chưa có sao kê"
          />
        ) : (
          <View style={styles.list} testID="credit-statements-list">
            {items.map((item) => (
              <Pressable
                accessibilityLabel={`Mở sao kê kỳ ${formatCreditDate(item.cycleStartAt)}`}
                accessibilityRole="button"
                key={item.statementId}
                onPress={() =>
                  router.push({
                    pathname: "/cards/[cardId]/statements/[statementId]",
                    params: { cardId, statementId: item.statementId },
                  })
                }
                style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
                testID={`credit-statement-${item.statementId}`}
              >
                <View style={styles.iconBox}>
                  <AppIcon color={colors.primary} name="history" size={20} />
                </View>
                <View style={styles.rowMain}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle}>
                      {formatCreditDate(item.cycleStartAt)} – {formatCreditDate(item.cycleEndAt)}
                    </Text>
                    <StatusBadge
                      label={getCreditStatementStatusLabel(item.status)}
                      tone={getStatusTone(item.status)}
                    />
                  </View>
                  <Text style={styles.rowMeta}>Hạn thanh toán {formatCreditDate(item.dueAt)}</Text>
                  <Text style={styles.amountLabel}>Còn phải trả</Text>
                  <Text style={styles.amount}>{formatVndMinor(item.remainingAmountDue.amountMinor)}</Text>
                </View>
                <AppIcon color={colors.subtle} name="chevronRight" size={19} />
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
  list: { gap: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  iconBox: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  rowMain: { flex: 1, gap: spacing.xs },
  rowTitleLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  rowTitle: { flex: 1, ...typography.bodyStrong, color: colors.text },
  rowMeta: { ...typography.caption, color: colors.muted },
  amountLabel: { ...typography.caption, marginTop: spacing.xs, color: colors.muted },
  amount: { ...typography.heading, color: colors.text },
});
