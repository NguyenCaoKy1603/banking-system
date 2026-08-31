import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AppIcon, type AppIconName } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { colors, typography } from "@/theme";

type StateCardProps = {
  title?: string;
  message: string;
  icon?: AppIconName;
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  actionTestID?: string;
  testID?: string;
};

export function StateCard({
  title,
  message,
  icon,
  loading = false,
  actionLabel,
  onAction,
  actionTestID,
  testID,
}: StateCardProps) {
  return (
    <Card style={styles.card} testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : icon ? (
        <View style={styles.iconBox}>
          <AppIcon color={colors.primary} name={icon} size={26} />
        </View>
      ) : null}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          testID={actionTestID}
          variant="secondary"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 164,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBox: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
  },
  title: {
    ...typography.subheading,
    color: colors.text,
    textAlign: "center",
  },
  message: {
    ...typography.body,
    color: colors.muted,
    textAlign: "center",
  },
});
