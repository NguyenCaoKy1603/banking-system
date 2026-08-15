import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import type {
  RegisterFieldErrors,
  RegisterFormValues,
} from "@/features/auth/types/auth";
import { validateRegisterForm } from "@/features/auth/validation/authValidation";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

const initialValues: RegisterFormValues = {
  fullName: "",
  email: "",
  phoneNumber: "",
  password: "",
  confirmPassword: "",
};

export function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const [values, setValues] = useState<RegisterFormValues>(initialValues);
  const [errors, setErrors] = useState<RegisterFieldErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(field: keyof RegisterFormValues, value: string) {
    setValues((currentValues) => ({ ...currentValues, [field]: value }));
    setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
    setServerError(undefined);
  }

  async function handleRegister() {
    const result = validateRegisterForm(values);

    setValues(result.values);
    setErrors(result.errors);
    setServerError(undefined);

    if (!result.isValid) {
      return;
    }

    setIsSubmitting(true);

    try {
      await register({
        fullName: result.values.fullName,
        email: result.values.email,
        phoneNumber: result.values.phoneNumber,
        password: result.values.password,
      });

      Alert.alert(
        "Đăng ký thành công",
        "Bạn có thể sử dụng thông tin vừa đăng ký để đăng nhập.",
        [{ text: "Đăng nhập", onPress: () => router.replace("/login") }],
      );
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setErrors({
          fullName: error.fieldErrors?.fullName,
          email: error.fieldErrors?.email,
          phoneNumber: error.fieldErrors?.phoneNumber,
          password: error.fieldErrors?.password,
          confirmPassword: error.fieldErrors?.confirmPassword,
        });
        setServerError(error.message);
      } else {
        setServerError("Đăng ký không thành công. Vui lòng thử lại.");
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
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>TÀI KHOẢN MỚI</Text>
            <Text style={styles.title}>Đăng ký</Text>
            <Text style={styles.description}>
              Tạo tài khoản để đăng nhập vào hệ thống.
            </Text>
          </View>

          <View style={styles.form}>
            <TextField
              accessibilityLabel="Họ và tên đăng ký"
              autoCapitalize="words"
              autoComplete="name"
              error={errors.fullName}
              label="Họ và tên"
              onChangeText={(value) => updateField("fullName", value)}
              placeholder="Nhập họ và tên"
              testID="register-full-name"
              value={values.fullName}
            />
            <TextField
              accessibilityLabel="Email đăng ký"
              autoCapitalize="none"
              autoComplete="email"
              error={errors.email}
              keyboardType="email-address"
              label="Email"
              onChangeText={(value) => updateField("email", value)}
              placeholder="Nhập email"
              testID="register-email"
              value={values.email}
            />
            <TextField
              accessibilityLabel="Số điện thoại đăng ký"
              autoComplete="tel"
              error={errors.phoneNumber}
              keyboardType="phone-pad"
              label="Số điện thoại"
              onChangeText={(value) => updateField("phoneNumber", value)}
              placeholder="Nhập số điện thoại"
              testID="register-phone"
              value={values.phoneNumber}
            />
            <TextField
              accessibilityLabel="Mật khẩu đăng ký"
              autoCapitalize="none"
              autoComplete="new-password"
              error={errors.password}
              label="Mật khẩu"
              onChangeText={(value) => updateField("password", value)}
              placeholder="Nhập mật khẩu"
              secureTextEntry
              testID="register-password"
              value={values.password}
            />
            <TextField
              accessibilityLabel="Xác nhận mật khẩu đăng ký"
              autoCapitalize="none"
              autoComplete="new-password"
              error={errors.confirmPassword}
              label="Xác nhận mật khẩu"
              onChangeText={(value) => updateField("confirmPassword", value)}
              placeholder="Nhập lại mật khẩu"
              secureTextEntry
              testID="register-confirm-password"
              value={values.confirmPassword}
            />
            {serverError ? (
              <Text accessibilityLiveRegion="polite" style={styles.serverError}>
                {serverError}
              </Text>
            ) : null}
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang đăng ký..." : "Đăng ký"}
              onPress={handleRegister}
              testID="register-submit"
            />
          </View>

          <Link href="./login" replace asChild>
            <Pressable accessibilityRole="link" hitSlop={8} style={styles.backLink}>
              <Text style={styles.link}>Quay về đăng nhập</Text>
            </Pressable>
          </Link>
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
  form: {
    gap: spacing.md,
  },
  backLink: {
    alignSelf: "center",
    padding: spacing.sm,
  },
  link: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  serverError: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
