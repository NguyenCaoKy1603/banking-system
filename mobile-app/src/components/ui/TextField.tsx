import { type ReactNode } from "react";
import { StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";

import { colors, radius, sizes, spacing, typography } from "@/theme";

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
  helperText?: string;
  trailing?: ReactNode;
};

export function TextField({
  accessibilityLabel,
  error,
  helperText,
  label,
  onBlur,
  onFocus,
  style,
  trailing,
  ...inputProps
}: TextFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View
        pointerEvents="box-none"
        style={[
          styles.inputContainer,
          error ? styles.inputError : null,
          inputProps.editable === false ? styles.inputDisabled : null,
        ]}
      >
        <TextInput
          accessibilityLabel={accessibilityLabel ?? label}
          {...inputProps}
          onBlur={onBlur}
          onFocus={onFocus}
          placeholderTextColor={colors.subtle}
          style={[styles.input, style]}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  inputContainer: {
    minHeight: sizes.fieldHeight,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  inputDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  input: {
    minHeight: sizes.fieldHeight - 2,
    flex: 1,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  inputError: {
    borderColor: colors.danger,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
  helper: {
    ...typography.caption,
    color: colors.muted,
  },
  trailing: {
    minWidth: sizes.touchTarget,
    minHeight: sizes.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 2,
  },
});
