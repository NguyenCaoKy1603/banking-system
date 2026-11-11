import { useRouter } from "expo-router";
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { Button } from "@/components/ui/Button";
import { colors, radius, shadows, spacing, typography } from "@/theme";

type TotpRequiredNoticeProps = {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function TotpRequiredNotice({
  title = "Yêu cầu mã bảo mật TOTP",
  message = "Tài khoản của bạn chưa kích hoạt Google Authenticator (TOTP). Vui lòng thiết lập để thực hiện giao dịch này.",
  actionLabel = "Thiết lập mã TOTP ngay",
  onAction,
  style,
  testID = "totp-required-notice",
}: TotpRequiredNoticeProps) {
  const router = useRouter();

  const handlePress = () => {
    if (onAction) {
      onAction();
    } else {
      router.push("/mfa");
    }
  };

  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>🛡️</Text>
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
      <Button
        icon="shield"
        label={actionLabel}
        onPress={handlePress}
        testID={`${testID}-action`}
        variant="primary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.md,
    ...shadows.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 20,
  },
  textContainer: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.subheading,
    color: colors.text,
  },
  message: {
    ...typography.caption,
    color: colors.muted,
    lineHeight: 18,
  },
});
