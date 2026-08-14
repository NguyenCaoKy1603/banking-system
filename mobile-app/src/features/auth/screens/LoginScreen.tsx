import { Link } from "expo-router";
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
import { colors, spacing } from "@/theme";

export function LoginScreen() {
  const { startDemoSession } = useAuth();

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
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              label="Email"
              placeholder="Nhập email"
            />
            <TextField
              autoCapitalize="none"
              autoComplete="current-password"
              label="Mật khẩu"
              placeholder="Nhập mật khẩu"
              secureTextEntry
            />
            <PrimaryButton label="Vào bản demo" onPress={startDemoSession} />
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
            <Text style={styles.noticeText}>Chế độ phát triển – chưa kết nối API</Text>
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
