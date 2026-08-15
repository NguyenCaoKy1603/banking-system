import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@/theme";

type HomeHeaderProps = {
  fullName: string;
  onNotifications: () => void;
  onMenu: () => void;
};

export function HomeHeader({
  fullName,
  onNotifications,
  onMenu,
}: HomeHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <View style={styles.logoMark} accessibilityLabel="Logo NOVA">
            <Text style={styles.logoMarkText}>N</Text>
          </View>
          <View>
            <Text style={styles.logoName}>NOVA</Text>
            <Text style={styles.logoCaption}>Digital Banking</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mở thông báo"
            onPress={onNotifications}
            style={styles.notificationButton}
            testID="home-notifications"
          >
            <View style={styles.notificationMark}>
              <Text style={styles.notificationMarkText}>•</Text>
            </View>
            <Text style={styles.headerActionLabel}>Thông báo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mở menu"
            hitSlop={8}
            onPress={onMenu}
            style={styles.menuButton}
            testID="home-menu"
          >
            <Text style={styles.menuGlyph}>☰</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.greetingBlock}>
        <Text style={styles.greeting} testID="home-greeting">
          Xin chào, {fullName}
        </Text>
        <Text style={styles.subtitle}>Quản lý tài chính của bạn thật đơn giản.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  logoMark: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  logoMarkText: {
    color: colors.surface,
    fontSize: 22,
    fontWeight: "800",
  },
  logoName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  logoCaption: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  notificationButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: spacing.sm,
    backgroundColor: colors.surface,
  },
  notificationMark: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
  },
  notificationMarkText: {
    color: colors.primary,
    fontSize: 16,
    lineHeight: 16,
  },
  headerActionLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  menuButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  menuGlyph: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
  },
  greetingBlock: {
    gap: spacing.xs,
  },
  greeting: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
