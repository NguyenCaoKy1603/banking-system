import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon, type AppIconName } from "@/components/ui/AppIcon";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type QuickActionTileProps = {
  disabled?: boolean;
  icon: AppIconName;
  onPress?: () => void;
  subtitle: string;
  testID: string;
  title: string;
};

export function QuickActionTile({ disabled = false, icon, onPress, subtitle, testID, title }: QuickActionTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, disabled ? styles.disabledTile : null, pressed && !disabled ? styles.pressed : null]}
      testID={testID}
    >
      <View style={[styles.iconBadge, disabled ? styles.disabledIconBadge : null]}>
        <AppIcon color={disabled ? colors.muted : colors.primary} name={icon} size={23} />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.title}>{title}</Text>
        <Text numberOfLines={2} style={[styles.subtitle, disabled ? styles.disabledText : null]}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: 142,
    justifyContent: "space-between",
    gap: spacing.smd,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  disabledTile: { backgroundColor: colors.surfaceMuted, opacity: 0.78 },
  pressed: { opacity: 0.78, transform: [{ translateY: 1 }] },
  iconBadge: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.primarySoft },
  disabledIconBadge: { backgroundColor: colors.border },
  copy: { gap: spacing.xs },
  title: { ...typography.bodyStrong, color: colors.text },
  subtitle: { ...typography.caption, color: colors.primary },
  disabledText: { color: colors.muted },
});
