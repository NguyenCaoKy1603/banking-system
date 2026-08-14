import { StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { colors, spacing } from "@/theme";

export function ProfileScreen() {
  const { endDemoSession } = useAuth();

  return (
    <Screen style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>HỒ SƠ</Text>
          <Text style={styles.title}>Thông tin cá nhân</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.emptyState}>Chưa có dữ liệu hồ sơ</Text>
          <Text style={styles.description}>
            Thông tin người dùng sẽ được lấy từ Backend sau khi API được kết nối.
          </Text>
        </View>

        <PrimaryButton label="Kết thúc phiên demo" onPress={endDemoSession} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
  },
  content: {
    flex: 1,
    width: "100%",
    maxWidth: 720,
    padding: spacing.lg,
    gap: spacing.xl,
  },
  header: {
    gap: spacing.xs,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "700",
  },
  card: {
    flex: 1,
    minHeight: 180,
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  emptyState: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "600",
  },
  description: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
});
