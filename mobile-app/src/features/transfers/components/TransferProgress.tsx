import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "@/theme";

export type TransferProgressStep = "beneficiary" | "amount" | "review" | "stepUp" | "result";

const steps: { key: TransferProgressStep; label: string }[] = [
  { key: "beneficiary", label: "Người nhận" },
  { key: "amount", label: "Số tiền" },
  { key: "review", label: "Kiểm tra" },
  { key: "stepUp", label: "Xác thực" },
  { key: "result", label: "Kết quả" },
];

export function TransferProgress({ current }: { current: TransferProgressStep }) {
  const activeIndex = Math.max(0, steps.findIndex((item) => item.key === current));
  return (
    <View accessibilityLabel={`Bước ${activeIndex + 1} trên ${steps.length}: ${steps[activeIndex].label}`} style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.counter}>BƯỚC {activeIndex + 1}/{steps.length}</Text>
        <Text style={styles.label}>{steps[activeIndex].label}</Text>
      </View>
      <View style={styles.track}>
        {steps.map((item, index) => (
          <View
            key={item.key}
            style={[
              styles.segment,
              index <= activeIndex ? styles.segmentActive : null,
              index === 0 ? styles.firstSegment : null,
              index === steps.length - 1 ? styles.lastSegment : null,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  counter: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  label: {
    ...typography.label,
    color: colors.primary,
  },
  track: {
    height: 6,
    flexDirection: "row",
    gap: 4,
  },
  segment: {
    flex: 1,
    backgroundColor: colors.border,
  },
  segmentActive: {
    backgroundColor: colors.primary,
  },
  firstSegment: {
    borderTopLeftRadius: radius.pill,
    borderBottomLeftRadius: radius.pill,
  },
  lastSegment: {
    borderTopRightRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
  },
});
