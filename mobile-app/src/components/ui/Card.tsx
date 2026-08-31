import type { PropsWithChildren } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius, shadows, spacing } from "@/theme";

type CardProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  testID?: string;
}>;

export function Card({ children, style, elevated = false, testID }: CardProps) {
  return (
    <View style={[styles.card, elevated ? shadows.card : null, style]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
});
