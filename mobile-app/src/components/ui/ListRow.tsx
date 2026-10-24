import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon, type AppIconName } from "@/components/ui/AppIcon";
import { colors, radius, sizes, spacing, typography } from "@/theme";

type ListRowProps = {
  icon: AppIconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
  testID?: string;
};

export function ListRow({ icon, title, subtitle, onPress, danger = false, testID }: ListRowProps) {
  const accent = danger ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={[styles.iconBox, danger ? styles.dangerIconBox : null]}>
        <AppIcon color={accent} name={icon} size={21} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, danger ? styles.dangerTitle : null]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <AppIcon color={colors.subtle} name="chevronRight" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.smd,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  iconBox: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  dangerIconBox: {
    backgroundColor: colors.dangerSoft,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  dangerTitle: {
    color: colors.danger,
  },
  subtitle: {
    ...typography.caption,
    color: colors.muted,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
});
