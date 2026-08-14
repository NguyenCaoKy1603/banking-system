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
import { colors, spacing } from "@/theme";

export function RegisterScreen() {
  const [showBackendNotice, setShowBackendNotice] = useState(false);

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
              autoCapitalize="words"
              autoComplete="name"
              label="Họ và tên"
              placeholder="Nhập họ và tên"
            />
            <TextField
              autoComplete="tel"
              keyboardType="phone-pad"
              label="Số điện thoại"
              placeholder="Nhập số điện thoại"
            />
            <TextField
              autoCapitalize="none"
              autoComplete="new-password"
              label="Mật khẩu"
              placeholder="Nhập mật khẩu"
              secureTextEntry
            />
            <TextField
              autoCapitalize="none"
              autoComplete="new-password"
              label="Xác nhận mật khẩu"
              placeholder="Nhập lại mật khẩu"
              secureTextEntry
            />
            <PrimaryButton
              label="Đăng ký"
              onPress={() => setShowBackendNotice(true)}
            />
          </View>

          {showBackendNotice ? (
            <View accessibilityLiveRegion="polite" style={styles.notice}>
              <Text style={styles.noticeText}>
                Backend chưa được kết nối. Chưa có yêu cầu đăng ký nào được gửi.
              </Text>
            </View>
          ) : null}

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
  notice: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  noticeText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
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
