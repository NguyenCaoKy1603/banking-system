import { Button } from "@/components/ui/Button";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
};

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  testID,
}: PrimaryButtonProps) {
  return (
    <Button
      disabled={disabled}
      label={label}
      onPress={onPress}
      testID={testID}
    />
  );
}
