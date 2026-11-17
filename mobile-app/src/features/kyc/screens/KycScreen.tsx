import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/Button";
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

function getRejectionReasonText(status: KycStatus, reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed.replace(/\.+$/, "");
  }
  return status === "NEEDS_MORE_INFO"
    ? "Cần cập nhật và hoàn thiện hồ sơ định danh"
    : "Thông tin định danh chưa đáp ứng tiêu chuẩn đối chiếu";
}

function resolveErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === "NETWORK_ERROR") {
      return "Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền.";
    }
    if (err.code === "TIMEOUT") {
      return "Yêu cầu đến máy chủ đã hết thời gian chờ. Vui lòng thử lại sau.";
    }
    if (err.status === 401 || err.code === "UNAUTHORIZED") {
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    }
    if (err.message && err.message.trim().length > 0) {
      return err.message;
    }
  }
  return fallback;
}

const ALLOWLISTED_FIELDS: (keyof KycDraft)[] = [
  "fullName",
  "identityNumber",
  "address",
  "documentUri",
  "syntheticDataConfirmed",
];

function extractFieldErrors(apiError: ApiError): KycFieldErrors {
  const rawErrors = apiError.fieldErrors;
  if (!rawErrors || typeof rawErrors !== "object") return {};
  const filtered: KycFieldErrors = {};
  for (const key of ALLOWLISTED_FIELDS) {
    if (typeof rawErrors[key] === "string" && rawErrors[key].trim().length > 0) {
      filtered[key] = rawErrors[key];
    }
  }
  return filtered;
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
    documentUri: "mock://identity-card-front",
    syntheticDataConfirmed: true,
  });
  const [fieldErrors, setFieldErrors] = useState<KycFieldErrors>(emptyErrors);
  const [isLoading, setIsLoading] = useState(true);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    hasLoadedRef.current = application !== null;
  }, [application]);

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
      setInitialLoadFailed(false);
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
      const msg = resolveErrorMessage(loadError, "Không thể tải hồ sơ định danh.");
      setError(msg);
      if (!hasLoadedRef.current) {
        setInitialLoadFailed(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [auth, userId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadApplication());
  }, [loadApplication]);

  const updateDraft = useCallback(<K extends keyof KycDraft>(field: K, value: KycDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setError(undefined);
    if (field === "identityNumber") {
      setIdentityChanged(true);
    }
  }, []);

  const identityRequired = !application || identityChanged;

  const handleSaveDraft = useCallback(async () => {
    if (!userId) {
      setError("Phiên đăng nhập không còn hợp lệ.");
      return;
    }

    const errors = validateKycDraft(draft, { identityRequired });
    setFieldErrors(errors);
    if (hasKycFieldErrors(errors)) {
      setError("Vui lòng kiểm tra các trường hồ sơ trước khi lưu.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const saved = await saveKycDraft(draft, auth, {
        includeIdentityNumber: identityRequired,
      });
      setApplication(saved);
      setDraft((current) => ({ ...current, identityNumber: "" }));
      setIdentityChanged(false);
      setFieldErrors(emptyErrors);
    } catch (saveError) {
      if (saveError instanceof ApiError) {
        if (saveError.status === 422) {
          const mapped = extractFieldErrors(saveError);
          setFieldErrors(mapped);
          setError(saveError.message || "Vui lòng kiểm tra các trường thông tin không hợp lệ.");
          return;
        }
        if (saveError.status === 409 || saveError.code === "CONFLICT") {
          try {
            const canonical = await getKycApplication(auth);
            setApplication(canonical);
            if (canonical) {
              setDraft({
                fullName: canonical.fullName,
                identityNumber: "",
                address: canonical.address,
                documentUri: canonical.documentUri,
                syntheticDataConfirmed: true,
              });
              setIdentityChanged(false);
              setFieldErrors(emptyErrors);
            }
            setError(saveError.message || "Hồ sơ đã được cập nhật từ máy chủ.");
          } catch {
            setError("Xung đột dữ liệu và không thể tải lại hồ sơ. Vui lòng kiểm tra kết nối.");
          }
          return;
        }
      }
      setError(resolveErrorMessage(saveError, "Không thể lưu bản nháp. Vui lòng thử lại."));
    } finally {
      setIsSubmitting(false);
    }
  }, [auth, draft, identityRequired, userId]);

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
      setFieldErrors(emptyErrors);
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        if (submitError.status === 422) {
          const mapped = extractFieldErrors(submitError);
          setFieldErrors(mapped);
          setError(submitError.message || "Vui lòng kiểm tra các trường thông tin không hợp lệ.");
          return;
        }
        if (submitError.status === 409 || submitError.code === "CONFLICT") {
          try {
            const canonical = await getKycApplication(auth);
            setApplication(canonical);
            if (canonical) {
              setDraft({
                fullName: canonical.fullName,
                identityNumber: "",
                address: canonical.address,
                documentUri: canonical.documentUri,
                syntheticDataConfirmed: true,
              });
              setIdentityChanged(false);
              setFieldErrors(emptyErrors);
            }
            setError(submitError.message || "Hồ sơ đã được cập nhật từ máy chủ.");
          } catch {
            setError("Xung đột dữ liệu và không thể tải lại hồ sơ. Vui lòng kiểm tra kết nối.");
          }
          return;
        }
      }
      setError(resolveErrorMessage(submitError, "Không thể gửi hồ sơ định danh. Vui lòng thử lại."));
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

        {isLoading && !initialLoadFailed && !application ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : initialLoadFailed && !application ? (
          <View style={styles.card} testID="kyc-load-error-card">
            <Text style={styles.statusTitleDanger}>Không thể tải hồ sơ</Text>
            <Text style={styles.errorText} testID="kyc-load-error-message">
              {error || "Đã xảy ra lỗi khi tải hồ sơ định danh."}
            </Text>
            <PrimaryButton
              disabled={isLoading}
              label={isLoading ? "Đang tải lại..." : "Thử lại"}
              onPress={() => void loadApplication()}
              testID="kyc-retry-load"
            />
          </View>
        ) : application && !isEditable ? (
          <View style={styles.card}>
            <Text style={styles.statusTitle}>{getStatusLabel(application.status)}</Text>
            <Text style={styles.description}>
              {application.status === "APPROVED"
                ? "Hồ sơ định danh đã được phê duyệt."
                : application.status === "SUBMITTED" || application.status === "UNDER_REVIEW"
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
            {application.status !== "APPROVED" ? (
              <PrimaryButton
                disabled={isLoading}
                label={isLoading ? "Đang tải..." : "Tải lại trạng thái"}
                onPress={() => void loadApplication()}
                testID="kyc-refresh-status"
              />
            ) : null}
            {application.status === "SUBMITTED" || application.status === "UNDER_REVIEW" ? (
              <Text style={styles.noteText} testID="kyc-pending-entitlement-note">
                Hồ sơ sẽ giữ trạng thái chờ cho đến khi nhân viên có thẩm quyền hoàn tất xét duyệt.
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            {application?.status === "REJECTED" ? (
              <View style={styles.dangerBox} testID="kyc-rejected-banner">
                <Text style={styles.dangerTitle}>Hồ sơ không được phê duyệt</Text>
                <Text style={styles.errorText}>
                  {`Hồ sơ trước đó đã bị từ chối: ${getRejectionReasonText(application.status, application.rejectionReason)}. Lần lưu hoặc nộp tiếp theo sẽ tạo một hồ sơ định danh mới.`}
                </Text>
              </View>
            ) : application?.status === "NEEDS_MORE_INFO" ? (
              <View style={styles.warningBox} testID="kyc-needs-more-info-banner">
                <Text style={styles.warningTitle}>Yêu cầu bổ sung thông tin</Text>
                <Text style={styles.warningText}>
                  {`Ngân hàng yêu cầu bổ sung thông tin: ${getRejectionReasonText(application.status, application.rejectionReason)}. Vui lòng cập nhật và nộp lại trên hồ sơ hiện tại.`}
                </Text>
              </View>
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
            <View style={styles.hiddenSandboxFields}>
              <View style={styles.documentBox}>
                <Text style={styles.summaryLabel}>Ảnh giấy tờ</Text>
                <Text style={styles.documentText}>
                  {draft.documentUri ? "Đã chọn ảnh giấy tờ" : "Chưa chọn ảnh giấy tờ"}
                </Text>
                {fieldErrors.documentUri ? <Text style={styles.errorText}>{fieldErrors.documentUri}</Text> : null}
                <PrimaryButton
                  label="Chọn ảnh giấy tờ"
                  onPress={() => updateDraft("documentUri", "mock://identity-card-front")}
                  testID="kyc-select-sample-document"
                />
              </View>
              <View style={styles.confirmationBox}>
                <View style={styles.confirmationCopy}>
                  <Text style={styles.summaryLabel}>Xác nhận thông tin</Text>
                  <Text style={styles.noteText}>
                    Vui lòng không nhập thông tin cá nhân thật.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Xác nhận không nhập thông tin cá nhân thật"
                  onValueChange={(value) => updateDraft("syntheticDataConfirmed", value)}
                  testID="kyc-synthetic-confirmation"
                  value={draft.syntheticDataConfirmed}
                />
              </View>
              {fieldErrors.syntheticDataConfirmed ? <Text style={styles.errorText}>{fieldErrors.syntheticDataConfirmed}</Text> : null}
            </View>
            <Text style={styles.noteText} testID="kyc-sandbox-note">
              Môi trường thử nghiệm: hồ sơ tự động đính kèm tài liệu mẫu (mock://identity-card-front) để bảo vệ dữ liệu cá nhân; vui lòng không nhập thông tin CCCD thật.
            </Text>

            {error ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{error}</Text> : null}

            <PrimaryButton
              disabled={isSubmitting}
              label={
                isSubmitting
                  ? "Đang gửi hồ sơ..."
                  : application?.status === "NEEDS_MORE_INFO"
                  ? "Gửi cập nhật hồ sơ"
                  : "Gửi hồ sơ định danh"
              }
              onPress={() => void handleSubmit()}
              testID="kyc-submit"
            />
            <Button
              disabled={isSubmitting}
              label={isSubmitting ? "Đang lưu..." : "Lưu bản nháp"}
              onPress={() => void handleSaveDraft()}
              testID="kyc-save-draft"
              variant="outline"
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
  statusTitleDanger: {
    ...typography.heading,
    color: colors.danger,
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
  warningBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  warningTitle: {
    ...typography.bodyStrong,
    color: colors.warning,
  },
  warningText: {
    ...typography.body,
    color: colors.text,
  },
  dangerBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  dangerTitle: {
    ...typography.bodyStrong,
    color: colors.danger,
  },
  hiddenSandboxFields: {
    display: "none",
  },
});
