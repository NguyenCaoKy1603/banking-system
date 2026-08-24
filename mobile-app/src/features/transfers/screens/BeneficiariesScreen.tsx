import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  createBeneficiary,
  deleteBeneficiary,
  listBeneficiaries,
  renameBeneficiary,
} from "@/features/transfers/services/transfersApi";
import type { Beneficiary } from "@/features/transfers/types/transfer";
import { ApiError } from "@/services/api/ApiError";
import { colors, spacing } from "@/theme";

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Không thể xử lý danh bạ người nhận. Vui lòng thử lại.";
}

export function BeneficiariesScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const loadBeneficiaries = useCallback(async () => {
    if (!accessToken) {
      setBeneficiaries([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(undefined);

    try {
      const response = await listBeneficiaries(auth);
      setBeneficiaries(response.items);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, auth]);

  useEffect(() => {
    void Promise.resolve().then(() => loadBeneficiaries());
  }, [loadBeneficiaries]);

  const handleCreate = useCallback(async () => {
    setError(undefined);
    setNotice(undefined);
    setIsSaving(true);

    try {
      const response = await createBeneficiary(
        { displayName, accountNumber },
        auth,
      );
      setBeneficiaries((current) => [...current, response.beneficiary]);
      setDisplayName("");
      setAccountNumber("");
      setNotice("Đã thêm người nhận vào danh bạ.");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }, [accountNumber, auth, displayName]);

  const startRename = useCallback((beneficiary: Beneficiary) => {
    setEditingId(beneficiary.id);
    setEditingName(beneficiary.displayName);
    setPendingDeleteId(null);
    setError(undefined);
    setNotice(undefined);
  }, []);

  const handleRename = useCallback(async () => {
    if (!editingId) {
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setIsSaving(true);

    try {
      const response = await renameBeneficiary(
        editingId,
        { displayName: editingName },
        auth,
      );
      setBeneficiaries((current) =>
        current.map((item) =>
          item.id === response.beneficiary.id ? response.beneficiary : item,
        ),
      );
      setEditingId(null);
      setEditingName("");
      setNotice("Đã cập nhật tên người nhận.");
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }, [auth, editingId, editingName]);

  const handleDelete = useCallback(
    async (beneficiaryId: string) => {
      setError(undefined);
      setNotice(undefined);
      setIsSaving(true);

      try {
        await deleteBeneficiary(beneficiaryId, auth);
        setBeneficiaries((current) =>
          current.filter((item) => item.id !== beneficiaryId),
        );
        setPendingDeleteId(null);
        if (editingId === beneficiaryId) {
          setEditingId(null);
          setEditingName("");
        }
        setNotice("Đã xoá người nhận khỏi danh bạ.");
      } catch (requestError: unknown) {
        setError(getErrorMessage(requestError));
      } finally {
        setIsSaving(false);
      }
    },
    [auth, editingId],
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
          testID="beneficiaries-back"
        >
          <Text style={styles.backLabel}>‹ Quay lại</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>M4 · BENEFICIARIES</Text>
          <Text style={styles.title}>Danh bạ người nhận</Text>
          <Text style={styles.description}>
            Thông tin tài khoản được gửi lên Backend để kiểm tra; Mobile chỉ hiển thị số tài khoản đã che.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Thêm người nhận</Text>
          <TextField
            label="Tên gợi nhớ"
            onChangeText={setDisplayName}
            placeholder="Ví dụ: Gia đình"
            testID="beneficiary-display-name"
            value={displayName}
          />
          <TextField
            keyboardType="number-pad"
            label="Số tài khoản"
            onChangeText={(value) => setAccountNumber(value.replace(/\D/g, ""))}
            placeholder="Nhập 6–34 chữ số"
            testID="beneficiary-account-number"
            value={accountNumber}
          />
          <PrimaryButton
            disabled={isSaving}
            label={isSaving ? "Đang lưu…" : "Thêm người nhận"}
            onPress={() => void handleCreate()}
            testID="beneficiary-add"
          />
        </View>

        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.errorText} testID="beneficiary-error">
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.noticeText}>
            {notice}
          </Text>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Người nhận đã lưu</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={() => void loadBeneficiaries()}
            testID="beneficiaries-refresh"
          >
            <Text style={styles.linkLabel}>Tải lại</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : beneficiaries.length === 0 ? (
          <View style={styles.emptyCard} testID="beneficiaries-empty">
            <Text style={styles.emptyText}>Chưa có người nhận nào được lưu.</Text>
          </View>
        ) : (
          <View style={styles.listCard} testID="beneficiary-list">
            {beneficiaries.map((beneficiary) => {
              const isEditing = editingId === beneficiary.id;
              const isPendingDelete = pendingDeleteId === beneficiary.id;

              return (
                <View key={beneficiary.id} style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isEditing}
                    onPress={() =>
                      router.push({
                        pathname: "/transfer",
                        params: { beneficiaryId: beneficiary.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.rowMain,
                      pressed ? styles.pressedRow : null,
                    ]}
                    testID={`beneficiary-row-${beneficiary.id}`}
                  >
                    <Text style={styles.beneficiaryName}>{beneficiary.displayName}</Text>
                    <Text style={styles.beneficiaryDetails}>
                      {beneficiary.bankName} · {beneficiary.maskedAccountNumber}
                    </Text>
                    <Text style={styles.beneficiaryStatus}>{beneficiary.status}</Text>
                  </Pressable>

                  {isEditing ? (
                    <View style={styles.inlineEditor}>
                      <TextField
                        label="Tên mới"
                        onChangeText={setEditingName}
                        testID={`beneficiary-edit-name-${beneficiary.id}`}
                        value={editingName}
                      />
                      <View style={styles.actionRow}>
                        <PrimaryButton
                          disabled={isSaving}
                          label="Lưu tên"
                          onPress={() => void handleRename()}
                          testID={`beneficiary-save-${beneficiary.id}`}
                        />
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setEditingId(null)}
                          style={styles.secondaryButton}
                          testID={`beneficiary-cancel-${beneficiary.id}`}
                        >
                          <Text style={styles.secondaryLabel}>Huỷ</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : isPendingDelete ? (
                    <View style={styles.confirmBox}>
                      <Text style={styles.confirmText}>Xoá người nhận này?</Text>
                      <View style={styles.actionRow}>
                        <PrimaryButton
                          disabled={isSaving}
                          label="Xác nhận xoá"
                          onPress={() => void handleDelete(beneficiary.id)}
                          testID={`beneficiary-confirm-delete-${beneficiary.id}`}
                        />
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setPendingDeleteId(null)}
                          style={styles.secondaryButton}
                          testID={`beneficiary-cancel-delete-${beneficiary.id}`}
                        >
                          <Text style={styles.secondaryLabel}>Huỷ</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.actionRow}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => startRename(beneficiary)}
                        style={styles.secondaryButton}
                        testID={`beneficiary-rename-${beneficiary.id}`}
                      >
                        <Text style={styles.secondaryLabel}>Đổi tên</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setPendingDeleteId(beneficiary.id);
                          setError(undefined);
                        }}
                        style={styles.dangerButton}
                        testID={`beneficiary-delete-${beneficiary.id}`}
                      >
                        <Text style={styles.dangerLabel}>Xoá</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
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
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  linkLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  centerState: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  listCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  row: {
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMain: {
    gap: spacing.xs,
  },
  pressedRow: {
    opacity: 0.72,
  },
  beneficiaryName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  beneficiaryDetails: {
    color: colors.muted,
    fontSize: 14,
  },
  beneficiaryStatus: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "700",
  },
  inlineEditor: {
    gap: spacing.sm,
  },
  confirmBox: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: spacing.sm,
    backgroundColor: colors.background,
  },
  confirmText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  secondaryLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  dangerButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  dangerLabel: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  noticeText: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyCard: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
  },
  emptyText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
});
