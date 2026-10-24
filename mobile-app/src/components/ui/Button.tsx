import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon, type AppIconName } from "@/components/ui/AppIcon";
import { colors, radius, sizes, spacing, typography } from "@/theme";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: AppIconName;
  testID?: string;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  icon,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const selectedStyle = variantStyles[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        selectedStyle.container,
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={iconColors[variant]} size="small" />
        ) : icon ? (
          <AppIcon color={iconColors[variant]} name={icon} size={19} />
        ) : null}
        <Text style={[styles.label, selectedStyle.label]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: sizes.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  label: {
    ...typography.bodyStrong,
    textAlign: "center",
  },
  primary: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  primaryLabel: {
    color: colors.onPrimary,
  },
  secondary: {
    borderColor: colors.primarySoft,
    backgroundColor: colors.primarySoft,
  },
  secondaryLabel: {
    color: colors.primary,
  },
  outline: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  outlineLabel: {
    color: colors.primary,
  },
  ghost: {
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  ghostLabel: {
    color: colors.primary,
  },
  danger: {
    borderColor: colors.danger,
    backgroundColor: colors.danger,
  },
  dangerLabel: {
    color: colors.onPrimary,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.5,
  },
});

const variantStyles = {
  primary: { container: styles.primary, label: styles.primaryLabel },
  secondary: { container: styles.secondary, label: styles.secondaryLabel },
  outline: { container: styles.outline, label: styles.outlineLabel },
  ghost: { container: styles.ghost, label: styles.ghostLabel },
  danger: { container: styles.danger, label: styles.dangerLabel },
} as const;

const iconColors: Record<ButtonVariant, string> = {
  primary: colors.onPrimary,
  secondary: colors.primary,
  outline: colors.primary,
  ghost: colors.primary,
  danger: colors.onPrimary,
};
