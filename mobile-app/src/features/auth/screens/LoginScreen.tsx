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
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { LoginFieldErrors, LoginFormValues } from "@/features/auth/types/auth";
import { validateLoginForm } from "@/features/auth/validation/authValidation";
import { colors, spacing } from "@/theme";

const initialValues: LoginFormValues = {
  email: "",
  password: "",
};

export function LoginScreen() {
  const { startDemoSession } = useAuth();
  const [values, setValues] = useState<LoginFormValues>(initialValues);
  const [errors, setErrors] = useState<LoginFieldErrors>({});

  function updateField(field: keyof LoginFormValues, value: string) {
    setValues((currentValues) => ({ ...currentValues, [field]: value }));
    setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
  }

  function handleDemoSession() {
    const result = validateLoginForm(values);

    setValues(result.values);
    setErrors(result.errors);

    if (result.isValid) {
      startDemoSession();
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
              Truy cập giao diện demo để tiếp tục xây dựng ứng dụng.
            </Text>
          </View>

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
              value={values.password}
            />
            <PrimaryButton label="Vào bản demo" onPress={handleDemoSession} />
          </View>

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
              Phiên điều hướng thử nghiệm – chưa xác thực với Backend.
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
});
