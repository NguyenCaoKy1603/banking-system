import { StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import {
  getRequestErrorPresentation,
  type RequestErrorKind,
} from "@/components/ui/requestErrorPresentation";
import { colors, spacing } from "@/theme";

type RequestErrorNoticeProps = {
  error: unknown;
  fallbackMessage: string;
  onRetry: () => void;
  retryLabel?: string;
  isRetrying?: boolean;
  testID?: string;
};

export function RequestErrorNotice({
  error,
  fallbackMessage,
  onRetry,
  retryLabel = "Thử lại",
  isRetrying = false,
  testID = "request-error-notice",
}: RequestErrorNoticeProps) {
  const presentation = getRequestErrorPresentation(error, fallbackMessage);

  return (
    <View
      accessibilityRole="alert"
      style={[styles.container, stylesByKind[presentation.kind]]}
      testID={testID}
    >
      <Text style={styles.title}>{presentation.title}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.message}>
        {presentation.message}
      </Text>
      <PrimaryButton
        disabled={isRetrying}
        label={isRetrying ? "Đang thử lại..." : retryLabel}
        onPress={onRetry}
        testID={`${testID}-retry`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: 20,
  },
  containerOffline: {
    borderColor: colors.danger,
    backgroundColor: "#FFF4F5",
  },
  containerTimeout: {
    borderColor: "#D89000",
    backgroundColor: "#FFF9E8",
  },
  containerCancelled: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  containerGeneric: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  message: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});

const stylesByKind: Record<RequestErrorKind, object> = {
  offline: styles.containerOffline,
  timeout: styles.containerTimeout,
  cancelled: styles.containerCancelled,
  generic: styles.containerGeneric,
};
