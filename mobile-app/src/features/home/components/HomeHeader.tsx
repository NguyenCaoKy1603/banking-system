import { StyleSheet, Text, View } from "react-native";

import { BrandMark } from "@/components/brand/BrandMark";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { IconButton } from "@/components/ui/IconButton";
import { colors, spacing, typography } from "@/theme";

type HomeHeaderProps = {
  fullName: string;
  onNotifications: () => void;
  onMenu: () => void;
};

export function HomeHeader({ fullName, onNotifications, onMenu }: HomeHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <BrandMark />
        <View style={styles.actions}>
          <IconButton accessibilityLabel="Mở thông báo" icon="bell" onPress={onNotifications} testID="home-notifications" />
          <IconButton accessibilityLabel="Mở menu" icon="menu" onPress={onMenu} testID="home-menu" />
        </View>
      </View>
      <View style={styles.greetingRow}>
        <EnvironmentBadge />
        <View style={styles.greetingCopy}>
          <Text style={styles.kicker}>Chào buổi tốt lành</Text>
          <Text style={styles.greeting} testID="home-greeting">
            Xin chào, {fullName}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  actions: { flexDirection: "row", gap: spacing.sm },
  greetingRow: { alignItems: "flex-start", gap: spacing.smd },
  greetingCopy: { alignSelf: "stretch", gap: 2 },
  kicker: { ...typography.caption, color: colors.muted },
  greeting: { ...typography.title, color: colors.text },
});
