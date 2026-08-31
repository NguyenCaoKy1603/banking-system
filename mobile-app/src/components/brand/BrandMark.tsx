import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { colors, radius, spacing, typography } from "@/theme";

type BrandMarkProps = {
  compact?: boolean;
  inverse?: boolean;
};

export function BrandMark({ compact = false, inverse = false }: BrandMarkProps) {
  const foreground = inverse ? colors.navy : colors.onPrimary;
  const markBackground = inverse ? colors.surface : colors.primary;
  const titleColor = inverse ? colors.surface : colors.navy;
  const captionColor = inverse ? "rgba(255,255,255,0.72)" : colors.muted;

  return (
    <View accessibilityLabel="NOVA Digital Banking" style={styles.container}>
      <View style={[styles.mark, { backgroundColor: markBackground }]}>
        <Svg width={30} height={30} viewBox="0 0 32 32" fill="none">
          <Path
            d="M7 24V8l18 16V8"
            stroke={foreground}
            strokeWidth={4.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      {!compact ? (
        <View style={styles.wordmark}>
          <Text style={[styles.name, { color: titleColor }]}>NOVA</Text>
          <Text style={[styles.caption, { color: captionColor }]}>DIGITAL BANKING</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.smd,
  },
  mark: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  wordmark: {
    gap: 1,
  },
  name: {
    ...typography.subheading,
    letterSpacing: 1.8,
  },
  caption: {
    ...typography.caption,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "700",
    letterSpacing: 0.9,
  },
});
