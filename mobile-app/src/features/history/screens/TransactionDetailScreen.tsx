import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getTransactionDetail } from "@/features/accounts/services/accountsApi";
import type {
  TransactionDetail,
  TransactionDirection,
} from "@/features/accounts/types/account";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

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
      const response = await getTransactionDetail(
        accountId,
        transactionId,
        auth,
      );
      setDetail(response);
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
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>GIAO DỊCH</Text>
          <Text style={styles.title}>Chi tiết giao dịch</Text>
          <Text style={styles.description}>
            Trạng thái và thông tin dưới đây được lấy từ server.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorText}>{error}</Text>
            <PrimaryButton label="Thử lại" onPress={loadDetail} />
          </View>
        ) : detail ? (
          <View style={styles.card}>
            <Text style={styles.status}>{getStatusLabel(detail.status)}</Text>
            <Text
              style={[
                styles.amount,
                detail.direction === "CREDIT" ? styles.creditAmount : null,
              ]}
            >
              {detail.direction === "CREDIT" ? "+" : "-"}
              {formatVndMinor(detail.amount.amountMinor)}
            </Text>

            <View style={styles.detailList}>
              <DetailRow label="Mô tả" value={detail.description} />
              <DetailRow
                label="Đối tác"
                value={detail.counterpartyName ?? "Không có thông tin"}
              />
              <DetailRow label="Loại" value={getDirectionLabel(detail.direction)} />
              <DetailRow
                label="Phí"
                value={formatVndMinor(detail.fee.amountMinor)}
              />
              <DetailRow label="Mã tham chiếu" value={detail.reference} />
              <DetailRow label="Tạo lúc" value={formatDate(detail.createdAt)} />
              <DetailRow
                label="Hoàn tất lúc"
                value={detail.completedAt ? formatDate(detail.completedAt) : "—"}
              />
            </View>
            <PrimaryButton
              label="Báo cáo giao dịch đáng ngờ"
              onPress={() => {
                if (!accountId || !transactionId) {
                  return;
                }

                router.push({
                  pathname: "/fraud-report",
                  params: { accountId, transactionId },
                });
              }}
              testID="transaction-fraud-report"
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
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
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  status: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
  },
  amount: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
  },
  creditAmount: {
    color: colors.success,
  },
  detailList: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 14,
  },
  detailValue: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
