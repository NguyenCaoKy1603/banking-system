import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getAccountNumber, listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { createReceiveQrPayload, parseReceiveQrPayload } from "@/features/qr/validation/qrPayload";
import type { UnverifiedReceiveQrData } from "@/features/qr/types/qr";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

type QrMode = "my" | "scan";

type QrScreenProps = {
  showBackButton?: boolean;
};

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể tải dữ liệu QR. Vui lòng thử lại.";
}

export function QrScreen({ showBackButton = true }: QrScreenProps) {
  const router = useRouter();
  const params = useLocalSearchParams<{ accountId?: string; mode?: string }>();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const requestedAccountId = typeof params.accountId === "string" ? params.accountId : undefined;
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<QrMode>(params.mode === "scan" ? "scan" : "my");
  const [account, setAccount] = useState<PaymentAccount | null>(null);
  const [accountNumber, setAccountNumber] = useState<string | null>(null);
  const [isLoadingAccount, setIsLoadingAccount] = useState(true);
  const [accountError, setAccountError] = useState<string | undefined>();
  const [manualPayload, setManualPayload] = useState("");
  const [parsedPayload, setParsedPayload] = useState<UnverifiedReceiveQrData | null>(null);
  const [scanError, setScanError] = useState<string | undefined>();
  const [hasScanned, setHasScanned] = useState(false);
  const [cameraError, setCameraError] = useState<string | undefined>();
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );

  const loadAccount = useCallback(async () => {
    if (!accessToken) {
      setAccount(null);
      setAccountNumber(null);
      setIsLoadingAccount(false);
      return;
    }

    setIsLoadingAccount(true);
    setAccountError(undefined);

    try {
      const response = await listAccounts(auth);
      const selectedAccount =
        response.accounts.find((item) => item.id === requestedAccountId) ??
          response.accounts[0] ??
          null;
      if (!selectedAccount) {
        setAccount(null);
        setAccountNumber(null);
        return;
      }
      const numberResponse = await getAccountNumber(selectedAccount.id, auth);
      setAccount(selectedAccount);
      setAccountNumber(numberResponse.accountNumber);
    } catch (error: unknown) {
      setAccount(null);
      setAccountNumber(null);
      setAccountError(getErrorMessage(error));
    } finally {
      setIsLoadingAccount(false);
    }
  }, [accessToken, auth, requestedAccountId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAccount());
  }, [loadAccount]);

  const qrPayload = useMemo(() => {
    if (!account || !accountNumber) return "";
    return createReceiveQrPayload({
      accountNumber,
      displayName: account.displayName,
      maskedAccountNumber: account.maskedNumber,
      bankName: account.bankName,
    });
  }, [account, accountNumber]);

  const handleParsePayload = useCallback((raw: string) => {
    try {
      const nextPayload = parseReceiveQrPayload(raw);
      setParsedPayload(nextPayload);
      setScanError(undefined);
      setHasScanned(true);
    } catch (error: unknown) {
      setParsedPayload(null);
      setScanError(error instanceof Error ? error.message : "Mã QR không hợp lệ.");
    }
  }, []);

  const handleBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (!hasScanned) handleParsePayload(data);
    },
    [handleParsePayload, hasScanned],
  );

  const handleEnableCamera = useCallback(async () => {
    setCameraError(undefined);
    const nextPermission = permission?.granted ? permission : await requestPermission();
    if (nextPermission.granted) {
      setIsCameraEnabled(true);
      return;
    }
    setCameraError("Không thể cấp quyền camera. Bạn vẫn có thể nhập nội dung QR thủ công.");
  }, [permission, requestPermission]);

  const resetScanner = useCallback(() => {
    setParsedPayload(null);
    setScanError(undefined);
    setManualPayload("");
    setHasScanned(false);
    setCameraError(undefined);
    setIsCameraEnabled(false);
  }, []);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          backTestID="qr-back"
          eyebrow="Thông tin nhận tiền"
          onBack={showBackButton ? () => router.back() : undefined}
          subtitle="Chia sẻ thông tin nhận tiền hoặc đọc thông tin người nhận bằng mã QR."
          title="QR thông tin nhận tiền"
        />
        <EnvironmentBadge />

        <View style={styles.modeSwitch}>
          {([
            { key: "my", label: "QR của tôi", icon: "qr" },
            { key: "scan", label: "Quét QR", icon: "scan" },
          ] as const).map((item) => {
            const selected = mode === item.key;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={item.key}
                onPress={() => setMode(item.key)}
                style={[styles.modeButton, selected ? styles.modeButtonSelected : null]}
                testID={item.key === "my" ? "qr-my-qr" : "qr-scan"}
              >
                <AppIcon color={selected ? colors.onPrimary : colors.primary} name={item.icon} size={20} />
                <Text style={[styles.modeLabel, selected ? styles.modeLabelSelected : null]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {mode === "my" ? (
          <Card elevated style={styles.receiveCard}>
            {isLoadingAccount ? (
              <StateCard loading message="Đang tạo mã QR của bạn..." />
            ) : accountError ? (
              <StateCard
                actionLabel="Thử lại"
                actionTestID="qr-retry-account"
                icon="alert"
                message={accountError}
                onAction={loadAccount}
                testID="qr-account-error"
                title="Không thể tạo mã QR"
              />
            ) : account && qrPayload ? (
              <>
                <View style={styles.receiveHeader}>
                  <View style={styles.receiveIcon}>
                    <AppIcon color={colors.primary} name="qr" size={22} />
                  </View>
                  <View style={styles.receiveHeaderCopy}>
                    <Text style={styles.sectionTitle}>QR thông tin nhận tiền</Text>
                    <Text style={styles.sectionSubtitle}>Đưa mã này cho người chuyển tiền quét</Text>
                  </View>
                </View>
                <View style={styles.qrFrame}>
                  <View style={styles.qrBox} testID="qr-code">
                    <QRCode
                      backgroundColor={colors.surface}
                      color={colors.navy}
                      size={214}
                      value={qrPayload}
                    />
                  </View>
                </View>
                <View style={styles.accountSummary}>
                  <Text style={styles.accountName}>{account.displayName}</Text>
                  <Text style={styles.accountNumber}>{account.maskedNumber}</Text>
                  <Text style={styles.accountMeta}>{account.bankName} · {account.currency}</Text>
                </View>
                <View style={styles.infoBox}>
                  <AppIcon color={colors.info} name="shield" size={18} />
                  <Text style={styles.infoText}>
                    Đây không phải QR thanh toán và không tự tạo giao dịch. Luôn đối chiếu tên và tài khoản người nhận trước khi chuyển tiền.
                  </Text>
                </View>
              </>
            ) : (
              <StateCard icon="account" message="Bạn chưa có tài khoản để tạo mã QR." title="Chưa có tài khoản" />
            )}
          </Card>
        ) : (
          <Card elevated>
            <View style={styles.receiveHeader}>
              <View style={styles.receiveIcon}>
                <AppIcon color={colors.primary} name="scan" size={22} />
              </View>
              <View style={styles.receiveHeaderCopy}>
                <Text style={styles.sectionTitle}>Quét mã người nhận</Text>
                <Text style={styles.sectionSubtitle}>Camera chỉ đọc mã QR có định dạng được hỗ trợ</Text>
              </View>
            </View>

            {isCameraEnabled && permission?.granted && !parsedPayload && !cameraError ? (
              <View style={styles.cameraFrame}>
                <CameraView
                  accessibilityLabel="Camera quét mã QR"
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={handleBarcodeScanned}
                  onMountError={(event) => setCameraError(event.message)}
                  style={styles.camera}
                  testID="qr-camera"
                />
                <View pointerEvents="none" style={styles.scanGuide} />
              </View>
            ) : !parsedPayload && !cameraError ? (
              <View style={styles.permissionBox}>
                <View style={styles.permissionIcon}>
                  <AppIcon color={colors.primary} name="scan" size={28} />
                </View>
                <Text style={styles.permissionTitle}>Bật camera để quét QR</Text>
                <Text style={styles.permissionText}>
                  Ứng dụng chỉ truy cập camera khi bạn đang dùng màn hình này.
                </Text>
                <Button
                  icon="scan"
                  label={permission?.granted ? "Mở camera" : "Cấp quyền camera"}
                  onPress={() => void handleEnableCamera()}
                  testID="qr-request-camera"
                />
              </View>
            ) : null}

            {cameraError ? (
              <View style={styles.errorBox}>
                <AppIcon color={colors.danger} name="alert" size={18} />
                <Text style={styles.errorText}>Camera không sẵn sàng: {cameraError}</Text>
              </View>
            ) : null}

            <View style={styles.manualSection}>
              <Text style={styles.manualTitle}>Hoặc nhập nội dung QR thủ công</Text>
              <TextField
                accessibilityLabel="Payload mã QR"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                error={scanError}
                keyboardType="url"
                label="Nội dung mã QR"
                multiline
                onChangeText={(value) => {
                  setManualPayload(value);
                  setScanError(undefined);
                }}
                placeholder="Dán nội dung mã QR vào đây"
                spellCheck={false}
                testID="qr-manual-payload"
                value={manualPayload}
              />
              <Button
                disabled={!manualPayload.trim()}
                label="Đọc thông tin QR"
                onPress={() => handleParsePayload(manualPayload)}
                testID="qr-parse-manual"
                variant="secondary"
              />
            </View>

            {parsedPayload ? (
              <View style={styles.resultBox} testID="qr-valid-payload">
                <StatusBadge label="Đã đọc mã QR" tone="success" />
                <Text style={styles.resultTitle}>{parsedPayload.displayName}</Text>
                <Text style={styles.summaryText}>{parsedPayload.maskedAccountNumber}</Text>
                <Text style={styles.summaryMeta}>
                  {parsedPayload.bankName} · {parsedPayload.currency}
                </Text>
                <View style={styles.blockedAction} testID="qr-transfer-blocked">
                  <AppIcon color={colors.warning} name="alert" size={20} />
                  <View style={styles.blockedCopy}>
                    <Text style={styles.blockedTitle}>Cần xác minh trước khi chuyển</Text>
                    <Text style={styles.noteText}>
                      Mã này mới được kiểm tra định dạng. Hãy chọn người nhận đã xác minh trong màn hình Chuyển tiền.
                    </Text>
                  </View>
                </View>
                <Button label="Quét mã khác" onPress={resetScanner} testID="qr-reset" variant="outline" />
              </View>
            ) : null}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: sizes.contentMaxWidth,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  modeSwitch: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  modeButton: {
    minHeight: 48,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
  },
  modeButtonSelected: { backgroundColor: colors.primary, ...shadows.card },
  modeLabel: { ...typography.label, color: colors.primary },
  modeLabelSelected: { color: colors.onPrimary },
  receiveCard: { alignItems: "stretch" },
  receiveHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  receiveIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  receiveHeaderCopy: { flex: 1, gap: 2 },
  sectionTitle: { ...typography.subheading, color: colors.text },
  sectionSubtitle: { ...typography.caption, color: colors.muted },
  qrFrame: {
    alignSelf: "center",
    padding: spacing.sm,
    borderWidth: 2,
    borderColor: colors.primarySoft,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  qrBox: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  accountSummary: { alignItems: "center", gap: spacing.xs },
  accountName: { ...typography.heading, color: colors.text, textAlign: "center" },
  accountNumber: { ...typography.bodyStrong, color: colors.primary, letterSpacing: 1, textAlign: "center" },
  accountMeta: { ...typography.caption, color: colors.muted, textAlign: "center" },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.infoSoft,
  },
  infoText: { flex: 1, ...typography.caption, color: colors.info },
  cameraFrame: {
    position: "relative",
    overflow: "hidden",
    minHeight: 300,
    borderRadius: radius.lg,
    backgroundColor: colors.navy,
  },
  camera: { width: "100%", minHeight: 300 },
  scanGuide: {
    position: "absolute",
    top: 46,
    right: 46,
    bottom: 46,
    left: 46,
    borderWidth: 2,
    borderColor: colors.onPrimary,
    borderRadius: radius.lg,
  },
  permissionBox: {
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  permissionIcon: {
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  permissionTitle: { ...typography.subheading, color: colors.text, textAlign: "center" },
  permissionText: { ...typography.body, color: colors.muted, textAlign: "center" },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { flex: 1, ...typography.body, color: colors.danger },
  manualSection: {
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  manualTitle: { ...typography.label, color: colors.text },
  resultBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  resultTitle: { ...typography.heading, color: colors.text },
  summaryText: { ...typography.bodyStrong, color: colors.primary },
  summaryMeta: { ...typography.body, color: colors.muted },
  blockedAction: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  blockedCopy: { flex: 1, gap: spacing.xs },
  blockedTitle: { ...typography.label, color: colors.warning },
  noteText: { ...typography.caption, color: colors.warning },
});
