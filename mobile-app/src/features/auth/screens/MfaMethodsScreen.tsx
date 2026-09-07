import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { AppHeader } from "@/components/ui/AppHeader";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  createMfaChallenge,
  listMfaMethods,
  revokeMfaMethod,
  rotateRecoveryCodes,
} from "@/features/auth/services/authApi";
import type {
  AuthChallengeResponse,
  MfaCredentialSummary,
  MfaLifecyclePurpose,
  TotpEnrollmentResponse,
} from "@/features/auth/types/auth";
import { useAuth } from "@/features/auth/context/AuthContext";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

type PendingAction =
  | { kind: "remove"; credential: MfaCredentialSummary }
  | { kind: "rotate" }
  | { kind: "enroll" };

function authenticatedOptions(
  accessToken: string,
  deviceId: string,
  refreshAccessToken: () => Promise<string | null>,
) {
  return { accessToken, deviceId, refreshAccessToken };
}

function getMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function isTerminalChallengeError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 401 || error.code === "MFA_REPLAY_DETECTED";
}

export function MfaMethodsScreen() {
  const router = useRouter();
  const { completeMfaRevocation, deviceId, refreshAccessToken, session } = useAuth();
  const [credentials, setCredentials] = useState<MfaCredentialSummary[]>([]);
  const [password, setPassword] = useState("");
  const [enrollment, setEnrollment] = useState<TotpEnrollmentResponse | null>(null);
  const [confirmationCode, setConfirmationCode] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [challenge, setChallenge] = useState<AuthChallengeResponse | null>(null);
  const [challengeCode, setChallengeCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  const auth = useMemo(() => {
    if (!session || !deviceId) return null;
    return authenticatedOptions(session.accessToken, deviceId, refreshAccessToken);
  }, [deviceId, refreshAccessToken, session]);

  const loadCredentials = useCallback(async () => {
    if (!auth) return;
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await listMfaMethods(auth);
      setCredentials(response.items);
    } catch (loadError: unknown) {
      setError(getMessage(loadError, "Không thể tải các phương thức MFA."));
    } finally {
      setIsLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCredentials();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadCredentials]);

  async function handleBeginEnrollment() {
    if (!auth || !password.trim()) {
      setError("Nhập mật khẩu hiện tại để thêm Authenticator.");
      return;
    }

    const hasActiveFactor = credentials.some((credential) => credential.status === "ACTIVE");
    if (hasActiveFactor) {
      await handleStartLifecycleAction({ kind: "enroll" }, "MFA_FACTOR_CHANGE");
      return;
    }

    setIsLoading(true);
    setError(undefined);
    try {
      const response = await beginTotpEnrollment({ password }, auth);
      setEnrollment(response);
      setConfirmationCode("");
    } catch (enrollError: unknown) {
      setError(getMessage(enrollError, "Không thể bắt đầu đăng ký Authenticator."));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirmEnrollment() {
    if (!auth || !enrollment || !/^\d{6}$/.test(confirmationCode)) {
      setError("Mã TOTP phải gồm đúng 6 chữ số.");
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await confirmTotpEnrollment({
        credentialId: enrollment.credentialId,
        code: confirmationCode,
      }, auth);
      setEnrollment(null);
      setConfirmationCode("");
      setPassword("");
      await completeMfaRevocation({
        recoveryCodes: response.recoveryCodes,
      });
    } catch (confirmError: unknown) {
      setError(getMessage(confirmError, "Mã TOTP không hợp lệ hoặc đã hết hạn."));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStartLifecycleAction(action: PendingAction, purpose: MfaLifecyclePurpose) {
    if (!auth || !password.trim()) {
      setError("Nhập mật khẩu hiện tại trước khi thực hiện thay đổi MFA.");
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await createMfaChallenge({ purpose }, auth);
      setPendingAction(action);
      setChallenge(response);
      setChallengeCode("");
    } catch (challengeError: unknown) {
      setError(getMessage(challengeError, "Không thể tạo yêu cầu xác thực."));
    } finally {
      setIsLoading(false);
    }
  }

  function handleCancelLifecycleAction() {
    setPendingAction(null);
    setChallenge(null);
    setChallengeCode("");
    setError(undefined);
  }

  async function handleLifecycleAction() {
    if (!auth || !pendingAction || !challenge || !/^\d{6}$/.test(challengeCode)) {
      setError("Mã TOTP phải gồm đúng 6 chữ số.");
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      if (pendingAction.kind === "enroll") {
        const response = await beginTotpEnrollment({
          password,
          challengeId: challenge.challengeId,
          code: challengeCode,
        }, auth);
        setPendingAction(null);
        setChallenge(null);
        setChallengeCode("");
        setEnrollment(response);
        setConfirmationCode("");
      } else if (pendingAction.kind === "remove") {
        await revokeMfaMethod(pendingAction.credential.id, {
          password,
          challengeId: challenge.challengeId,
          code: challengeCode,
        }, auth);
        setPendingAction(null);
        setChallenge(null);
        setChallengeCode("");
        setPassword("");
        await completeMfaRevocation({
          notice: "Phương thức Authenticator đã được thu hồi. Vui lòng đăng nhập lại.",
        });
      } else {
        const response = await rotateRecoveryCodes({
          password,
          challengeId: challenge.challengeId,
          code: challengeCode,
        }, auth);
        setPendingAction(null);
        setChallenge(null);
        setChallengeCode("");
        setPassword("");
        await completeMfaRevocation({
          recoveryCodes: response.recoveryCodes,
        });
      }
    } catch (actionError: unknown) {
      setError(getMessage(actionError, "Không thể hoàn tất thay đổi MFA."));
      if (isTerminalChallengeError(actionError)) {
        setPendingAction(null);
        setChallenge(null);
        setChallengeCode("");
      }
    } finally {
      setIsLoading(false);
    }
  }

  const activeCredential = credentials.find((credential) => credential.status === "ACTIVE");

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
        <AppHeader
          eyebrow="Bảo mật tài khoản"
          onBack={() => router.back()}
          subtitle="Dùng ứng dụng Authenticator để bảo vệ giao dịch và thay đổi quan trọng."
          title="Ứng dụng xác thực"
        />
        <EnvironmentBadge />

        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        {isLoading ? <Text style={styles.muted}>Đang cập nhật bảo mật…</Text> : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Phương thức hiện có</Text>
          {credentials.length === 0 ? (
            <Text style={styles.muted}>Chưa có Authenticator đang hoạt động.</Text>
          ) : credentials.map((credential) => (
            <View key={credential.id} style={styles.factorRow}>
              <View style={styles.factorText}>
                <Text style={styles.factorName}>{credential.displayName}</Text>
                <Text style={styles.muted}>
                  {credential.credentialType} · {credential.status === "ACTIVE" ? "Đang hoạt động" : "Đã thu hồi"}
                </Text>
              </View>
              {credential.status === "ACTIVE" ? (
                <PrimaryButton
                  disabled={isLoading}
                  label="Thu hồi"
                  onPress={() => void handleStartLifecycleAction({ kind: "remove", credential }, "MFA_FACTOR_REMOVAL")}
                  testID={`mfa-remove-${credential.id}`}
                />
              ) : null}
            </View>
          ))}
        </View>

        {!enrollment ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Thêm Authenticator</Text>
            <TextField
              autoCapitalize="none"
              label="Mật khẩu hiện tại"
              onChangeText={setPassword}
              placeholder="Nhập mật khẩu"
              secureTextEntry
              testID="mfa-current-password"
              value={password}
            />
            <PrimaryButton
              disabled={isLoading}
              label="Tạo khóa TOTP"
              onPress={() => void handleBeginEnrollment()}
              testID="mfa-enroll-start"
            />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Hoàn tất đăng ký Authenticator</Text>
            <Text style={styles.description}>
              Quét QR hoặc nhập khóa thủ công vào ứng dụng Authenticator. Không chia sẻ khóa này.
            </Text>
            <View style={styles.qrFrame}>
              <QRCode value={enrollment.otpauthUri} size={210} />
            </View>
            <Text selectable style={styles.secret}>{enrollment.manualSetupKey}</Text>
            <Text selectable style={styles.uri}>{enrollment.otpauthUri}</Text>
            <TextField
              autoCapitalize="none"
              keyboardType="number-pad"
              label="Mã TOTP đầu tiên"
              onChangeText={(value) => setConfirmationCode(value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              secureTextEntry
              testID="mfa-enroll-code"
              value={confirmationCode}
            />
            <PrimaryButton
              disabled={isLoading}
              label="Kích hoạt Authenticator"
              onPress={() => void handleConfirmEnrollment()}
              testID="mfa-enroll-confirm"
            />
          </View>
        )}

        {activeCredential ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Mã khôi phục</Text>
            <Text style={styles.description}>
              Mã khôi phục chỉ hiển thị một lần. Hãy lưu ngoại tuyến và không gửi cho người khác.
            </Text>
            <PrimaryButton
              disabled={isLoading}
              label="Tạo lại mã khôi phục"
              onPress={() => void handleStartLifecycleAction({ kind: "rotate" }, "RECOVERY_CODE_ROTATION")}
              testID="mfa-recovery-rotate"
            />
          </View>
        ) : null}

        {challenge && pendingAction ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Xác nhận thay đổi bảo mật</Text>
            <TextField
              keyboardType="number-pad"
              label="Mã TOTP hiện tại"
              onChangeText={(value) => setChallengeCode(value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              secureTextEntry
              testID="mfa-lifecycle-code"
              value={challengeCode}
            />
            <PrimaryButton
              disabled={isLoading}
              label={
                pendingAction.kind === "enroll"
                  ? "Xác nhận tạo khóa mới"
                  : pendingAction.kind === "remove"
                    ? "Thu hồi Authenticator"
                    : "Tạo lại mã khôi phục"
              }
              onPress={() => void handleLifecycleAction()}
              testID="mfa-lifecycle-confirm"
            />
            <PrimaryButton
              disabled={isLoading}
              label="Hủy"
              onPress={handleCancelLifecycleAction}
              testID="mfa-lifecycle-cancel"
            />
          </View>
        ) : null}

        <PrimaryButton
          disabled={isLoading}
          label="Làm mới"
          onPress={() => void loadCredentials()}
          testID="mfa-refresh"
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { width: "100%" },
  content: { width: "100%", maxWidth: sizes.contentMaxWidth, padding: spacing.lg, gap: spacing.lg, alignSelf: "center" },
  description: { ...typography.body, color: colors.muted },
  sectionTitle: { ...typography.subheading, color: colors.text },
  card: { gap: spacing.md, padding: spacing.mlg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadows.card },
  factorRow: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  factorText: { gap: spacing.xs },
  factorName: { ...typography.bodyStrong, color: colors.text },
  muted: { ...typography.body, color: colors.muted },
  error: { ...typography.body, padding: spacing.md, borderRadius: radius.md, color: colors.danger, backgroundColor: colors.dangerSoft },
  secret: { color: colors.text, fontSize: 16, fontWeight: "700", letterSpacing: 1.5 },
  uri: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  qrFrame: { alignSelf: "center", padding: spacing.md, borderWidth: 2, borderColor: colors.primarySoft, borderRadius: radius.lg, backgroundColor: colors.surface },
});
