import { Link, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { BrandMark } from "@/components/brand/BrandMark";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  beginRecoveryTotpEnrollment,
  completeMfaRecovery,
  confirmRecoveryTotpEnrollment,
  startMfaRecovery,
} from "@/features/auth/services/authApi";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, spacing, typography } from "@/theme";

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Không thể hoàn tất khôi phục MFA.";
}

export function MfaRecoveryScreen() {
  const router = useRouter();
  const { deviceId } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [enrollment, setEnrollment] = useState<{ credentialId: string; manualSetupKey: string; otpauthUri: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const deviceOptions = useMemo(() => deviceId ? { deviceId } : null, [deviceId]);
  const cooldownRemaining = cooldownUntil === null ? 0 : Math.max(0, cooldownUntil - now);

  useEffect(() => {
    if (cooldownUntil === null || cooldownRemaining <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining, cooldownUntil]);

  async function handleStart() {
    if (!deviceOptions || !email.trim() || !password || recoveryCode.length < 16) {
      setError("Cần email, mật khẩu và mã khôi phục hợp lệ.");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      const response = await startMfaRecovery({ email, password, code: recoveryCode }, deviceOptions);
      setRecoveryToken(response.recoveryToken);
      setCooldownUntil(Date.parse(response.cooldownUntil));
      setNow(Date.now());
      setRecoveryCode("");
    } catch (startError: unknown) {
      setError(errorMessage(startError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleApprove() {
    if (!deviceOptions || !recoveryToken || cooldownRemaining > 0) return;
    setIsSubmitting(true);
    setError(undefined);
    try {
      await completeMfaRecovery(recoveryToken, deviceOptions);
      const setup = await beginRecoveryTotpEnrollment({ recoveryToken }, deviceOptions);
      setEnrollment(setup);
    } catch (approveError: unknown) {
      setError(errorMessage(approveError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!deviceOptions || !recoveryToken || !enrollment || !/^\d{6}$/.test(totpCode)) {
      setError("Mã TOTP phải gồm đúng 6 chữ số.");
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      await confirmRecoveryTotpEnrollment({ recoveryToken, credentialId: enrollment.credentialId, code: totpCode }, deviceOptions);
      router.replace("/login");
    } catch (confirmError: unknown) {
      setError(errorMessage(confirmError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BrandMark />
          <View style={styles.header}>
            <Text style={styles.eyebrow}>KHÔI PHỤC BẢO MẬT</Text>
            <Text style={styles.title}>Thiết lập Authenticator mới</Text>
            <Text style={styles.description}>Mã khôi phục chỉ dùng một lần. Các phiên và phương thức xác thực cũ sẽ được thu hồi để bảo vệ tài khoản.</Text>
          </View>

          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

          {!recoveryToken ? (
            <View style={styles.card}>
              <TextField autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="email@example.com" testID="mfa-recovery-email" value={email} />
              <TextField autoCapitalize="none" label="Mật khẩu" onChangeText={setPassword} placeholder="Nhập mật khẩu" secureTextEntry testID="mfa-recovery-password" value={password} />
              <TextField autoCapitalize="none" label="Recovery code" onChangeText={setRecoveryCode} placeholder="Dán recovery code" secureTextEntry testID="mfa-recovery-code" value={recoveryCode} />
              <PrimaryButton disabled={isSubmitting} label="Bắt đầu khôi phục" onPress={() => void handleStart()} testID="mfa-recovery-start" />
            </View>
          ) : !enrollment ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Đang trong cooldown</Text>
              <Text style={styles.description}>
                {cooldownRemaining > 0 ? `Còn ${Math.ceil(cooldownRemaining / 1000)} giây trước khi đăng ký factor mới.` : "Cooldown đã kết thúc. Tiếp tục để tạo khóa mới."}
              </Text>
              <PrimaryButton disabled={isSubmitting || cooldownRemaining > 0} label="Tiếp tục đăng ký Authenticator" onPress={() => void handleApprove()} testID="mfa-recovery-approve" />
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Xác nhận Authenticator mới</Text>
              <Text style={styles.description}>Quét QR hoặc nhập khóa thủ công. Không chia sẻ khóa này.</Text>
              <View style={styles.qrFrame}><QRCode value={enrollment.otpauthUri} size={210} /></View>
              <Text selectable style={styles.secret}>{enrollment.manualSetupKey}</Text>
              <TextField keyboardType="number-pad" label="Mã TOTP đầu tiên" onChangeText={(value) => setTotpCode(value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" secureTextEntry testID="mfa-recovery-totp" value={totpCode} />
              <PrimaryButton disabled={isSubmitting} label="Kích hoạt và quay lại đăng nhập" onPress={() => void handleConfirm()} testID="mfa-recovery-confirm" />
            </View>
          )}

          <Link href="./login" replace asChild><Pressable accessibilityRole="link"><Text style={styles.link}>Quay về đăng nhập</Text></Pressable></Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", width: "100%", maxWidth: 520, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  header: { gap: spacing.sm },
  eyebrow: { ...typography.label, color: colors.primary, letterSpacing: 1 },
  title: { ...typography.title, color: colors.text },
  description: { ...typography.body, color: colors.muted },
  sectionTitle: { ...typography.subheading, color: colors.text },
  card: { gap: spacing.md, padding: spacing.mlg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadows.card },
  qrFrame: { alignSelf: "center", padding: spacing.md, borderWidth: 2, borderColor: colors.primarySoft, borderRadius: radius.lg, backgroundColor: colors.surface },
  secret: { color: colors.text, fontSize: 16, fontWeight: "700", letterSpacing: 1.5 },
  error: { ...typography.body, padding: spacing.md, borderRadius: radius.md, color: colors.danger, backgroundColor: colors.dangerSoft },
  link: { color: colors.primary, fontSize: 14, fontWeight: "600", textAlign: "center" },
});
