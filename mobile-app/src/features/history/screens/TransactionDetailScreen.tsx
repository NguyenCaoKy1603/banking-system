import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getTransactionDetail } from "@/features/accounts/services/accountsApi";
import type {
  TransactionDetail,
  TransactionDirection,
} from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getParam(value: string | string[] | undefined): string | null {
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  const trimmedValue = normalizedValue?.trim();
  return trimmedValue ? trimmedValue : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải chi tiết giao dịch. Vui lòng thử lại.";
}

function getStatusLabel(status: TransactionDetail["status"]): string {
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
  status: TransactionDetail["status"],
): "success" | "warning" | "danger" | "neutral" {
  if (status === "SUCCEEDED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "FAILED") return "danger";
  return "neutral";
}

function getDirectionLabel(direction: TransactionDirection): string {
  return direction === "CREDIT" ? "Tiền vào" : "Tiền ra";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export function TransactionDetailScreen() {
  const router = useRouter();
  const { accountId: accountIdParam, transactionId: transactionIdParam } =
    useLocalSearchParams<{
      accountId?: string | string[];
      transactionId?: string | string[];
    }>();
  const accountId = getParam(accountIdParam);
  const transactionId = getParam(transactionIdParam);
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const loadDetail = useCallback(async () => {
    if (!accessToken || !accountId || !transactionId) {
      setIsLoading(false);
      setError("Liên kết giao dịch không hợp lệ.");
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      setDetail(await getTransactionDetail(accountId, transactionId, auth));
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, accountId, auth, transactionId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadDetail());
  }, [loadDetail]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          eyebrow="Biên nhận"
          onBack={() => router.back()}
          subtitle="Đối chiếu số tiền, trạng thái và mã tham chiếu giao dịch."
          title="Chi tiết giao dịch"
        />

        {isLoading ? (
          <StateCard loading message="Đang tải chi tiết giao dịch..." />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            icon="alert"
            message={error}
            onAction={loadDetail}
            title="Không thể tải giao dịch"
          />
        ) : detail ? (
          <>
            <View style={styles.receiptCard}>
              <View
                style={[
                  styles.directionIcon,
                  detail.direction === "CREDIT" ? styles.creditIcon : styles.debitIcon,
                ]}
              >
                <AppIcon
                  color={detail.direction === "CREDIT" ? colors.success : colors.primary}
                  name="transfer"
                  size={27}
                />
              </View>
              <Text style={styles.directionLabel}>{getDirectionLabel(detail.direction)}</Text>
              <Text
                style={[
                  styles.amount,
                  detail.direction === "CREDIT" ? styles.creditAmount : null,
                ]}
              >
                {detail.direction === "CREDIT" ? "+" : "−"}
                {formatVndMinor(detail.amount.amountMinor)}
              </Text>
              <StatusBadge label={getStatusLabel(detail.status)} tone={getStatusTone(detail.status)} />
              <Text style={styles.description}>{detail.description}</Text>
            </View>

            <Card elevated>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <AppIcon color={colors.primary} name="account" size={19} />
                </View>
                <Text style={styles.sectionTitle}>Thông tin giao dịch</Text>
              </View>
              <View style={styles.detailList}>
                <DetailRow
                  label="Đối tác"
                  value={detail.counterpartyName ?? "Không có thông tin"}
                />
                <DetailRow label="Loại giao dịch" value={getDirectionLabel(detail.direction)} />
                <DetailRow label="Phí" value={formatVndMinor(detail.fee.amountMinor)} />
                <DetailRow label="Mã tham chiếu" value={detail.reference} />
                <DetailRow label="Thời gian tạo" value={formatDate(detail.createdAt)} />
                <DetailRow
                  label="Thời gian hoàn tất"
                  value={detail.completedAt ? formatDate(detail.completedAt) : "Chưa hoàn tất"}
                />
              </View>
            </Card>

          </>
        ) : (
          <StateCard icon="history" message="Giao dịch không còn khả dụng." title="Không có dữ liệu" />
        )}
      </ScrollView>
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
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
  receiptCard: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  directionIcon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
  },
  creditIcon: { backgroundColor: colors.successSoft, transform: [{ rotate: "180deg" }] },
  debitIcon: { backgroundColor: colors.primarySoft },
  directionLabel: { ...typography.label, color: colors.muted },
  amount: { ...typography.amount, color: colors.text, textAlign: "center" },
  creditAmount: { color: colors.success },
  description: { ...typography.bodyStrong, color: colors.text, textAlign: "center" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sectionIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  sectionTitle: { ...typography.subheading, color: colors.text },
  detailList: { gap: spacing.md },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  detailLabel: { ...typography.body, color: colors.muted },
  detailValue: { flex: 1, ...typography.bodyStrong, color: colors.text, textAlign: "right" },
});
