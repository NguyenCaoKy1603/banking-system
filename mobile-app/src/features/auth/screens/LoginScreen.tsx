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

import { BrandMark } from "@/components/brand/BrandMark";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { LoginFieldErrors, LoginFormValues } from "@/features/auth/types/auth";
import { validateLoginForm } from "@/features/auth/validation/authValidation";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, spacing, typography } from "@/theme";

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
  const { login, logoutNotice } = useAuth();
  const [values, setValues] = useState<LoginFormValues>(initialValues);
  const [errors, setErrors] = useState<LoginFieldErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [requestError, setRequestError] = useState<unknown>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

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
          <View style={styles.brandBlock}>
            <BrandMark />
            <EnvironmentBadge />
          </View>

          <View style={styles.intro}>
            <Text style={styles.eyebrow}>CHÀO MỪNG TRỞ LẠI</Text>
            <Text style={styles.title}>Đăng nhập an toàn</Text>
            <Text style={styles.description}>Quản lý tài khoản và giao dịch của bạn trên NOVA.</Text>
          </View>

          {logoutNotice ? (
            <Text accessibilityLiveRegion="polite" style={styles.logoutNotice}>
              {logoutNotice}
            </Text>
          ) : null}

          <Card elevated style={styles.form}>
            <Text style={styles.formTitle}>Thông tin đăng nhập</Text>
            <TextField
              accessibilityLabel="Email đăng nhập"
              autoCapitalize="none"
              autoComplete="email"
              error={errors.email}
              keyboardType="email-address"
              label="Email"
              onChangeText={(value) => updateField("email", value)}
              placeholder="tenban@example.com"
              returnKeyType="next"
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
              onSubmitEditing={() => void handleLogin()}
              placeholder="Nhập mật khẩu"
              returnKeyType="done"
              secureTextEntry={!isPasswordVisible}
              testID="login-password"
              trailing={
                <Pressable
                  accessibilityLabel={isPasswordVisible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setIsPasswordVisible((current) => !current)}
                  testID="login-toggle-password"
                >
                  <AppIcon color={colors.muted} name={isPasswordVisible ? "eyeOff" : "eye"} size={21} />
                </Pressable>
              }
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
            <Button
              disabled={isSubmitting}
              label="Đăng nhập"
              loading={isSubmitting}
              onPress={handleLogin}
              testID="login-submit"
            />
          </Card>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Chưa có tài khoản?</Text>
            <Link href="./register" asChild>
              <Pressable accessibilityRole="link" hitSlop={8}>
                <Text style={styles.link}>Đăng ký ngay</Text>
              </Pressable>
            </Link>
          </View>

          <Link href="./recover" asChild>
            <Pressable accessibilityRole="link" hitSlop={8}>
              <Text style={styles.recoveryLink}>Mất Authenticator? Khôi phục bảo mật</Text>
            </Pressable>
          </Link>

          <View style={styles.notice}>
            <View style={styles.noticeIcon}>
              <AppIcon color={colors.success} name="shield" size={20} />
            </View>
            <Text style={styles.noticeText}>Phiên đăng nhập được mã hóa và lưu trong vùng bảo mật của thiết bị.</Text>
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
    maxWidth: 500,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  brandBlock: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  intro: {
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.label,
    color: colors.primary,
    letterSpacing: 0.9,
  },
  title: {
    ...typography.display,
    color: colors.text,
  },
  description: {
    ...typography.body,
    color: colors.muted,
  },
  form: {
    gap: spacing.md,
    ...shadows.card,
  },
  formTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  footerText: {
    ...typography.body,
    color: colors.muted,
  },
  link: {
    ...typography.bodyStrong,
    color: colors.primary,
  },
  recoveryLink: {
    ...typography.label,
    color: colors.primary,
    textAlign: "center",
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.smd,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.successSoft,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
  },
  noticeIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  noticeText: {
    flex: 1,
    ...typography.caption,
    color: colors.muted,
  },
  serverError: {
    ...typography.body,
    color: colors.danger,
  },
  logoutNotice: {
    ...typography.body,
    padding: spacing.smd,
    borderRadius: radius.sm,
    color: colors.warning,
    backgroundColor: colors.warningSoft,
  },
});
