import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  deleteRegistrationSession,
  loadRegistrationSession,
  saveRegistrationSession,
  type RegistrationSessionV1,
} from "@/features/auth/storage/registrationSessionStorage";
import type {
  AuthChallengeResponse,
  RegisterFieldErrors,
  RegisterFormValues,
} from "@/features/auth/types/auth";
import { validateRegisterForm } from "@/features/auth/validation/authValidation";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, spacing, typography } from "@/theme";

// ─── Types ───────────────────────────────────────────────────────────────────

type ScreenPhase =
  | { kind: "FORM" }
  | { kind: "OTP"; challenge: AuthChallengeResponse }
  | { kind: "RECOVERY_MANUAL"; reason: "BEGIN_UNKNOWN" }
  | { kind: "RECOVERY_BLOCKED"; reason: "CORRUPT" | "LOAD_ERROR" };

// ─── Statics ─────────────────────────────────────────────────────────────────

const initialValues: RegisterFormValues = {
  fullName: "",
  email: "",
  phoneNumber: "",
  password: "",
  confirmPassword: "",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function RegisterScreen() {
  const router = useRouter();
  const {
    register,
    resendRegistrationChallenge,
    verifyRegistrationChallenge,
    cancelRegistration,
  } = useAuth();

  const [phase, setPhase] = useState<ScreenPhase>({ kind: "FORM" });
  const [values, setValues] = useState<RegisterFormValues>(initialValues);
  const [errors, setErrors] = useState<RegisterFieldErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [registrationOtp, setRegistrationOtp] = useState("");
  const [challengeClock, setChallengeClock] = useState(() => Date.now());

  // Keep the latest persisted challenge available during resend/verify
  const persistedChallengeRef = useRef<AuthChallengeResponse | null>(null);

  // ─── Derived state ─────────────────────────────────────────────────────────

  const registrationChallenge =
    phase.kind === "OTP" ? phase.challenge : null;

  const resendSeconds = registrationChallenge?.resendAfter
    ? Math.max(
        0,
        Math.ceil(
          (Date.parse(registrationChallenge.resendAfter) - challengeClock) /
            1_000,
        ),
      )
    : 0;

  // ─── Restore on mount ──────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      let result;
      try {
        result = await loadRegistrationSession();
      } catch {
        // SecureStore hardware/OS error — block recovery, do not clear storage
        if (!cancelled) {
          setPhase({ kind: "RECOVERY_BLOCKED", reason: "LOAD_ERROR" });
        }
        return;
      }

      if (cancelled) return;

      if (result.kind === "EMPTY") {
        setPhase({ kind: "FORM" });
        return;
      }

      if (result.kind === "CORRUPT") {
        // Do not auto-delete; let user decide
        setPhase({ kind: "RECOVERY_BLOCKED", reason: "CORRUPT" });
        return;
      }

      // VALID
      const session = result.session;
      if (session.phase === "BEGIN_UNKNOWN") {
        // Manual retry required — do NOT auto-begin
        setPhase({ kind: "RECOVERY_MANUAL", reason: "BEGIN_UNKNOWN" });
        return;
      }

      if (session.phase === "CHALLENGE_RECEIVED") {
        // Restore OTP UI from persisted challenge
        const restored: AuthChallengeResponse = {
          challengeId: session.challengeId,
          methods: session.methods,
          purpose: session.purpose,
          expiresAt: session.expiresAt,
          resendAfter: session.resendAfter,
          method: "EMAIL_OTP",
        };
        persistedChallengeRef.current = restored;
        setPhase({ kind: "OTP", challenge: restored });
        setChallengeClock(Date.now());
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []); // mount-only, intentionally no deps

  // ─── Countdown clock ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!registrationChallenge?.resendAfter) return undefined;
    const timer = setInterval(() => setChallengeClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [registrationChallenge?.resendAfter]);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function updateField(field: keyof RegisterFormValues, value: string) {
    setValues((cur) => ({ ...cur, [field]: value }));
    setErrors((cur) => ({ ...cur, [field]: undefined }));
    setServerError(undefined);
  }

  const clearRegistrationChallenge = useCallback(() => {
    persistedChallengeRef.current = null;
    setPhase({ kind: "FORM" });
    setRegistrationOtp("");
    setServerError(undefined);
  }, []);

  // ─── Begin / Verify handler ────────────────────────────────────────────────

  async function handleRegister() {
    if (phase.kind === "OTP") {
      const challenge = phase.challenge;

      if (!/^\d{6}$/.test(registrationOtp.trim())) {
        setServerError("Mã OTP phải gồm 6 chữ số.");
        return;
      }
      setIsSubmitting(true);
      setServerError(undefined);
      try {
        if (Date.now() >= Date.parse(challenge.expiresAt)) {
          setServerError(
            "Yêu cầu OTP đã hết hạn. Chọn thay đổi thông tin để đăng ký lại.",
          );
          return;
        }
        await verifyRegistrationChallenge({
          challengeId: challenge.challengeId,
          method: challenge.method ?? "EMAIL_OTP",
          proof: registrationOtp.trim(),
        });
        // Verify succeeded — attempt to clear persisted session
        try {
          await deleteRegistrationSession();
        } catch {
          // Delete failed: do NOT retry or reverse. Just note it.
          // The stale session will be detected on next mount.
        }
        Alert.alert(
          "Đăng ký thành công",
          "Tài khoản thanh toán đã được tạo với số dư 0 VND.",
          [{ text: "Đăng nhập", onPress: () => router.replace("/login") }],
        );
        if (Platform.OS === "web") {
          router.replace("/login");
        }
      } catch (error: unknown) {
        // Verify failed — keep CHALLENGE_RECEIVED
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

    // ── Form submission (begin) ──

    const result = validateRegisterForm(values);
    setValues(result.values);
    setErrors(result.errors);
    setServerError(undefined);

    if (!result.isValid) return;

    setIsSubmitting(true);

    // Step 1: persist BEGIN_UNKNOWN before calling API
    const createdAt = new Date().toISOString();
    const beginSession: RegistrationSessionV1 = {
      schemaVersion: 1,
      phase: "BEGIN_UNKNOWN",
      createdAt,
    };

    try {
      await saveRegistrationSession(beginSession);
    } catch {
      // Write failed — do NOT call the API
      setServerError(
        "Không thể lưu trạng thái đăng ký. Vui lòng thử lại.",
      );
      setIsSubmitting(false);
      return;
    }

    // Step 2: call API
    try {
      const apiChallenge = await register({
        fullName: result.values.fullName,
        email: result.values.email,
        phoneNumber: result.values.phoneNumber,
        password: result.values.password,
      });

      // Step 3: persist CHALLENGE_RECEIVED
      const challengeSession: RegistrationSessionV1 = {
        schemaVersion: 1,
        phase: "CHALLENGE_RECEIVED",
        challengeId: apiChallenge.challengeId,
        methods: ["EMAIL_OTP"],
        purpose: "REGISTRATION_EMAIL_VERIFY",
        expiresAt: apiChallenge.expiresAt,
        ...(apiChallenge.resendAfter
          ? { resendAfter: apiChallenge.resendAfter }
          : {}),
        createdAt,
      };

      try {
        await saveRegistrationSession(challengeSession);
        persistedChallengeRef.current = apiChallenge;
      } catch {
        // Write CHALLENGE_RECEIVED failed — keep challenge in-memory only
        // Do NOT delete BEGIN_UNKNOWN; do NOT claim storage is clean
        persistedChallengeRef.current = apiChallenge;
      }

      setPhase({ kind: "OTP", challenge: apiChallenge });
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

  // ─── Resend ────────────────────────────────────────────────────────────────

  async function handleResendRegistrationChallenge() {
    if (
      phase.kind !== "OTP" ||
      resendSeconds > 0 ||
      isSubmitting ||
      isCancelling
    ) {
      return;
    }
    const challenge = phase.challenge;
    setServerError(undefined);
    try {
      const nextChallenge = await resendRegistrationChallenge(
        challenge.challengeId,
      );

      // Persist latest challenge metadata
      const updatedSession: RegistrationSessionV1 = {
        schemaVersion: 1,
        phase: "CHALLENGE_RECEIVED",
        challengeId: nextChallenge.challengeId,
        methods: ["EMAIL_OTP"],
        purpose: "REGISTRATION_EMAIL_VERIFY",
        expiresAt: nextChallenge.expiresAt,
        ...(nextChallenge.resendAfter
          ? { resendAfter: nextChallenge.resendAfter }
          : {}),
        createdAt: new Date().toISOString(),
      };
      try {
        await saveRegistrationSession(updatedSession);
        persistedChallengeRef.current = nextChallenge;
      } catch {
        // Persist failed — keep current in-memory session unchanged
      }

      setPhase({ kind: "OTP", challenge: nextChallenge });
      setChallengeClock(Date.now());
      setRegistrationOtp("");
      setServerError(undefined);
    } catch (error: unknown) {
      // Resend failed — keep existing session
      setServerError(
        error instanceof ApiError
          ? error.message
          : "Không thể gửi lại mã OTP. Vui lòng thử lại.",
      );
    }
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────

  const handleCancel = useCallback(async () => {
    // Do not cancel when phase is BEGIN_UNKNOWN (no challengeId on server yet)
    if (phase.kind !== "OTP" || isSubmitting || isCancelling) return;

    setIsCancelling(true);
    setServerError(undefined);

    try {
      if (!cancelRegistration) {
        setServerError("Không thể hủy yêu cầu đăng ký. Vui lòng thử lại.");
        return;
      }
      await cancelRegistration(phase.challenge.challengeId);

      // Cancel 204 success — delete persisted session
      try {
        await deleteRegistrationSession();
      } catch {
        // Delete failed — session may remain stale; caller is informed via UI
      }
      clearRegistrationChallenge();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        // 409 completed — clear locally regardless
        try {
          await deleteRegistrationSession();
        } catch {
          // Best-effort; completed means we still navigate away
        }
        clearRegistrationChallenge();
        router.replace("/login");
        return;
      }

      // 404, 422, timeout, network — keep persisted session
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
    phase,
    router,
  ]);

  // ─── Android back button ───────────────────────────────────────────────────

  useEffect(() => {
    if (phase.kind !== "OTP") return undefined;

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        void handleCancel();
        return true;
      },
    );

    return () => subscription.remove();
  }, [handleCancel, phase.kind]);

  // ─── Recovery actions ──────────────────────────────────────────────────────

  async function handleRecoveryReset() {
    try {
      await deleteRegistrationSession();
      if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem("banking.registration.session.v1");
      }
      setPhase({ kind: "FORM" });
    } catch {
      setServerError(
        "Không thể xóa dữ liệu phục hồi. Vui lòng khởi động lại ứng dụng.",
      );
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (
    phase.kind === "RECOVERY_BLOCKED" ||
    phase.kind === "RECOVERY_MANUAL"
  ) {
    const message =
      phase.kind === "RECOVERY_BLOCKED"
        ? "Không thể đọc dữ liệu đăng ký. Vui lòng xóa và thử lại."
        : "Phát hiện đăng ký chưa hoàn thành. Vui lòng điền lại thông tin để tiếp tục.";

    return (
      <Screen>
        <View style={styles.content}>
          <Text style={styles.serverError} testID="register-recovery-message">
            {message}
          </Text>
          {serverError ? (
            <Text style={styles.serverError}>{serverError}</Text>
          ) : null}
          <PrimaryButton
            label="Xóa và bắt đầu lại"
            onPress={() => void handleRecoveryReset()}
            testID="register-recovery-reset"
          />
        </View>
      </Screen>
    );
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
                  Mã xác minh đã được gửi tới{" "}
                  {registrationChallenge.maskedDestination ?? "email đăng ký"}.
                  Thông tin được tạm khóa trong bước này để đảm bảo an toàn.
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
                  <Text
                    style={[
                      styles.link,
                      (resendSeconds > 0 || isSubmitting || isCancelling) &&
                        styles.disabledLink,
                    ]}
                  >
                    {resendSeconds > 0
                      ? `Gửi lại mã sau ${resendSeconds}s`
                      : "Gửi lại mã OTP"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting || isCancelling}
                  onPress={() => void handleCancel()}
                  testID="register-challenge-cancel"
                >
                  <Text
                    style={[
                      styles.link,
                      (isSubmitting || isCancelling) && styles.disabledLink,
                    ]}
                  >
                    {isCancelling
                      ? "Đang hủy yêu cầu..."
                      : "Hủy và thay đổi thông tin"}
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
              <Text
                style={[
                  styles.link,
                  (isSubmitting || isCancelling) && styles.disabledLink,
                ]}
              >
                {isCancelling
                  ? "Đang hủy yêu cầu..."
                  : "Hủy yêu cầu và quay về đăng nhập"}
              </Text>
            </Pressable>
          ) : (
            <Link href="./login" replace asChild>
              <Pressable
                accessibilityRole="link"
                hitSlop={8}
                style={styles.backLink}
              >
                <Text style={styles.link}>Quay về đăng nhập</Text>
              </Pressable>
            </Link>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

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
