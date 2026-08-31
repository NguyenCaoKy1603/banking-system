import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "@/theme";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

type StatusBadgeProps = {
  label: string;
  tone?: StatusTone;
  testID?: string;
};

export function StatusBadge({ label, tone = "neutral", testID }: StatusBadgeProps) {
  return (
    <View style={[styles.badge, toneStyles[tone].box]} testID={testID}>
      <Text style={[styles.label, toneStyles[tone].text]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.smd,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  label: {
    ...typography.caption,
    fontWeight: "800",
  },
  neutral: { backgroundColor: colors.surfaceMuted },
  neutralText: { color: colors.muted },
  success: { backgroundColor: colors.successSoft },
  successText: { color: colors.success },
  warning: { backgroundColor: colors.warningSoft },
  warningText: { color: colors.warning },
  danger: { backgroundColor: colors.dangerSoft },
  dangerText: { color: colors.danger },
  info: { backgroundColor: colors.infoSoft },
  infoText: { color: colors.info },
});

const toneStyles = {
  neutral: { box: styles.neutral, text: styles.neutralText },
  success: { box: styles.success, text: styles.successText },
  warning: { box: styles.warning, text: styles.warningText },
  danger: { box: styles.danger, text: styles.dangerText },
  info: { box: styles.info, text: styles.infoText },
};
