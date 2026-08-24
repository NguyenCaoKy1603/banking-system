import { Link } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { LoginFieldErrors, LoginFormValues } from "@/features/auth/types/auth";
import { validateLoginForm } from "@/features/auth/validation/authValidation";
import { ApiError } from "@/services/api/ApiError";
import {
  getSandboxBiometricProof,
  requestBiometricAuthentication,
} from "@/services/security/biometricAuth";
import { colors, spacing } from "@/theme";

const initialValues: LoginFormValues = {
  email: "",
  password: "",
};

function isRetryableRequestError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    ["NETWORK_ERROR", "TIMEOUT", "REQUEST_ABORTED"].includes(error.code)
  );
}

export function LoginScreen() {
  const {
    cancelLoginChallenge,
    login,
    logoutNotice,
    pendingLoginChallenge,
    verifyLoginChallenge,
  } = useAuth();
  const [values, setValues] = useState<LoginFormValues>(initialValues);
  const [errors, setErrors] = useState<LoginFieldErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [requestError, setRequestError] = useState<unknown>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [challengeProof, setChallengeProof] = useState("");
  const [isVerifyingChallenge, setIsVerifyingChallenge] = useState(false);

  function updateField(field: keyof LoginFormValues, value: string) {
    setValues((currentValues) => ({ ...currentValues, [field]: value }));
    setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
    setServerError(undefined);
    setRequestError(undefined);
  }

  async function handleLogin() {
    const result = validateLoginForm(values);

    setValues(result.values);
    setErrors(result.errors);
    setServerError(undefined);

    if (!result.isValid) {
      setRequestError(undefined);
      return;
    }

    setIsSubmitting(true);

    try {
      await login(result.values);
    } catch (error: unknown) {
      if (isRetryableRequestError(error)) {
        setRequestError(error);
        return;
      }

      setRequestError(undefined);
      if (error instanceof ApiError) {
        setErrors({
          email: error.fieldErrors?.email,
          password: error.fieldErrors?.password,
        });
        setServerError(error.message);
      } else {
        setServerError("Đăng nhập không thành công. Vui lòng thử lại.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyChallenge() {
    if (!pendingLoginChallenge || !pendingLoginChallenge.methods.includes("OTP")) {
      return;
    }
    if (Date.now() >= Date.parse(pendingLoginChallenge.expiresAt)) {
      setServerError(
        "Yêu cầu xác thực đã hết hạn. Hủy bước này và đăng nhập lại để nhận challenge mới.",
      );
      return;
    }

    if (!challengeProof.trim()) {
      setServerError("Mã xác thực bổ sung là bắt buộc.");
      return;
    }

    setIsVerifyingChallenge(true);
    setServerError(undefined);

    try {
      await verifyLoginChallenge({
        challengeId: pendingLoginChallenge.challengeId,
        method: "OTP",
        proof: challengeProof,
      });
    } catch (error: unknown) {
      if (isRetryableRequestError(error)) {
        setRequestError(error);
        return;
      }

      setRequestError(undefined);
      setServerError(
        error instanceof ApiError
          ? error.message
          : "Không thể xác thực bổ sung. Vui lòng thử lại.",
      );
    } finally {
      setIsVerifyingChallenge(false);
    }
  }

  async function handleVerifyBiometricChallenge() {
    if (
      !pendingLoginChallenge ||
      !pendingLoginChallenge.methods.includes("BIOMETRIC")
    ) {
      return;
    }
    if (Date.now() >= Date.parse(pendingLoginChallenge.expiresAt)) {
      setServerError(
        "Yêu cầu xác thực đã hết hạn. Hủy bước này và đăng nhập lại.",
      );
      return;
    }

    setIsVerifyingChallenge(true);
    setServerError(undefined);

    try {
      await requestBiometricAuthentication("Xác thực đăng nhập");
      const biometricProof = getSandboxBiometricProof();
      if (!biometricProof) {
        setServerError("Backend/risk provider chưa cung cấp biometric assertion.");
        return;
      }

      await verifyLoginChallenge({
        challengeId: pendingLoginChallenge.challengeId,
        method: "BIOMETRIC",
        proof: biometricProof,
      });
    } catch (error: unknown) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Không thể xác thực sinh trắc học. Vui lòng thử lại.",
      );
    } finally {
      setIsVerifyingChallenge(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>NGÂN HÀNG SỐ</Text>
            <Text style={styles.title}>Đăng nhập</Text>
            <Text style={styles.description}>
              Đăng nhập bằng tài khoản đã được đăng ký trên hệ thống.
            </Text>
          </View>

          {logoutNotice ? (
            <Text accessibilityLiveRegion="polite" style={styles.logoutNotice}>
              {logoutNotice}
            </Text>
          ) : null}

          {pendingLoginChallenge ? (
            <View style={styles.form}>
              <Text style={styles.challengeTitle}>Xác thực bổ sung</Text>
              <Text style={styles.description}>
                Hệ thống yêu cầu thêm một bước xác thực trước khi mở phiên đăng nhập.
              </Text>
              {pendingLoginChallenge.methods.includes("OTP") ? (
                <TextField
                  accessibilityLabel="Mã xác thực đăng nhập"
                  autoCapitalize="none"
                  error={serverError}
                  label="Mã OTP"
                  onChangeText={(value) => {
                    setChallengeProof(value);
                    setServerError(undefined);
                  }}
                  placeholder="Nhập mã xác thực"
                  secureTextEntry
                  testID="login-mfa-code"
                  value={challengeProof}
                />
              ) : null}
              {serverError ? (
                <Text accessibilityLiveRegion="polite" style={styles.serverError}>
                  {serverError}
                </Text>
              ) : null}
              {requestError ? (
                <RequestErrorNotice
                  error={requestError}
                  fallbackMessage="Không thể hoàn tất đăng nhập. Vui lòng thử lại."
                  isRetrying={isVerifyingChallenge}
                  onRetry={() => void handleVerifyChallenge()}
                  testID="login-request-error"
                />
              ) : null}
              {pendingLoginChallenge.methods.includes("OTP") ? (
                <PrimaryButton
                  disabled={isVerifyingChallenge}
                  label={isVerifyingChallenge ? "Đang xác thực..." : "Xác thực và đăng nhập"}
                  onPress={handleVerifyChallenge}
                  testID="login-mfa-submit"
                />
              ) : null}
              {pendingLoginChallenge.methods.includes("BIOMETRIC") ? (
                <PrimaryButton
                  disabled={isVerifyingChallenge}
                  label="Dùng sinh trắc học"
                  onPress={handleVerifyBiometricChallenge}
                  testID="login-mfa-biometric"
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  cancelLoginChallenge();
                  setChallengeProof("");
                  setServerError(undefined);
                  setRequestError(undefined);
                }}
                testID="login-mfa-cancel"
              >
                <Text style={styles.link}>Hủy và đăng nhập lại</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              <TextField
                accessibilityLabel="Email đăng nhập"
                autoCapitalize="none"
                autoComplete="email"
                error={errors.email}
                keyboardType="email-address"
                label="Email"
                onChangeText={(value) => updateField("email", value)}
                placeholder="Nhập email"
                testID="login-email"
                value={values.email}
              />
              <TextField
                accessibilityLabel="Mật khẩu đăng nhập"
                autoCapitalize="none"
                autoComplete="current-password"
                error={errors.password}
                label="Mật khẩu"
                onChangeText={(value) => updateField("password", value)}
                placeholder="Nhập mật khẩu"
                secureTextEntry
                testID="login-password"
                value={values.password}
              />
              {serverError ? (
                <Text accessibilityLiveRegion="polite" style={styles.serverError}>
                  {serverError}
                </Text>
              ) : null}
              {requestError ? (
                <RequestErrorNotice
                  error={requestError}
                  fallbackMessage="Không thể kết nối để đăng nhập. Vui lòng thử lại."
                  isRetrying={isSubmitting}
                  onRetry={() => void handleLogin()}
                  testID="login-request-error"
                />
              ) : null}
              <PrimaryButton
                disabled={isSubmitting}
                label={isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}
                onPress={handleLogin}
                testID="login-submit"
              />
            </View>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>Chưa có tài khoản?</Text>
            <Link href="./register" asChild>
              <Pressable accessibilityRole="link" hitSlop={8}>
                <Text style={styles.link}>Mở màn hình đăng ký</Text>
              </Pressable>
            </Link>
          </View>

          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Đăng nhập sẽ xác thực với API và lưu phiên bảo mật trên thiết bị.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.xl,
  },
  intro: {
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
    fontSize: 32,
    fontWeight: "700",
  },
  description: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  challengeTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  form: {
    gap: spacing.md,
  },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  footerText: {
    color: colors.muted,
    fontSize: 14,
  },
  link: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  notice: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  noticeText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
  },
  serverError: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  logoutNotice: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
