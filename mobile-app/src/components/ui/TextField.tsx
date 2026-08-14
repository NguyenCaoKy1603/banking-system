import { StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";

import { colors, spacing } from "@/theme";

type TextFieldProps = TextInputProps & {
  label: string;
};

export function TextField({ label, style, ...inputProps }: TextFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
});
