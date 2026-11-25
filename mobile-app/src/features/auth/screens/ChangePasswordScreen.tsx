import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  changePassword,
  createMfaChallenge,
  listMfaMethods,
} from "@/features/auth/services/authApi";
import type { AuthChallengeResponse } from "@/features/auth/types/auth";
import {
  validateChangePasswordForm,
  type ChangePasswordFieldErrors,
} from "@/features/auth/validation/authValidation";
import { ApiError } from "@/services/api/ApiError";
import { colors, shadows, sizes, spacing, typography } from "@/theme";

export function ChangePasswordScreen() {
  const router = useRouter();
  const { completeMfaRevocation, deviceId, refreshAccessToken, session } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<ChangePasswordFieldErrors>({});
  const [hasActiveTotp, setHasActiveTotp] = useState(false);
  const [totpChallenge, setTotpChallenge] = useState<AuthChallengeResponse | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const auth = useMemo(() => {
    if (!session || !deviceId) return null;
    return {
      accessToken: session.accessToken,
      deviceId,
      refreshAccessToken,
    };
  }, [deviceId, refreshAccessToken, session]);

  useEffect(() => {
    if (!auth) return;
    let active = true;
    const timer = setTimeout(() => {
      void listMfaMethods(auth)
        .then((res) => {
          if (!active) return;
          setHasActiveTotp(
            res.items.some((item) => item.status === "ACTIVE" && item.credentialType === "TOTP"),
          );
        })
        .catch(() => {
          // Non-blocking fail-safe; server enforces step-up if MFA is active.
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [auth]);

  async function handleRequestTotpChallenge() {
    if (!auth) return;
    setIsSubmitting(true);
    setServerError(undefined);
    setTotpError(undefined);
    try {
      const challenge = await createMfaChallenge(
        { purpose: "PASSWORD_CHANGE", method: "TOTP" },
        auth,
      );
      setTotpChallenge(challenge);
      setTotpCode("");
    } catch (error: unknown) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : "Không thể khởi tạo phiên xác thực TOTP.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!auth) return;
    const validation = validateChangePasswordForm({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    setErrors(validation.errors);
    setServerError(undefined);
    setTotpError(undefined);
    if (!validation.isValid) return;

    if (hasActiveTotp && !totpChallenge) {
      await handleRequestTotpChallenge();
      return;
    }

    if (totpChallenge && !/^\d{6}$/.test(totpCode.trim())) {
      setTotpError("Vui lòng nhập mã TOTP gồm đúng 6 chữ số.");
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(
        {
          currentPassword: validation.values.currentPassword,
          newPassword: validation.values.newPassword,
          ...(totpChallenge
            ? {
                stepUp: {
                  method: "TOTP" as const,
                  challengeId: totpChallenge.challengeId,
                  proof: totpCode.trim(),
                },
              }
            : {}),
        },
        auth,
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTotpCode("");
      await completeMfaRevocation({
        notice:
          "Đổi mật khẩu thành công. Toàn bộ phiên đăng nhập cũ đã được thu hồi. Vui lòng đăng nhập lại bằng mật khẩu mới.",
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        if (error.code === "MFA_STEP_UP_REQUIRED") {
          setHasActiveTotp(true);
          await handleRequestTotpChallenge();
          return;
        }
        setErrors({
          currentPassword: error.fieldErrors?.currentPassword,
          newPassword: error.fieldErrors?.newPassword,
        });
        setServerError(error.message);
      } else {
        setServerError("Không thể đổi mật khẩu. Vui lòng thử lại.");
      }
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
            backTestID="change-password-back"
            eyebrow="BẢO MẬT TÀI KHOẢN"
            onBack={() => router.back()}
            subtitle="Sau khi đổi mật khẩu, mọi phiên đăng nhập hiện tại sẽ bị thu hồi để bảo vệ tài khoản."
            title="Đổi mật khẩu"
          />

          <Card elevated style={styles.card}>
            <TextField
              accessibilityLabel="Mật khẩu hiện tại"
              autoCapitalize="none"
              error={errors.currentPassword}
              label="Mật khẩu hiện tại"
              onChangeText={(value) => {
                setCurrentPassword(value);
                setErrors((prev) => ({ ...prev, currentPassword: undefined }));
                setServerError(undefined);
              }}
              placeholder="Nhập mật khẩu đang dùng"
              secureTextEntry
              testID="change-current-password"
              value={currentPassword}
            />
            <TextField
              accessibilityLabel="Mật khẩu mới"
              autoCapitalize="none"
              error={errors.newPassword}
              helperText="Tối thiểu 12 ký tự gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt."
              label="Mật khẩu mới"
              onChangeText={(value) => {
                setNewPassword(value);
                setErrors((prev) => ({ ...prev, newPassword: undefined }));
                setServerError(undefined);
              }}
              placeholder="Nhập mật khẩu mới"
              secureTextEntry
              testID="change-new-password"
              value={newPassword}
            />
            <TextField
              accessibilityLabel="Xác nhận mật khẩu mới"
              autoCapitalize="none"
              error={errors.confirmPassword}
              label="Xác nhận mật khẩu mới"
              onChangeText={(value) => {
                setConfirmPassword(value);
                setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                setServerError(undefined);
              }}
              placeholder="Nhập lại mật khẩu mới"
              secureTextEntry
              testID="change-confirm-password"
              value={confirmPassword}
            />

            {hasActiveTotp ? (
              <View style={styles.mfaBox}>
                <View style={styles.mfaHeader}>
                  <AppIcon color={colors.primary} name="shield" size={18} />
                  <Text style={styles.mfaTitle}>Yêu cầu xác thực Google Authenticator (TOTP)</Text>
                </View>
                {totpChallenge ? (
                  <TextField
                    accessibilityLabel="Mã TOTP 6 chữ số"
                    error={totpError}
                    keyboardType="number-pad"
                    label="Mã TOTP (6 chữ số)"
                    maxLength={6}
                    onChangeText={(value) => {
                      setTotpCode(value.replace(/\D/g, ""));
                      setTotpError(undefined);
                      setServerError(undefined);
                    }}
                    placeholder="123456"
                    testID="change-totp-code"
                    value={totpCode}
                  />
                ) : (
                  <Text style={styles.mfaHint}>
                    Bấm &quot;Tiếp tục xác thực TOTP&quot; để lấy phiên xác nhận đổi mật khẩu.
                  </Text>
                )}
              </View>
            ) : null}

            {serverError ? <Text style={styles.errorText}>{serverError}</Text> : null}

            <Button
              disabled={isSubmitting}
              label={
                hasActiveTotp && !totpChallenge
                  ? "Tiếp tục xác thực TOTP"
                  : "Xác nhận đổi mật khẩu"
              }
              loading={isSubmitting}
              onPress={() => void handleSubmit()}
              testID="change-password-submit"
            />
          </Card>
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
    maxWidth: sizes.contentMaxWidth,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    gap: spacing.md,
    ...shadows.card,
  },
  mfaBox: {
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    gap: spacing.sm,
  },
  mfaHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  mfaTitle: {
    ...typography.label,
    color: colors.primary,
  },
  mfaHint: {
    ...typography.caption,
    color: colors.muted,
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
  },
});
