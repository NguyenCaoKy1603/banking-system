import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@/theme";

type QuickActionTileProps = {
  disabled?: boolean;
  icon: string;
  onPress?: () => void;
  subtitle: string;
  testID: string;
  title: string;
};

export function QuickActionTile({
  disabled = false,
  icon,
  onPress,
  subtitle,
  testID,
  title,
}: QuickActionTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        disabled ? styles.disabledTile : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <View style={[styles.iconBadge, disabled ? styles.disabledIconBadge : null]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={[styles.subtitle, disabled ? styles.disabledText : null]}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 132,
    justifyContent: "space-between",
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  disabledTile: {
    backgroundColor: colors.background,
    opacity: 0.78,
  },
  pressed: {
    opacity: 0.72,
  },
  iconBadge: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
  },
  disabledIconBadge: {
    backgroundColor: colors.border,
  },
  icon: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: "800",
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
  },
  subtitle: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  disabledText: {
    color: colors.muted,
  },
});
