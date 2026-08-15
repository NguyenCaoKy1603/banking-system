import { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import { submitFraudReport } from "@/features/fraud/services/fraudReportsApi";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

function getParam(value: string | string[] | undefined): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized?.trim() ?? "";
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể gửi báo cáo. Vui lòng thử lại.";
}

export function FraudReportScreen() {
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
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit() {
    if (!accountId || !transactionId) {
      setError("Liên kết giao dịch không hợp lệ.");
      return;
    }
    if (reason.trim().length < 5) {
      setError("Vui lòng mô tả ít nhất 5 ký tự.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const response = await submitFraudReport(
        { accountId, transactionId, reason: reason.trim() },
        auth,
      );
      setReportId(response.reportId);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

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
          <Text style={styles.eyebrow}>AN TOÀN</Text>
          <Text style={styles.title}>Báo cáo giao dịch</Text>
          <Text style={styles.description}>
            Báo cáo được gửi đến fraud/risk engine. Không nhập OTP, password hoặc token.
          </Text>
        </View>

        {reportId ? (
          <View style={styles.card}>
            <Text style={styles.successTitle}>Đã tiếp nhận báo cáo</Text>
            <Text style={styles.description}>Mã báo cáo: {reportId}</Text>
            <PrimaryButton
              label="Về chi tiết giao dịch"
              onPress={() => router.back()}
            />
          </View>
        ) : (
          <View style={styles.card}>
            <TextField
              accessibilityLabel="Lý do báo cáo"
              error={error}
              label="Lý do báo cáo"
              multiline
              onChangeText={(value) => {
                setReason(value);
                setError(undefined);
              }}
              placeholder="Ví dụ: tôi không thực hiện giao dịch này"
              testID="fraud-reason"
              value={reason}
            />
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang gửi..." : "Gửi báo cáo"}
              onPress={handleSubmit}
              testID="fraud-submit"
            />
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
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  successTitle: {
    color: colors.success,
    fontSize: 20,
    fontWeight: "700",
  },
});
