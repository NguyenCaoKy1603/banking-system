import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { getCreditPaymentStatusLabel } from "@/features/credit/presentation/creditPresentation";
import { getCreditPayment } from "@/features/credit/services/creditApi";
import type { CreditPayment } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getStatusTone(
  status: CreditPayment["status"],
): "success" | "warning" | "danger" | "neutral" {
  if (status === "SUCCEEDED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "FAILED") return "danger";
  return "neutral";
}

export function CreditPaymentResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string; paymentId?: string }>();
  const cardId = typeof params.cardId === "string" ? params.cardId : "";
  const paymentId = typeof params.paymentId === "string" ? params.paymentId : "";
  const { deviceId, refreshAccessToken, session } = useAuth();
  const auth = useMemo(
    () => ({
      accessToken: session?.accessToken ?? null,
      deviceId,
      refreshAccessToken,
    }),
    [deviceId, refreshAccessToken, session?.accessToken],
  );
  const [payment, setPayment] = useState<CreditPayment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!auth.accessToken || !paymentId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      setPayment(await getCreditPayment(paymentId, auth));
    } catch (requestError: unknown) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Không thể tải trạng thái thanh toán.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [auth, paymentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          eyebrow="Biên nhận"
          onBack={() => router.back()}
          subtitle="Kiểm tra kết quả và mã tham chiếu của khoản thanh toán."
          title="Trạng thái thanh toán"
        />

        {isLoading ? (
          <StateCard loading message="Đang tải trạng thái thanh toán..." />
        ) : error ? (
          <StateCard
            actionLabel="Thử lại"
            icon="alert"
            message={error}
            onAction={load}
            title="Không thể tải kết quả"
          />
        ) : payment ? (
          <View style={styles.resultCard} testID="credit-payment-result-route">
            <View
              style={[
                styles.resultIcon,
                payment.status === "FAILED" ? styles.failedIcon : null,
                payment.status === "PENDING" ? styles.pendingIcon : null,
              ]}
            >
              <AppIcon
                color={
                  payment.status === "FAILED"
                    ? colors.danger
                    : payment.status === "PENDING"
                      ? colors.warning
                      : colors.success
                }
                name={payment.status === "FAILED" ? "alert" : payment.status === "PENDING" ? "history" : "check"}
                size={30}
              />
            </View>
            <StatusBadge
              label={getCreditPaymentStatusLabel(payment.status)}
              tone={getStatusTone(payment.status)}
            />
            <Text style={styles.amount}>{formatVndMinor(payment.amount.amountMinor)}</Text>
            <View style={styles.referenceBox}>
              <Text style={styles.referenceLabel}>Mã tham chiếu</Text>
              <Text selectable style={styles.referenceValue}>{payment.reference}</Text>
            </View>
            <Button
              icon="card"
              label="Về chi tiết thẻ"
              onPress={() =>
                router.replace({ pathname: "/cards/[cardId]", params: { cardId } })
              }
            />
          </View>
        ) : (
          <StateCard icon="transfer" message="Không tìm thấy khoản thanh toán." title="Không có dữ liệu" />
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
  resultCard: {
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  resultIcon: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.successSoft,
  },
  failedIcon: { backgroundColor: colors.dangerSoft },
  pendingIcon: { backgroundColor: colors.warningSoft },
  amount: { ...typography.amount, color: colors.text, textAlign: "center" },
  referenceBox: {
    width: "100%",
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  referenceLabel: { ...typography.caption, color: colors.muted, textAlign: "center" },
  referenceValue: { ...typography.bodyStrong, color: colors.text, textAlign: "center" },
});
