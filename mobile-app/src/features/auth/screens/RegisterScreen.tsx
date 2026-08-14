import { Link } from "expo-router";
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
import type {
  RegisterFieldErrors,
  RegisterFormValues,
} from "@/features/auth/types/auth";
import { validateRegisterForm } from "@/features/auth/validation/authValidation";
import { colors, spacing } from "@/theme";

const initialValues: RegisterFormValues = {
  fullName: "",
  email: "",
  phoneNumber: "",
  password: "",
  confirmPassword: "",
};

export function RegisterScreen() {
  const [values, setValues] = useState<RegisterFormValues>(initialValues);
  const [errors, setErrors] = useState<RegisterFieldErrors>({});

  function updateField(field: keyof RegisterFormValues, value: string) {
    setValues((currentValues) => ({ ...currentValues, [field]: value }));
    setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
  }

  function handleRegister() {
    const result = validateRegisterForm(values);

    setValues(result.values);
    setErrors(result.errors);

    if (result.isValid) {
      Alert.alert("Thông báo", "Form hợp lệ nhưng Backend chưa được kết nối.");
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
              Biểu mẫu này mới là phần giao diện và chưa gửi dữ liệu đi đâu.
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
              value={values.confirmPassword}
            />
            <PrimaryButton label="Đăng ký" onPress={handleRegister} />
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
});
