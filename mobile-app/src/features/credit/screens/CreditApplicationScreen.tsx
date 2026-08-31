import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { shouldKeepSubmitUnknown } from "@/features/banking/domain/submitFailure";
import { createIdempotencyKey } from "@/features/banking/validation/idempotencyKey";
import {
  activateCreditApplication,
  listCreditApplications,
  submitCreditApplication,
} from "@/features/credit/services/creditApi";
import { getCreditApplicationStatusLabel } from "@/features/credit/presentation/creditPresentation";
import type { CreditApplication } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Không thể xử lý đăng ký thẻ.";
}

async function fingerprint(value: unknown): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(value),
  );
}

export function CreditApplicationScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const auth = useMemo(
    () => ({ accessToken: session?.accessToken ?? null, deviceId, refreshAccessToken }),
    [deviceId, refreshAccessToken, session?.accessToken],
  );
  const [application, setApplication] = useState<CreditApplication | null>(null);
  const [requestedLimit, setRequestedLimit] = useState("20000000");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "verify-application" | "verify-activation">("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const idempotencyKeyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await listCreditApplications(auth);
      setApplication(response.items[0] ?? null);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    }
  }, [auth]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const requestApplicationOtp = useCallback(async () => {
    const normalized = requestedLimit.replace(/\D/g, "");
    if (!/^[1-9]\d*$/.test(normalized)) {
      setError("Hạn mức đề nghị phải là số nguyên dương.");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      const requestFingerprint = await fingerprint({ requestedLimitMinor: normalized });
      const challenge = await createOtpChallenge(
        {
          purpose: "CREDIT_APPLICATION",
          requestFingerprint,
        },
        auth,
      );
      idempotencyKeyRef.current = createIdempotencyKey("credit-application");
      setRequestedLimit(normalized);
      setChallengeId(challenge.challengeId);
      setMode("verify-application");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [auth, requestedLimit]);

  const requestActivationOtp = useCallback(async () => {
    if (!application) return;
    setIsSubmitting(true);
    setError(undefined);
    try {
      const challenge = await createOtpChallenge(
        { purpose: "CARD_ACTIVATION", resourceId: application.applicationId },
        auth,
      );
      idempotencyKeyRef.current = createIdempotencyKey("credit-activation");
      setChallengeId(challenge.challengeId);
      setOtp("");
      setMode("verify-activation");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [application, auth]);

  const verify = useCallback(async () => {
    if (!challengeId || !/^\d{6}$/.test(otp.trim())) {
      setError("Mã TOTP phải gồm 6 chữ số.");
      return;
    }
    const idempotencyKey = idempotencyKeyRef.current;
    if (!idempotencyKey) {
      setError("Yêu cầu gửi hồ sơ không còn hợp lệ. Vui lòng tạo lại mã xác thực.");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      if (mode === "verify-application") {
        const result = await submitCreditApplication(
          {
            requestedLimit: { currency: "VND", amountMinor: requestedLimit },
            stepUp: { method: "TOTP", proof: otp.trim(), challengeId },
          },
          { auth, idempotencyKey },
        );
        setApplication(result);
        setMode("idle");
        setChallengeId(null);
        idempotencyKeyRef.current = null;
        setOtp("");
      } else if (application) {
        const result = await activateCreditApplication(
          application.applicationId,
          { method: "TOTP", proof: otp.trim(), challengeId },
          { auth, idempotencyKey },
        );
        setApplication(result);
        setMode("idle");
        setChallengeId(null);
        idempotencyKeyRef.current = null;
        setOtp("");
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
      if (shouldKeepSubmitUnknown(requestError)) {
        try {
          const response = await listCreditApplications(auth);
          const recovered =
            mode === "verify-activation" && application
              ? response.items.find(
                  (item) => item.applicationId === application.applicationId,
                ) ?? null
              : response.items[0] ?? null;
          const isRecovered =
            (mode === "verify-application" &&
              recovered !== null &&
              (recovered.status === "SUBMITTED" ||
                recovered.status === "UNDER_REVIEW" ||
                recovered.status === "PENDING_ACTIVATION" ||
                recovered.status === "ACTIVE")) ||
            (mode === "verify-activation" && recovered?.status === "ACTIVE");
          if (isRecovered && recovered) {
            setApplication(recovered);
            setMode("idle");
            setChallengeId(null);
            idempotencyKeyRef.current = null;
            setOtp("");
            setError(undefined);
          }
        } catch {
          // Keep the original unknown outcome and idempotency key for retry.
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [application, auth, challengeId, mode, otp, requestedLimit]);

  const handleBack = useCallback(() => {
    if (isSubmitting) return;
    router.back();
  }, [isSubmitting, router]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          eyebrow="Sản phẩm thẻ"
          onBack={handleBack}
          subtitle="Đề nghị hạn mức, theo dõi xét duyệt và kích hoạt thẻ sau khi được chấp thuận."
          title="Đăng ký thẻ tín dụng"
        />
        <EnvironmentBadge />
        {application ? (
          <View style={styles.card} testID="credit-application-status">
            <Text style={styles.sectionTitle}>Trạng thái hồ sơ</Text>
            <Text style={styles.value}>{getCreditApplicationStatusLabel(application.status)}</Text>
            <Text style={styles.description}>{application.decisionReason ?? "Chưa có quyết định"}</Text>
            {application.status === "SUBMITTED" || application.status === "UNDER_REVIEW" ? (
              <Text style={styles.description}>
                Hồ sơ đang chờ nhân viên ngân hàng thẩm định. Bạn sẽ chỉ có thể kích hoạt sau khi được phê duyệt.
              </Text>
            ) : application.status === "PENDING_ACTIVATION" ? (
              <PrimaryButton
                disabled={isSubmitting || mode !== "idle"}
                label="Xác nhận và kích hoạt thẻ"
                onPress={() => void requestActivationOtp()}
                testID="credit-application-activate"
              />
            ) : application.status === "ACTIVE" ? (
              <PrimaryButton label="Xem thẻ" onPress={() => router.replace("/cards")} />
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Hạn mức đề nghị</Text>
            <TextField
              keyboardType="number-pad"
              editable={mode === "idle"}
              label="Hạn mức VND"
              onChangeText={(value) => setRequestedLimit(value.replace(/\D/g, ""))}
              testID="credit-application-limit"
              value={requestedLimit}
            />
            <PrimaryButton
              disabled={isSubmitting || mode !== "idle"}
              label={isSubmitting ? "Đang chuẩn bị xác thực..." : "Gửi hồ sơ đăng ký"}
              onPress={() => void requestApplicationOtp()}
              testID="credit-application-submit"
            />
          </View>
        )}
        {mode !== "idle" ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Nhập mã TOTP xác nhận</Text>
            <TextField
              keyboardType="number-pad"
              label="TOTP 6 chữ số"
              onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
              testID="credit-application-otp"
              value={otp}
              secureTextEntry
            />
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang xác minh..." : "Xác minh TOTP"}
              onPress={() => void verify()}
              testID="credit-application-verify"
            />
          </View>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, width: "100%", maxWidth: sizes.contentMaxWidth, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  description: { ...typography.body, color: colors.muted },
  card: { gap: spacing.md, padding: spacing.mlg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...shadows.card },
  sectionTitle: { ...typography.subheading, color: colors.text },
  value: { ...typography.bodyStrong, color: colors.primary },
  errorText: { ...typography.body, padding: spacing.md, borderRadius: radius.md, color: colors.danger, backgroundColor: colors.dangerSoft },
});
