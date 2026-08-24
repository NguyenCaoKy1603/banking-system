import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import type {
  AuthChallengeResponse,
  RegisterFieldErrors,
  RegisterFormValues,
} from "@/features/auth/types/auth";
import { validateRegisterForm } from "@/features/auth/validation/authValidation";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

const initialValues: RegisterFormValues = {
  fullName: "",
  email: "",
  phoneNumber: "",
  password: "",
  confirmPassword: "",
};

export function RegisterScreen() {
  const router = useRouter();
  const { register, verifyRegistrationChallenge } = useAuth();
  const [values, setValues] = useState<RegisterFormValues>(initialValues);
  const [errors, setErrors] = useState<RegisterFieldErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registrationChallenge, setRegistrationChallenge] =
    useState<AuthChallengeResponse | null>(null);
  const [registrationOtp, setRegistrationOtp] = useState("");

  function updateField(field: keyof RegisterFormValues, value: string) {
    setValues((currentValues) => ({ ...currentValues, [field]: value }));
    setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
    setServerError(undefined);
  }

  async function handleRegister() {
    if (registrationChallenge) {
      if (!/^\d{6}$/.test(registrationOtp.trim())) {
        setServerError("Mã OTP phải gồm 6 chữ số.");
        return;
      }
      setIsSubmitting(true);
      setServerError(undefined);
      try {
        if (Date.now() >= Date.parse(registrationChallenge.expiresAt)) {
          setServerError(
            "Yêu cầu OTP đã hết hạn. Chọn thay đổi thông tin để đăng ký lại.",
          );
          return;
        }
        await verifyRegistrationChallenge({
          challengeId: registrationChallenge.challengeId,
          method: "OTP",
          proof: registrationOtp.trim(),
        });
        Alert.alert(
          "Đăng ký thành công",
          "Tài khoản thanh toán đã được tạo với số dư 0 VND.",
          [{ text: "Đăng nhập", onPress: () => router.replace("/login") }],
        );
      } catch (error: unknown) {
        setServerError(
          error instanceof ApiError
            ? error.message
            : "Không thể xác minh OTP đăng ký. Vui lòng thử lại.",
        );
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const result = validateRegisterForm(values);

    setValues(result.values);
    setErrors(result.errors);
    setServerError(undefined);

    if (!result.isValid) {
      return;
    }

    setIsSubmitting(true);

    try {
      const registrationResult = await register({
        fullName: result.values.fullName,
        email: result.values.email,
        phoneNumber: result.values.phoneNumber,
        password: result.values.password,
      });

      setRegistrationChallenge(registrationResult);
      setServerError("Mã OTP đã được yêu cầu. Nhập mã để hoàn tất đăng ký.");
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setErrors({
          fullName: error.fieldErrors?.fullName,
          email: error.fieldErrors?.email,
          phoneNumber: error.fieldErrors?.phoneNumber,
          password: error.fieldErrors?.password,
          confirmPassword: error.fieldErrors?.confirmPassword,
        });
        setServerError(error.message);
      } else {
        setServerError("Đăng ký không thành công. Vui lòng thử lại.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>TÀI KHOẢN MỚI</Text>
            <Text style={styles.title}>Đăng ký</Text>
            <Text style={styles.description}>
              Tạo tài khoản để đăng nhập vào hệ thống.
            </Text>
          </View>

          <View style={styles.form}>
            <TextField
              accessibilityLabel="Họ và tên đăng ký"
              autoCapitalize="words"
              autoComplete="name"
              error={errors.fullName}
              editable={!registrationChallenge}
              label="Họ và tên"
              onChangeText={(value) => updateField("fullName", value)}
              placeholder="Nhập họ và tên"
              testID="register-full-name"
              value={values.fullName}
            />
            <TextField
              accessibilityLabel="Email đăng ký"
              autoCapitalize="none"
              autoComplete="email"
              error={errors.email}
              editable={!registrationChallenge}
              keyboardType="email-address"
              label="Email"
              onChangeText={(value) => updateField("email", value)}
              placeholder="Nhập email"
              testID="register-email"
              value={values.email}
            />
            <TextField
              accessibilityLabel="Số điện thoại đăng ký"
              autoComplete="tel"
              error={errors.phoneNumber}
              editable={!registrationChallenge}
              keyboardType="phone-pad"
              label="Số điện thoại"
              onChangeText={(value) => updateField("phoneNumber", value)}
              placeholder="Nhập số điện thoại"
              testID="register-phone"
              value={values.phoneNumber}
            />
            <TextField
              accessibilityLabel="Mật khẩu đăng ký"
              autoCapitalize="none"
              autoComplete="new-password"
              error={errors.password}
              editable={!registrationChallenge}
              label="Mật khẩu"
              onChangeText={(value) => updateField("password", value)}
              placeholder="Nhập mật khẩu"
              secureTextEntry
              testID="register-password"
              value={values.password}
            />
            <TextField
              accessibilityLabel="Xác nhận mật khẩu đăng ký"
              autoCapitalize="none"
              autoComplete="new-password"
              error={errors.confirmPassword}
              editable={!registrationChallenge}
              label="Xác nhận mật khẩu"
              onChangeText={(value) => updateField("confirmPassword", value)}
              placeholder="Nhập lại mật khẩu"
              secureTextEntry
              testID="register-confirm-password"
              value={values.confirmPassword}
            />
            {registrationChallenge ? (
              <>
                <Text style={styles.challengeNotice}>
                  Thông tin đăng ký đã được khóa theo OTP này. Muốn sửa email, số điện thoại hoặc mật khẩu, hãy hủy bước OTP và đăng ký lại.
                </Text>
                <TextField
                  accessibilityLabel="Mã OTP đăng ký"
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  error={serverError}
                  keyboardType="number-pad"
                  label="Mã OTP đăng ký"
                  onChangeText={(value) => {
                    setRegistrationOtp(value.replace(/\D/g, "").slice(0, 6));
                    setServerError(undefined);
                  }}
                  placeholder="Nhập mã 6 chữ số"
                  secureTextEntry
                  testID="register-otp"
                  value={registrationOtp}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setRegistrationChallenge(null);
                    setRegistrationOtp("");
                    setServerError(undefined);
                  }}
                  testID="register-challenge-cancel"
                >
                  <Text style={styles.link}>Thay đổi thông tin đăng ký</Text>
                </Pressable>
              </>
            ) : null}
            {serverError && !registrationChallenge ? (
              <Text accessibilityLiveRegion="polite" style={styles.serverError}>
                {serverError}
              </Text>
            ) : null}
            <PrimaryButton
              disabled={isSubmitting}
              label={
                isSubmitting
                  ? registrationChallenge
                    ? "Đang xác minh..."
                    : "Đang đăng ký..."
                  : registrationChallenge
                    ? "Xác minh OTP"
                    : "Đăng ký"
              }
              onPress={handleRegister}
              testID="register-submit"
            />
          </View>

          <Link href="./login" replace asChild>
            <Pressable accessibilityRole="link" hitSlop={8} style={styles.backLink}>
              <Text style={styles.link}>Quay về đăng nhập</Text>
            </Pressable>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.xl,
  },
  intro: {
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "700",
  },
  description: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  form: {
    gap: spacing.md,
  },
  backLink: {
    alignSelf: "center",
    padding: spacing.sm,
  },
  link: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  serverError: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  challengeNotice: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
});
