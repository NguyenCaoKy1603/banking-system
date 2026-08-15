import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import {
  ActivityIndicator,
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
import { listAccounts } from "@/features/accounts/services/accountsApi";
import type { PaymentAccount } from "@/features/accounts/types/account";
import { createReceiveQrPayload, parseReceiveQrPayload } from "@/features/qr/validation/qrPayload";
import type { ReceiveQrPayload } from "@/features/qr/types/qr";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

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
  const [isLoadingAccount, setIsLoadingAccount] = useState(true);
  const [accountError, setAccountError] = useState<string | undefined>();
  const [manualPayload, setManualPayload] = useState("");
  const [parsedPayload, setParsedPayload] = useState<ReceiveQrPayload | null>(null);
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
      setIsLoadingAccount(false);
      return;
    }

    setIsLoadingAccount(true);
    setAccountError(undefined);

    try {
      const response = await listAccounts(auth);
      setAccount(
        response.accounts.find((item) => item.id === requestedAccountId) ??
          response.accounts[0] ??
          null,
      );
    } catch (error: unknown) {
      setAccount(null);
      setAccountError(getErrorMessage(error));
    } finally {
      setIsLoadingAccount(false);
    }
  }, [accessToken, auth, requestedAccountId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadAccount());
  }, [loadAccount]);

  const qrPayload = useMemo(() => {
    if (!account) {
      return "";
    }

    return createReceiveQrPayload({
      accountId: account.id,
      displayName: account.displayName,
      maskedAccountNumber: account.maskedNumber,
      bankName: account.bankName,
    });
  }, [account]);

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
      if (hasScanned) {
        return;
      }

      handleParsePayload(data);
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

    setCameraError("Không thể cấp quyền camera. Bạn vẫn có thể nhập payload bằng tay.");
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
        {showBackButton ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.back()}
            style={styles.backButton}
            testID="qr-back"
          >
            <Text style={styles.backLabel}>‹ Quay lại</Text>
          </Pressable>
        ) : null}

        <View style={styles.header}>
          <Text style={styles.eyebrow}>M4 · QR</Text>
          <Text style={styles.title}>QR nhận tiền</Text>
          <Text style={styles.description}>
            Payload được version hóa và kiểm tra trước khi sử dụng. Camera luôn có đường nhập tay dự phòng.
          </Text>
        </View>

        <View style={styles.modeSwitch}>
          <PrimaryButton
            label="Mã QR của tôi"
            onPress={() => setMode("my")}
            testID="qr-my-qr"
          />
          <PrimaryButton
            label="Quét QR"
            onPress={() => setMode("scan")}
            testID="qr-scan"
          />
        </View>

        {mode === "my" ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Mã nhận tiền mô phỏng</Text>
            {isLoadingAccount ? (
              <View style={styles.centerState}>
                <ActivityIndicator color={colors.primary} size="large" />
              </View>
            ) : accountError ? (
              <View style={styles.stateContent}>
                <Text style={styles.errorText}>{accountError}</Text>
                <PrimaryButton label="Thử lại" onPress={loadAccount} testID="qr-retry-account" />
              </View>
            ) : account && qrPayload ? (
              <>
                <View style={styles.qrBox} testID="qr-code">
                  <QRCode value={qrPayload} size={220} backgroundColor={colors.surface} color={colors.text} />
                </View>
                <Text style={styles.accountName}>{account.displayName}</Text>
                <Text style={styles.accountNumber}>{account.maskedNumber}</Text>
                <Text style={styles.accountNumber}>{account.bankName} · {account.currency}</Text>
                <Text style={styles.noteText}>
                  Đây là QR nhận tiền cho môi trường demo; payload không thay thế authorization của Backend.
                </Text>
              </>
            ) : (
              <Text style={styles.emptyText}>Chưa có tài khoản để tạo QR.</Text>
            )}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Quét hoặc nhập payload</Text>
            {isCameraEnabled && permission?.granted && !parsedPayload && !cameraError ? (
              <CameraView
                accessibilityLabel="Camera quét mã QR"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={handleBarcodeScanned}
                onMountError={(event) => setCameraError(event.message)}
                style={styles.camera}
                testID="qr-camera"
              />
            ) : !parsedPayload && !cameraError ? (
              <View style={styles.permissionBox}>
                <Text style={styles.description}>
                  Bạn có thể nhập payload bằng tay hoặc bật camera khi cần quét mã QR.
                </Text>
                <PrimaryButton
                  label={permission?.granted ? "Mở camera" : "Cấp quyền camera"}
                  onPress={() => void handleEnableCamera()}
                  testID="qr-request-camera"
                />
              </View>
            ) : null}
            {cameraError ? <Text style={styles.errorText}>Camera không sẵn sàng: {cameraError}</Text> : null}
            <TextField
              accessibilityLabel="Payload mã QR"
              error={scanError}
              label="Nhập payload thủ công"
              multiline
              onChangeText={(value) => {
                setManualPayload(value);
                setScanError(undefined);
              }}
              placeholder='Dán JSON payload, ví dụ {"version":1,...}'
              testID="qr-manual-payload"
              value={manualPayload}
            />
            <PrimaryButton
              label="Kiểm tra payload"
              onPress={() => handleParsePayload(manualPayload)}
              testID="qr-parse-manual"
            />
            {parsedPayload ? (
              <View style={styles.resultBox} testID="qr-valid-payload">
                <Text style={styles.resultTitle}>Payload hợp lệ</Text>
                <Text style={styles.summaryText}>{parsedPayload.displayName}</Text>
                <Text style={styles.summaryText}>{parsedPayload.maskedAccountNumber}</Text>
                <Text style={styles.summaryText}>{parsedPayload.bankName} · {parsedPayload.currency}</Text>
                {parsedPayload.beneficiaryId ? (
                  <PrimaryButton
                    label="Dùng người nhận này để chuyển tiền"
                    onPress={() =>
                      router.push({
                        pathname: "/transfer",
                        params: { beneficiaryId: parsedPayload.beneficiaryId },
                      })
                    }
                    testID="qr-use-beneficiary"
                  />
                ) : (
                  <Text style={styles.noteText}>
                    Payload tài khoản này chưa có beneficiaryId; hãy xác nhận người nhận qua API trước khi chuyển tiền.
                  </Text>
                )}
                <PrimaryButton label="Quét mã khác" onPress={resetScanner} testID="qr-reset" />
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  backLabel: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  header: {
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
    fontSize: 30,
    fontWeight: "700",
  },
  description: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  modeSwitch: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "700",
  },
  centerState: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  stateContent: {
    gap: spacing.md,
  },
  qrBox: {
    alignSelf: "center",
    padding: spacing.md,
    borderRadius: spacing.sm,
    backgroundColor: colors.surface,
  },
  camera: {
    width: "100%",
    minHeight: 260,
    borderRadius: spacing.md,
    overflow: "hidden",
  },
  permissionBox: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: spacing.sm,
    backgroundColor: colors.background,
  },
  resultBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: spacing.sm,
    backgroundColor: colors.background,
  },
  resultTitle: {
    color: colors.success,
    fontSize: 18,
    fontWeight: "700",
  },
  accountName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  accountNumber: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
  },
  summaryText: {
    color: colors.text,
    fontSize: 15,
  },
  noteText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
});
