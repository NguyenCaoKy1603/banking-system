import { Link, useRouter } from "expo-router";
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

import { BrandMark } from "@/components/brand/BrandMark";
import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import { forgotPassword, resetPassword } from "@/features/auth/services/authApi";
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import {
  validateForgotPasswordEmail,
  validateResetPasswordForm,
  type ResetPasswordFieldErrors,
} from "@/features/auth/validation/authValidation";
import { ApiError } from "@/services/api/ApiError";
import { colors, shadows, spacing, typography } from "@/theme";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function ForgotPasswordScreen() {
  const router = useRouter();
  const { deviceId } = useAuth();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [challenge, setChallenge] = useState<AuthChallengeResponse | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetErrors, setResetErrors] = useState<ResetPasswordFieldErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  async function handleRequestOtp() {
    if (!deviceId) {
      setServerError("Thiết bị chưa sẵn sàng để gửi yêu cầu.");
      return;
    }
    const validation = validateForgotPasswordEmail(email);
    setEmail(validation.normalizedEmail);
    setEmailError(validation.error);
    setServerError(undefined);
    if (validation.error) return;

    setIsSubmitting(true);
    try {
      const nextChallenge = await forgotPassword(
        { email: validation.normalizedEmail },
        { deviceId },
      );
      setChallenge(nextChallenge);
      setOtpCode("");
      setNewPassword("");
      setConfirmPassword("");
      setResetErrors({});
    } catch (error: unknown) {
      setServerError(errorMessage(error, "Không thể gửi yêu cầu đặt lại mật khẩu. Vui lòng thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword() {
    if (!deviceId || !challenge) {
      setServerError("Phiên đặt lại mật khẩu không hợp lệ.");
      return;
    }
    const validation = validateResetPasswordForm({
      otpCode,
      newPassword,
      confirmPassword,
    });
    setResetErrors(validation.errors);
    setServerError(undefined);
    if (!validation.isValid) return;

    setIsSubmitting(true);
    try {
      await resetPassword(
        {
          challengeId: challenge.challengeId,
          proof: validation.values.otpCode,
          newPassword: validation.values.newPassword,
        },
        { deviceId },
      );
      setIsCompleted(true);
      setNewPassword("");
      setConfirmPassword("");
      setOtpCode("");
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setResetErrors({
          otpCode: error.fieldErrors?.proof,
          newPassword: error.fieldErrors?.newPassword,
        });
      }
      setServerError(errorMessage(error, "Không thể đặt lại mật khẩu. Vui lòng kiểm tra mã OTP."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppHeader
            backTestID="forgot-back"
            eyebrow="KHÔI PHỤC TRUY CẬP"
            onBack={() => router.back()}
            subtitle="Xác nhận mã OTP qua email để đặt lại mật khẩu đăng nhập an toàn."
            title="Quên mật khẩu"
          />

          <View style={styles.brandRow}>
            <BrandMark compact />
          </View>

          {isCompleted ? (
            <Card elevated style={styles.card}>
              <View style={styles.successHeader}>
                <AppIcon color={colors.success} name="check" size={24} />
                <Text style={styles.successTitle}>Đặt lại mật khẩu thành công</Text>
              </View>
              <Text style={styles.helperText}>
                Mật khẩu mới đã được cập nhật và toàn bộ phiên đăng nhập cũ đã được thu hồi. Hãy đăng nhập lại bằng mật khẩu mới.
              </Text>
              <Button
                label="Về màn hình đăng nhập"
                onPress={() => router.replace("/login")}
                testID="forgot-back-to-login"
              />
            </Card>
          ) : !challenge ? (
            <Card elevated style={styles.card}>
              <Text style={styles.cardTitle}>Bước 1: Nhập email tài khoản</Text>
              <TextField
                accessibilityLabel="Email tài khoản"
                autoCapitalize="none"
                autoComplete="email"
                error={emailError}
                keyboardType="email-address"
                label="Email đăng ký"
                onChangeText={(value) => {
                  setEmail(value);
                  setEmailError(undefined);
                  setServerError(undefined);
                }}
                placeholder="tenban@example.com"
                testID="forgot-email"
                value={email}
              />
              {serverError ? <Text style={styles.errorText}>{serverError}</Text> : null}
              <Button
                disabled={isSubmitting}
                label="Gửi mã OTP qua email"
                loading={isSubmitting}
                onPress={() => void handleRequestOtp()}
                testID="forgot-submit"
              />
            </Card>
          ) : (
            <Card elevated style={styles.card}>
              <Text style={styles.cardTitle}>Bước 2: Nhập OTP & Mật khẩu mới</Text>
              <Text style={styles.helperText}>
                Nếu email hợp lệ, mã OTP gồm 6 chữ số đã được gửi tới{" "}
                <Text style={styles.boldText}>{challenge.maskedDestination ?? email}</Text>.
              </Text>
              <TextField
                accessibilityLabel="Mã OTP email"
                error={resetErrors.otpCode}
                keyboardType="number-pad"
                label="Mã OTP (6 chữ số)"
                maxLength={6}
                onChangeText={(value) => {
                  setOtpCode(value.replace(/\D/g, ""));
                  setResetErrors((prev) => ({ ...prev, otpCode: undefined }));
                  setServerError(undefined);
                }}
                placeholder="123456"
                testID="reset-otp"
                value={otpCode}
              />
              <TextField
                accessibilityLabel="Mật khẩu mới"
                autoCapitalize="none"
                error={resetErrors.newPassword}
                helperText="Tối thiểu 12 ký tự gồm chữ hoa, chữ thường, số và ký tự đặc biệt."
                label="Mật khẩu mới"
                onChangeText={(value) => {
                  setNewPassword(value);
                  setResetErrors((prev) => ({ ...prev, newPassword: undefined }));
                  setServerError(undefined);
                }}
                placeholder="Nhập mật khẩu mới"
                secureTextEntry
                testID="reset-new-password"
                value={newPassword}
              />
              <TextField
                accessibilityLabel="Xác nhận mật khẩu mới"
                autoCapitalize="none"
                error={resetErrors.confirmPassword}
                label="Xác nhận mật khẩu mới"
                onChangeText={(value) => {
                  setConfirmPassword(value);
                  setResetErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                  setServerError(undefined);
                }}
                placeholder="Nhập lại mật khẩu mới"
                secureTextEntry
                testID="reset-confirm-password"
                value={confirmPassword}
              />
              {serverError ? <Text style={styles.errorText}>{serverError}</Text> : null}
              <Button
                disabled={isSubmitting}
                label="Xác nhận đặt lại mật khẩu"
                loading={isSubmitting}
                onPress={() => void handleResetPassword()}
                testID="reset-submit"
              />
              <Button
                disabled={isSubmitting}
                label="Gửi lại mã OTP khác"
                onPress={() => {
                  setChallenge(null);
                  setServerError(undefined);
                }}
                testID="forgot-change-email"
                variant="outline"
              />
            </Card>
          )}

          <View style={styles.footer}>
            <Link href="./login" asChild>
              <Pressable accessibilityRole="link" hitSlop={8}>
                <Text style={styles.link}>Quay lại đăng nhập</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 500,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  brandRow: {
    alignItems: "flex-start",
  },
  card: {
    gap: spacing.md,
    ...shadows.card,
  },
  cardTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  helperText: {
    ...typography.body,
    color: colors.muted,
  },
  boldText: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
  },
  successHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  successTitle: {
    ...typography.heading,
    color: colors.text,
  },
  footer: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  link: {
    ...typography.bodyStrong,
    color: colors.primary,
  },
});
