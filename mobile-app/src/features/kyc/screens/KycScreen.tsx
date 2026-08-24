import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
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
import {
  getMockKycApplication,
  submitMockKycApplication,
} from "@/features/kyc/services/kycMock";
import type { KycApplication, KycDraft, KycStatus } from "@/features/kyc/types/kyc";
import {
  hasKycFieldErrors,
  validateKycDraft,
  type KycFieldErrors,
} from "@/features/kyc/validation/kycValidators";
import { useAuth } from "@/features/auth/context/AuthContext";
import { colors, spacing } from "@/theme";

function getStatusLabel(status: KycStatus): string {
  switch (status) {
    case "DRAFT":
      return "Bản nháp";
    case "PENDING":
      return "Đang chờ duyệt";
    case "APPROVED":
      return "Đã duyệt";
    case "REJECTED":
      return "Cần bổ sung";
  }
}

function maskIdentityNumber(identityNumber: string): string {
  if (identityNumber.length < 4) {
    return "••••";
  }

  return `${"•".repeat(Math.max(identityNumber.length - 4, 0))}${identityNumber.slice(-4)}`;
}

const emptyErrors: KycFieldErrors = {};

export function KycScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [application, setApplication] = useState<KycApplication | null>(null);
  const [draft, setDraft] = useState<KycDraft>({
    fullName: session?.user.fullName ?? "",
    identityNumber: "",
    address: "",
    documentUri: "",
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
      const current = await getMockKycApplication(userId);
      setApplication(current);
      if (current) {
        setDraft({
          fullName: current.fullName,
          identityNumber: current.identityNumber,
          address: current.address,
          documentUri: current.documentUri,
        });
      }
    } catch {
      setError("Không thể tải hồ sơ eKYC mô phỏng.");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadApplication());
  }, [loadApplication]);

  const updateDraft = useCallback(<K extends keyof KycDraft>(field: K, value: KycDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError(undefined);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!userId) {
      setError("Phiên đăng nhập không còn hợp lệ.");
      return;
    }

    const errors = validateKycDraft(draft);
    setFieldErrors(errors);
    if (hasKycFieldErrors(errors)) {
      setError("Vui lòng kiểm tra các trường hồ sơ trước khi gửi.");
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const submitted = await submitMockKycApplication(userId, draft);
      setApplication(submitted);
    } catch {
      setError("Không thể gửi hồ sơ eKYC mô phỏng. Vui lòng thử lại.");
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, userId]);

  const isEditable = !application || application.status === "DRAFT" || application.status === "REJECTED";

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
          testID="kyc-back"
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>M2 · eKYC</Text>
          <Text style={styles.title}>Hồ sơ định danh</Text>
          <Text style={styles.description}>
            Ứng dụng khách hàng chỉ gửi hồ sơ và đọc trạng thái. Quyết định duyệt phải đến từ dịch vụ có thẩm quyền phía server.
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : application && !isEditable ? (
          <View style={styles.card}>
            <Text style={styles.statusTitle}>{getStatusLabel(application.status)}</Text>
            <Text style={styles.description}>
              {application.status === "PENDING"
                ? "Hồ sơ đã được gửi và đang chờ dịch vụ kiểm duyệt xử lý."
                : "Đây là trạng thái chỉ đọc từ nguồn kiểm duyệt; ứng dụng khách hàng không thể thay đổi quyết định."}
            </Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Họ tên</Text>
              <Text style={styles.summaryValue}>{application.fullName}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Số định danh</Text>
              <Text style={styles.summaryValue}>{maskIdentityNumber(application.identityNumber)}</Text>
            </View>
            {application.rejectionReason ? (
              <Text style={styles.errorText}>{application.rejectionReason}</Text>
            ) : null}
            <PrimaryButton label="Tải lại trạng thái" onPress={loadApplication} testID="kyc-refresh-status" />
            {application.status === "PENDING" ? (
              <Text style={styles.noteText} testID="kyc-pending-entitlement-note">
                Bản reference chưa có entitlement/API kiểm duyệt phía server nên hồ sơ sẽ giữ trạng thái chờ; không có thao tác tự duyệt trên ứng dụng này.
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
            <TextField
              accessibilityLabel="Số định danh"
              error={fieldErrors.identityNumber}
              keyboardType="number-pad"
              label="Số định danh (mô phỏng)"
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
                {draft.documentUri ? "Đã chọn ảnh mẫu identity-card-front" : "Chưa chọn ảnh giấy tờ mẫu"}
              </Text>
              {fieldErrors.documentUri ? <Text style={styles.errorText}>{fieldErrors.documentUri}</Text> : null}
              <PrimaryButton
                label="Chọn ảnh mẫu (eKYC mô phỏng)"
                onPress={() => updateDraft("documentUri", "mock://identity-card-front")}
                testID="kyc-select-sample-document"
              />
            </View>
            {error ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{error}</Text> : null}
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
  centerState: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  statusTitle: {
    color: colors.success,
    fontSize: 21,
    fontWeight: "700",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 14,
  },
  summaryValue: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
  },
  documentBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: spacing.sm,
    backgroundColor: colors.background,
  },
  documentText: {
    color: colors.text,
    fontSize: 14,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  noteText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
});
