import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { EnvironmentBadge } from "@/components/ui/EnvironmentBadge";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { getKycApplication, saveKycDraft, submitKycApplication } from "@/features/kyc/services/kycApi";
import type { KycApplication, KycDraft, KycStatus } from "@/features/kyc/types/kyc";
import {
  hasKycFieldErrors,
  validateKycDraft,
  type KycFieldErrors,
} from "@/features/kyc/validation/kycValidators";
import { useAuth } from "@/features/auth/context/AuthContext";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

function getStatusLabel(status: KycStatus): string {
  switch (status) {
    case "DRAFT":
      return "Bản nháp";
    case "SUBMITTED":
      return "Đang chờ duyệt";
    case "UNDER_REVIEW":
      return "Đang được xem xét";
    case "NEEDS_MORE_INFO":
      return "Cần bổ sung thông tin";
    case "APPROVED":
      return "Đã duyệt";
    case "REJECTED":
      return "Không được phê duyệt";
  }
}

function maskIdentityNumberLast4(identityNumberLast4: string): string {
  return `••••${identityNumberLast4}`;
}

const emptyErrors: KycFieldErrors = {};

export function KycScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const userId = session?.user.id ?? null;
  const auth = useMemo(
    () => ({
      accessToken: session?.accessToken ?? null,
      deviceId,
      refreshAccessToken,
    }),
    [deviceId, refreshAccessToken, session?.accessToken],
  );
  const [application, setApplication] = useState<KycApplication | null>(null);
  const [identityChanged, setIdentityChanged] = useState(false);
  const [draft, setDraft] = useState<KycDraft>({
    fullName: session?.user.fullName ?? "",
    identityNumber: "",
    address: "",
    documentUri: "",
    syntheticDataConfirmed: false,
  });
  const [fieldErrors, setFieldErrors] = useState<KycFieldErrors>(emptyErrors);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadApplication = useCallback(async () => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(undefined);

    try {
      const current = await getKycApplication(auth);
      setApplication(current);
      if (current) {
        setDraft({
          fullName: current.fullName,
          identityNumber: "",
          address: current.address,
          documentUri: current.documentUri,
          syntheticDataConfirmed: true,
        });
        setIdentityChanged(false);
      }
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : "Không thể tải hồ sơ định danh.");
    } finally {
      setIsLoading(false);
    }
  }, [auth, userId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadApplication());
  }, [loadApplication]);

  const updateDraft = useCallback(<K extends keyof KycDraft>(field: K, value: KycDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError(undefined);
    if (field === "identityNumber") {
      setIdentityChanged(true);
    }
  }, []);

  const identityRequired = !application || identityChanged;

  const handleSubmit = useCallback(async () => {
    if (!userId) {
      setError("Phiên đăng nhập không còn hợp lệ.");
      return;
    }

    const errors = validateKycDraft(draft, { identityRequired });
    setFieldErrors(errors);
    if (hasKycFieldErrors(errors)) {
      setError("Vui lòng kiểm tra các trường hồ sơ trước khi gửi.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const submitted = await submitKycApplication(draft, auth, {
        includeIdentityNumber: identityRequired,
      });
      setApplication(submitted);
      setDraft((current) => ({ ...current, identityNumber: "" }));
      setIdentityChanged(false);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Không thể gửi hồ sơ định danh. Vui lòng thử lại.");
    } finally {
      setIsSubmitting(false);
    }
  }, [auth, draft, identityRequired, userId]);

  const isEditable = !application || application.status === "DRAFT" || application.status === "REJECTED" || application.status === "NEEDS_MORE_INFO";

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <AppHeader
          backTestID="kyc-back"
          eyebrow="Xác minh danh tính"
          onBack={() => router.back()}
          subtitle="Cung cấp thông tin định danh và theo dõi trạng thái xét duyệt hồ sơ."
          title="Hồ sơ định danh"
        />
        <EnvironmentBadge />

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : application && !isEditable ? (
          <View style={styles.card}>
            <Text style={styles.statusTitle}>{getStatusLabel(application.status)}</Text>
            <Text style={styles.description}>
              {application.status === "SUBMITTED" || application.status === "UNDER_REVIEW"
                ? "Hồ sơ đã được lưu trên máy chủ và đang chờ nhân viên có thẩm quyền xử lý."
                : "Đây là trạng thái chỉ đọc từ nguồn kiểm duyệt; ứng dụng khách hàng không thể thay đổi quyết định."}
            </Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Họ tên</Text>
              <Text style={styles.summaryValue}>{application.fullName}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Số định danh</Text>
              <Text style={styles.summaryValue}>{maskIdentityNumberLast4(application.identityNumberLast4)}</Text>
            </View>
            {application.rejectionReason ? (
              <Text style={styles.errorText}>{application.rejectionReason}</Text>
            ) : null}
            <PrimaryButton label="Tải lại trạng thái" onPress={loadApplication} testID="kyc-refresh-status" />
            {application.status === "SUBMITTED" || application.status === "UNDER_REVIEW" ? (
              <Text style={styles.noteText} testID="kyc-pending-entitlement-note">
                Hồ sơ sẽ giữ trạng thái chờ cho đến khi nhân viên có thẩm quyền hoàn tất xét duyệt.
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            {application?.status === "REJECTED" ? (
              <Text style={styles.errorText}>
                Hồ sơ trước đó cần bổ sung. Bạn có thể chỉnh sửa và gửi lại bản mô phỏng.
              </Text>
            ) : null}
            <TextField
              accessibilityLabel="Họ tên trên giấy tờ"
              autoCapitalize="words"
              error={fieldErrors.fullName}
              label="Họ tên trên giấy tờ"
              onChangeText={(value) => updateDraft("fullName", value)}
              testID="kyc-full-name"
              value={draft.fullName}
            />
            {application ? (
              <View style={styles.summaryRow} testID="kyc-identity-last4-summary">
                <Text style={styles.summaryLabel}>Số định danh hiện tại</Text>
                <Text style={styles.summaryValue}>
                  {maskIdentityNumberLast4(application.identityNumberLast4)}
                </Text>
              </View>
            ) : null}
            <TextField
              accessibilityLabel="Số định danh"
              error={fieldErrors.identityNumber}
              keyboardType="number-pad"
              label="Số CCCD hoặc định danh"
              onChangeText={(value) => updateDraft("identityNumber", value.replace(/\D/g, ""))}
              testID="kyc-identity-number"
              value={draft.identityNumber}
            />
            <TextField
              accessibilityLabel="Địa chỉ"
              error={fieldErrors.address}
              label="Địa chỉ"
              multiline
              onChangeText={(value) => updateDraft("address", value)}
              testID="kyc-address"
              value={draft.address}
            />
            <View style={styles.documentBox}>
              <Text style={styles.summaryLabel}>Ảnh giấy tờ</Text>
              <Text style={styles.documentText}>
                {draft.documentUri ? "Đã chọn ảnh giấy tờ" : "Chưa chọn ảnh giấy tờ"}
              </Text>
              {fieldErrors.documentUri ? <Text style={styles.errorText}>{fieldErrors.documentUri}</Text> : null}
              <PrimaryButton
                label="Chọn ảnh giấy tờ mẫu"
                onPress={() => updateDraft("documentUri", "mock://identity-card-front")}
                testID="kyc-select-sample-document"
              />
            </View>
            <View style={styles.confirmationBox}>
              <View style={styles.confirmationCopy}>
                <Text style={styles.summaryLabel}>Xác nhận dữ liệu mô phỏng</Text>
                <Text style={styles.noteText}>
                  Tôi xác nhận họ tên, số định danh, địa chỉ và giấy tờ ở trên chỉ là dữ liệu giả lập; không nhập thông tin cá nhân thật.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Xác nhận dữ liệu KYC mô phỏng"
                onValueChange={(value) => updateDraft("syntheticDataConfirmed", value)}
                testID="kyc-synthetic-confirmation"
                value={draft.syntheticDataConfirmed}
              />
            </View>
            {fieldErrors.syntheticDataConfirmed ? <Text style={styles.errorText}>{fieldErrors.syntheticDataConfirmed}</Text> : null}
            {error ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{error}</Text> : null}
            <PrimaryButton
              disabled={isSubmitting}
              label="Lưu bản nháp"
              onPress={() => void (async () => {
                if (!userId) { setError("Phiên đăng nhập không hợp lệ."); return; }
                const errors = validateKycDraft(draft, { identityRequired });
                setFieldErrors(errors);
                if (hasKycFieldErrors(errors)) { setError("Vui lòng kiểm tra các trường hồ sơ trước khi lưu."); return; }
                setIsSubmitting(true);
                setError(undefined);
                try {
                  setApplication(await saveKycDraft(draft, auth, {
                    includeIdentityNumber: identityRequired,
                  }));
                  setDraft((current) => ({ ...current, identityNumber: "" }));
                  setIdentityChanged(false);
                }
                catch (saveError) { setError(saveError instanceof ApiError ? saveError.message : "Không thể lưu bản nháp."); }
                finally { setIsSubmitting(false); }
              })()}
              testID="kyc-save-draft"
            />
            <PrimaryButton
              disabled={isSubmitting}
              label={isSubmitting ? "Đang gửi hồ sơ..." : "Gửi hồ sơ eKYC"}
              onPress={() => void handleSubmit()}
              testID="kyc-submit"
            />
          </View>
        )}

        {error && application && !isEditable ? (
          <Text accessibilityLiveRegion="polite" style={styles.errorText}>{error}</Text>
        ) : null}
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
  description: {
    ...typography.body,
    color: colors.muted,
  },
  centerState: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    gap: spacing.md,
    padding: spacing.mlg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  statusTitle: {
    ...typography.heading,
    color: colors.success,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  summaryLabel: {
    ...typography.body,
    color: colors.muted,
  },
  summaryValue: {
    flex: 1,
    ...typography.bodyStrong,
    color: colors.text,
    textAlign: "right",
  },
  documentBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  documentText: {
    ...typography.body,
    color: colors.text,
  },
  confirmationBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.infoSoft,
  },
  confirmationCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
  },
  noteText: {
    ...typography.caption,
    padding: spacing.md,
    borderRadius: radius.md,
    color: colors.muted,
    backgroundColor: colors.infoSoft,
  },
});
