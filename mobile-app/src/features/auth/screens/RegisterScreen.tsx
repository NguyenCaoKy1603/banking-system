import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BrandMark } from "@/components/brand/BrandMark";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
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
import { colors, radius, shadows, spacing, typography } from "@/theme";

const initialValues: RegisterFormValues = {
  fullName: "",
  email: "",
  phoneNumber: "",
  password: "",
  confirmPassword: "",
};

export function RegisterScreen() {
  const router = useRouter();
  const {
    register,
    resendRegistrationChallenge,
    verifyRegistrationChallenge,
    cancelRegistration,
  } = useAuth();
  const [values, setValues] = useState<RegisterFormValues>(initialValues);
  const [errors, setErrors] = useState<RegisterFieldErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [registrationChallenge, setRegistrationChallenge] =
    useState<AuthChallengeResponse | null>(null);
  const [registrationOtp, setRegistrationOtp] = useState("");
  const [challengeClock, setChallengeClock] = useState(() => Date.now());
  const clearRegistrationChallenge = useCallback(() => {
    setRegistrationChallenge(null);
    setRegistrationOtp("");
    setServerError(undefined);
  }, []);

  useEffect(() => {
    if (!registrationChallenge?.resendAfter) return undefined;
    const timer = setInterval(() => setChallengeClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [registrationChallenge?.resendAfter]);

  const resendSeconds = registrationChallenge?.resendAfter
    ? Math.max(0, Math.ceil((Date.parse(registrationChallenge.resendAfter) - challengeClock) / 1_000))
    : 0;

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
          method: registrationChallenge.method ?? "EMAIL_OTP",
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
      setChallengeClock(Date.now());
      setServerError(undefined);
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

  async function handleResendRegistrationChallenge() {
    if (!registrationChallenge || resendSeconds > 0 || isSubmitting || isCancelling) return;
    setServerError(undefined);
    try {
      const nextChallenge = await resendRegistrationChallenge(registrationChallenge.challengeId);
      setRegistrationChallenge(nextChallenge);
      setChallengeClock(Date.now());
      setRegistrationOtp("");
      setServerError(undefined);
    } catch (error: unknown) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : "Không thể gửi lại mã OTP. Vui lòng thử lại.",
      );
    }
  }

  const handleCancel = useCallback(async () => {
    if (!registrationChallenge || isSubmitting || isCancelling) return;

    setIsCancelling(true);
    setServerError(undefined);

    try {
      if (!cancelRegistration) {
        setServerError("Không thể hủy yêu cầu đăng ký. Vui lòng thử lại.");
        return;
      }
      await cancelRegistration(registrationChallenge.challengeId);
      clearRegistrationChallenge();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        clearRegistrationChallenge();
        router.replace("/login");
        return;
      }

      setServerError(
        error instanceof ApiError
          ? error.message
          : "Không thể hủy yêu cầu đăng ký. Vui lòng thử lại.",
      );
    } finally {
      setIsCancelling(false);
    }
  }, [
    cancelRegistration,
    clearRegistrationChallenge,
    isCancelling,
    isSubmitting,
    registrationChallenge,
    router,
  ]);

  useEffect(() => {
    if (!registrationChallenge) return undefined;

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        void handleCancel();
        return true;
      },
    );

    return () => subscription.remove();
  }, [handleCancel, registrationChallenge]);

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
          <View style={styles.brandRow}>
            <BrandMark />
            <EnvironmentBadge />
          </View>
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>BẮT ĐẦU VỚI NOVA</Text>
            <Text style={styles.title}>Tạo tài khoản</Text>
            <Text style={styles.description}>
              Điền thông tin bên dưới để tạo hồ sơ ngân hàng số của bạn.
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
                  Mã xác minh đã được gửi tới {registrationChallenge.maskedDestination ?? "email đăng ký"}. Thông tin được tạm khóa trong bước này để đảm bảo an toàn.
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
                  disabled={resendSeconds > 0 || isSubmitting || isCancelling}
                  onPress={() => void handleResendRegistrationChallenge()}
                  testID="register-otp-resend"
                >
                  <Text style={[styles.link, (resendSeconds > 0 || isSubmitting || isCancelling) && styles.disabledLink]}>
                    {resendSeconds > 0 ? `Gửi lại mã sau ${resendSeconds}s` : "Gửi lại mã OTP"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting || isCancelling}
                  onPress={() => void handleCancel()}
                  testID="register-challenge-cancel"
                >
                  <Text style={[styles.link, (isSubmitting || isCancelling) && styles.disabledLink]}>
                    {isCancelling ? "Đang hủy yêu cầu..." : "Hủy và thay đổi thông tin"}
                  </Text>
                </Pressable>
              </>
            ) : null}
            {serverError && !registrationChallenge ? (
              <Text accessibilityLiveRegion="polite" style={styles.serverError}>
                {serverError}
              </Text>
            ) : null}
            <PrimaryButton
              disabled={isSubmitting || isCancelling}
              label={
                isCancelling
                  ? "Đang hủy yêu cầu..."
                  : isSubmitting
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

          {registrationChallenge ? (
            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting || isCancelling}
              hitSlop={8}
              onPress={() => void handleCancel()}
              style={styles.backLink}
              testID="register-back-cancel"
            >
              <Text style={[styles.link, (isSubmitting || isCancelling) && styles.disabledLink]}>
                {isCancelling ? "Đang hủy yêu cầu..." : "Hủy yêu cầu và quay về đăng nhập"}
              </Text>
            </Pressable>
          ) : (
            <Link href="./login" replace asChild>
              <Pressable accessibilityRole="link" hitSlop={8} style={styles.backLink}>
                <Text style={styles.link}>Quay về đăng nhập</Text>
              </Pressable>
            </Link>
          )}
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
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  intro: {
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.label,
    color: colors.primary,
    letterSpacing: 1,
  },
  title: {
    ...typography.display,
    color: colors.text,
  },
  description: {
    ...typography.body,
    color: colors.muted,
  },
  form: {
    gap: spacing.md,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  backLink: {
    alignSelf: "center",
    padding: spacing.sm,
  },
  link: {
    ...typography.label,
    color: colors.primary,
  },
  disabledLink: {
    color: colors.muted,
  },
  serverError: {
    ...typography.body,
    padding: spacing.md,
    borderRadius: radius.md,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  challengeNotice: {
    ...typography.body,
    padding: spacing.md,
    borderRadius: radius.md,
    color: colors.info,
    backgroundColor: colors.infoSoft,
  },
});
