import { StyleSheet, Text, View } from "react-native";

import { IconButton } from "@/components/ui/IconButton";
import { colors, spacing, typography } from "@/theme";

type AppHeaderProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  onBack?: () => void;
  backTestID?: string;
};

export function AppHeader({ title, subtitle, eyebrow, onBack, backTestID }: AppHeaderProps) {
  return (
    <View style={styles.container}>
      {onBack ? (
        <IconButton accessibilityLabel="Quay lại" icon="back" onPress={onBack} testID={backTestID} />
      ) : null}
      <View style={styles.copy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  copy: {
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.label,
    color: colors.primary,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
  },
});
