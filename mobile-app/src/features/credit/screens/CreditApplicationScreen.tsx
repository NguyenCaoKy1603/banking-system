import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import {
  activateCreditApplication,
  listCreditApplications,
  submitCreditApplication,
} from "@/features/credit/services/creditApi";
import type { CreditApplication } from "@/features/credit/types/credit";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Không thể xử lý đăng ký thẻ sandbox.";
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
      setError("Mã OTP phải gồm 6 chữ số.");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      if (mode === "verify-application") {
        const result = await submitCreditApplication(
          {
            requestedLimit: { currency: "VND", amountMinor: requestedLimit },
            stepUp: { method: "OTP", proof: otp.trim(), challengeId },
          },
          { auth, idempotencyKey: `credit-application-${Date.now()}` },
        );
        setApplication(result);
        setMode("idle");
        setChallengeId(null);
        setOtp("");
      } else if (application) {
        const result = await activateCreditApplication(
          application.applicationId,
          { method: "OTP", proof: otp.trim(), challengeId },
          { auth, idempotencyKey: `credit-activation-${Date.now()}` },
        );
        setApplication(result);
        setMode("idle");
        setChallengeId(null);
        setOtp("");
      }
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }, [application, auth, challengeId, mode, otp, requestedLimit]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>CREDIT SANDBOX</Text>
          <Text style={styles.title}>Đăng ký thẻ tín dụng</Text>
          <Text style={styles.description}>
            Đây là luồng mô phỏng. Hệ thống chỉ tạo thẻ sau khi bạn xác nhận kích hoạt.
          </Text>
        </View>
        {application ? (
          <View style={styles.card} testID="credit-application-status">
            <Text style={styles.sectionTitle}>Trạng thái hồ sơ</Text>
            <Text style={styles.value}>{application.status}</Text>
            <Text style={styles.description}>{application.decisionReason ?? "Chưa có quyết định"}</Text>
            {application.status === "PENDING_ACTIVATION" ? (
              <PrimaryButton
                disabled={isSubmitting}
                label="Xác nhận và kích hoạt thẻ sandbox"
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
              label="Hạn mức VND"
              onChangeText={(value) => setRequestedLimit(value.replace(/\D/g, ""))}
              testID="credit-application-limit"
              value={requestedLimit}
            />
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang tạo OTP..." : "Gửi hồ sơ sandbox"}
              onPress={() => void requestApplicationOtp()}
              testID="credit-application-submit"
            />
          </View>
        )}
        {mode !== "idle" ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Nhập OTP xác nhận</Text>
            <TextField
              keyboardType="number-pad"
              label="OTP 6 chữ số"
              onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
              testID="credit-application-otp"
              value={otp}
              secureTextEntry
            />
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang xác minh..." : "Xác minh OTP"}
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
  content: { flexGrow: 1, width: "100%", maxWidth: 720, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  backButton: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  backLabel: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  header: { gap: spacing.sm },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 30, fontWeight: "800" },
  description: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  value: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
