import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  getFraudReport,
  submitFraudReport,
} from "@/features/fraud/services/fraudReportsApi";
import {
  clearFraudReportIntent,
  loadFraudReportIntent,
  saveFraudReportIntent,
  type PendingFraudReportIntent,
} from "@/features/fraud/storage/fraudReportIntentStorage";
import { getFraudReportSubmitFailureDisposition } from "@/features/fraud/domain/fraudReportSubmitFailure";
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
  const userId = session?.user.id ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pendingIntent, setPendingIntent] =
    useState<PendingFraudReportIntent | null>(null);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [recoveryScope, setRecoveryScope] = useState<string | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);
  const scopeKey = `${userId ?? "anonymous"}:${accountId}:${transactionId}`;
  const recoveryChecked = recoveryScope === scopeKey;

  useEffect(() => {
    idempotencyKeyRef.current = null;
    let active = true;
    void (async () => {
      try {
        const intent = userId && accountId && transactionId
          ? await loadFraudReportIntent(userId, accountId, transactionId)
          : null;
        if (!active) return;
        setPendingIntent(null);
        setReportId(null);
        setReason("");
        setAlreadyReported(false);
        setRecoveryBlocked(false);
        setError(undefined);
        if (!intent) return;
        idempotencyKeyRef.current = intent.idempotencyKey;
        setReason(intent.request.reason);
        if (intent.report) {
          setReportId(intent.report.reportId);
          try {
            const current = await getFraudReport(intent.report.reportId, auth);
            if (active) setReportId(current.reportId);
          } catch {
            // The durable local receipt remains visible while status refresh is offline.
          }
        } else {
          setPendingIntent(intent);
        }
      } catch {
        if (!active) return;
        setRecoveryBlocked(true);
        setError(
          "Không thể kiểm tra yêu cầu báo cáo trước đó trên thiết bị. Tạm thời chưa thể gửi yêu cầu mới để tránh trùng lặp.",
        );
      } finally {
        if (active) setRecoveryScope(scopeKey);
      }
    })();
    return () => {
      active = false;
    };
  }, [accountId, auth, recoveryAttempt, scopeKey, transactionId, userId]);

  async function handleSubmit() {
    if (submitLockRef.current) return;
    if (!recoveryChecked || recoveryBlocked) {
      setError(
        "Chưa thể xác nhận trạng thái yêu cầu trước đó. Vui lòng thử lại sau.",
      );
      return;
    }
    if (!accountId || !transactionId) {
      setError("Liên kết giao dịch không hợp lệ.");
      return;
    }
    const submittedReason = pendingIntent?.request.reason ?? reason.trim();
    if (submittedReason.length < 5) {
      setError("Vui lòng mô tả ít nhất 5 ký tự.");
      return;
    }
    if (submittedReason.length > 1_000) {
      setError("Mô tả không được vượt quá 1.000 ký tự.");
      return;
    }
    if (!userId) {
      setError("Phiên đăng nhập không hợp lệ.");
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setError(undefined);

    let requestStarted = false;
    try {
      const idempotencyKey =
        idempotencyKeyRef.current ?? Crypto.randomUUID();
      idempotencyKeyRef.current = idempotencyKey;
      const request = pendingIntent?.request ?? {
        accountId,
        transactionId,
        reason: submittedReason,
      };
      const durableIntent: PendingFraudReportIntent = {
        userId,
        idempotencyKey,
        request,
        createdAt: pendingIntent?.createdAt ?? Date.now(),
      };
      await saveFraudReportIntent(durableIntent);
      setPendingIntent(durableIntent);
      requestStarted = true;
      const response = await submitFraudReport(
        request,
        { auth, idempotencyKey },
      );
      await saveFraudReportIntent({
        userId,
        idempotencyKey,
        request,
        createdAt: durableIntent.createdAt,
        report: response,
      });
      setPendingIntent(null);
      setReportId(response.reportId);
    } catch (requestError: unknown) {
      const disposition = getFraudReportSubmitFailureDisposition(requestError);
      if (requestStarted && disposition !== "RETRY_SAME_REQUEST") {
        const request = pendingIntent?.request ?? {
          accountId,
          transactionId,
          reason: submittedReason,
        };
        try {
          await clearFraudReportIntent(
            userId,
            request.accountId,
            request.transactionId,
          );
          idempotencyKeyRef.current = null;
          setPendingIntent(null);
          if (disposition === "RESET_ALREADY_EXISTS") {
            setAlreadyReported(true);
            setReason("");
            setError(
              "Giao dịch này đã có báo cáo đang được tiếp nhận. Không tạo thêm báo cáo.",
            );
          } else {
            setError(getErrorMessage(requestError));
          }
        } catch {
          // A failed cleanup must remain fail-closed: keep the durable intent
          // and require recovery rather than allowing a second report key.
          setRecoveryBlocked(true);
          setError(
            "Không thể xác nhận hoặc dọn yêu cầu báo cáo trước đó trên thiết bị. Vui lòng thử lại sau.",
          );
        }
      } else {
        setError(getErrorMessage(requestError));
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            if (reportId && userId) {
              void clearFraudReportIntent(userId, accountId, transactionId);
            }
            router.back();
          }}
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

        {recoveryBlocked ? (
          <View style={styles.card}>
            <Text style={styles.recoveryNotice}>
              {error ??
                "Không thể kiểm tra yêu cầu báo cáo trước đó trên thiết bị. Tạm thời chưa thể gửi yêu cầu mới để tránh tạo báo cáo trùng."}
            </Text>
            <PrimaryButton
              disabled={isSubmitting}
              label="Thử kiểm tra lại"
              onPress={() => {
                setError(undefined);
                setRecoveryScope(null);
                setRecoveryAttempt((attempt) => attempt + 1);
              }}
              testID="fraud-recovery-retry"
            />
          </View>
        ) : reportId ? (
          <View style={styles.card}>
            <Text style={styles.successTitle}>Đã tiếp nhận báo cáo</Text>
            <Text style={styles.description}>Mã báo cáo: {reportId}</Text>
            <PrimaryButton
              label="Về chi tiết giao dịch"
              onPress={() => {
                if (userId) {
                  void clearFraudReportIntent(userId, accountId, transactionId);
                }
                router.back();
              }}
            />
          </View>
        ) : (
          <View style={styles.card}>
            {pendingIntent ? (
              <Text style={styles.recoveryNotice}>
                Lần gửi trước chưa xác định kết quả. Nội dung đã được khóa; thử lại sẽ dùng đúng mã chống trùng lặp cũ.
              </Text>
            ) : null}
            <TextField
              accessibilityLabel="Lý do báo cáo"
              editable={!pendingIntent && !recoveryBlocked && !alreadyReported}
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
              disabled={
                isSubmitting ||
                !recoveryChecked ||
                recoveryBlocked ||
                alreadyReported
              }
              label={
                isSubmitting
                  ? "Đang gửi..."
                  : alreadyReported
                    ? "Đã có báo cáo"
                    : pendingIntent
                      ? "Kiểm tra lại yêu cầu"
                      : "Gửi báo cáo"
              }
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
  recoveryNotice: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
