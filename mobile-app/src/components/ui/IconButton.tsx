import { Pressable, StyleSheet } from "react-native";

import { AppIcon, type AppIconName } from "@/components/ui/AppIcon";
import { colors, radius, sizes } from "@/theme";

type IconButtonProps = {
  accessibilityLabel: string;
  icon: AppIconName;
  onPress: () => void;
  inverse?: boolean;
  disabled?: boolean;
  testID?: string;
};

export function IconButton({
  accessibilityLabel,
  icon,
  onPress,
  inverse = false,
  disabled = false,
  testID,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        inverse ? styles.inverse : styles.standard,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <AppIcon
        color={inverse ? colors.onPrimary : colors.navy}
        name={icon}
        size={21}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.md,
  },
  standard: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  inverse: {
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.45,
  },
});
