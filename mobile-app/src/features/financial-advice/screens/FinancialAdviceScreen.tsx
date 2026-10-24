import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  getFinancialAdvice,
  mapFinancialAdviceError,
  type MappedFinancialAdviceError,
} from "@/features/financial-advice/api/financialAdviceApi";
import type {
  FinancialAdviceFormValues,
  FinancialAdviceKind,
  FinancialAdviceOption,
  FinancialAdviceResponse,
} from "@/features/financial-advice/types/financialAdvice";
import {
  formatSignedVnd,
  formatVnd,
  validateFinancialAdviceForm,
} from "@/features/financial-advice/validation/financialAdviceValidators";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, sizes, spacing, typography } from "@/theme";

const INITIAL_FORM_VALUES: FinancialAdviceFormValues = {
  kind: "SAVINGS_PLAN",
  monthlyIncomeMinor: "",
  essentialExpensesMinor: "",
  flexibleExpensesMinor: "",
  monthlyDebtPaymentsMinor: "0",
  monthlyBufferMinor: "0",
  preference: "BALANCED",
  excludeDebtFromExpensesConfirmation: false,
  targetAmountMinor: "",
  alreadySavedMinor: "0",
  months: "12",
  monthlySavingsTargetMinor: "",
};

const DURATION_PRESETS = ["6", "12", "24", "36"];

export function FinancialAdviceScreen() {
  const router = useRouter();
  const { deviceId, logout, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const currentEpoch = session?.sessionEpoch ?? null;

  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );

  const [formValues, setFormValues] = useState<FinancialAdviceFormValues>(
    INITIAL_FORM_VALUES,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<FinancialAdviceResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<MappedFinancialAdviceError | null>(
    null,
  );

  const isMountedRef = useRef(true);
  const submittingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const sessionEpochRef = useRef(currentEpoch);

  useEffect(() => {
    sessionEpochRef.current = currentEpoch;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [currentEpoch]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const handleFieldChange = (key: keyof FinancialAdviceFormValues, value: any) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    // Khi người dùng sửa dữ liệu, xóa kết quả cũ để đảm bảo tính nhất quán
    if (response) {
      setResponse(null);
    }
  };

  const handleKindChange = (kind: FinancialAdviceKind) => {
    if (formValues.kind === kind) return;
    setFormValues((prev) => ({ ...prev, kind }));
    setFieldErrors({});
    setResponse(null);
    setErrorState(null);
  };

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) {
      return;
    }

    Keyboard.dismiss();
    const validation = validateFinancialAdviceForm(formValues);
    if (!validation.isValid || !validation.request) {
      setFieldErrors(validation.fieldErrors);
      return;
    }

    setFieldErrors({});
    setErrorState(null);
    setResponse(null);

    const capturedEpoch = sessionEpochRef.current;
    const currentGeneration = ++requestGenerationRef.current;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const res = await getFinancialAdvice(validation.request, {
        auth,
        signal: controller.signal,
      });

      // Kiểm tra guard: mounted, generation mới nhất, session epoch không đổi
      if (
        !isMountedRef.current ||
        currentGeneration !== requestGenerationRef.current ||
        capturedEpoch !== sessionEpochRef.current
      ) {
        return;
      }

      setResponse(res);
    } catch (err: unknown) {
      if (
        !isMountedRef.current ||
        currentGeneration !== requestGenerationRef.current ||
        capturedEpoch !== sessionEpochRef.current
      ) {
        return;
      }

      if (err instanceof ApiError && err.code === "REQUEST_ABORTED") {
        return;
      }

      const mapped = mapFinancialAdviceError(err);
      if (mapped.fieldErrors) {
        setFieldErrors(mapped.fieldErrors);
      }
      setErrorState(mapped);
    } finally {
      if (
        isMountedRef.current &&
        currentGeneration === requestGenerationRef.current
      ) {
        setIsSubmitting(false);
        submittingRef.current = false;
      }
    }
  }, [formValues, auth]);

  const handleEditInput = () => {
    setResponse(null);
    setErrorState(null);
  };

  const handleBack = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    router.back();
  };

  const getOptionTestId = (optionId: string): string => {
    switch (optionId) {
      case "EXTEND_DEADLINE":
        return "fa-option-extend";
      case "REDUCE_FLEXIBLE_SPENDING":
        return "fa-option-cut-flexible";
      case "LOWER_GOAL_AMOUNT":
        return "fa-option-lower-target";
      case "REVIEW_BASE_BUDGET":
        return "fa-option-review";
      default:
        return `fa-option-${optionId.toLowerCase().replace(/_/g, "-")}`;
    }
  };

  return (
    <Screen style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        <AppHeader
          backTestID="fa-back"
          eyebrow="TƯ VẤN TÀI CHÍNH"
          onBack={handleBack}
          subtitle="Lập kế hoạch từ thu nhập, chi phí và mục tiêu bạn cung cấp."
          title="Tư vấn tài chính cá nhân"
        />

        {/* Tab chuyển đổi chế độ */}
        <View style={styles.tabContainer}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: formValues.kind === "SAVINGS_PLAN" }}
            disabled={isSubmitting}
            onPress={() => handleKindChange("SAVINGS_PLAN")}
            style={[
              styles.tabButton,
              formValues.kind === "SAVINGS_PLAN" ? styles.tabButtonActive : null,
            ]}
            testID="fa-kind-savings"
          >
            <AppIcon
              color={
                formValues.kind === "SAVINGS_PLAN"
                  ? colors.primary
                  : colors.muted
              }
              name="savings"
              size={18}
            />
            <Text
              style={[
                styles.tabText,
                formValues.kind === "SAVINGS_PLAN" ? styles.tabTextActive : null,
              ]}
            >
              Kế hoạch tiết kiệm
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: formValues.kind === "BUDGET_BALANCE" }}
            disabled={isSubmitting}
            onPress={() => handleKindChange("BUDGET_BALANCE")}
            style={[
              styles.tabButton,
              formValues.kind === "BUDGET_BALANCE" ? styles.tabButtonActive : null,
            ]}
            testID="fa-kind-budget"
          >
            <AppIcon
              color={
                formValues.kind === "BUDGET_BALANCE"
                  ? colors.primary
                  : colors.muted
              }
              name="card"
              size={18}
            />
            <Text
              style={[
                styles.tabText,
                formValues.kind === "BUDGET_BALANCE" ? styles.tabTextActive : null,
              ]}
            >
              Cân đối ngân sách
            </Text>
          </Pressable>
        </View>

        {/* Đang hiển thị kết quả */}
        {response ? (
          <View style={styles.resultContainer} testID="fa-result">
            {/* Chế độ phân tích & Fallback Banner */}
            <Card elevated style={styles.modeCard}>
              <View style={styles.modeHeader}>
                <AppIcon
                  color={
                    response.explanation.mode === "AI_ASSISTED"
                      ? colors.primary
                      : colors.warning
                  }
                  name="shield"
                  size={20}
                />
                <Text style={styles.modeTitle} testID="fa-result-mode">
                  {response.explanation.mode === "AI_ASSISTED"
                    ? "AI hỗ trợ chọn cách giải thích và phương án ưu tiên"
                    : "Kết quả tính toán và giải thích theo quy tắc"}
                </Text>
              </View>
              {response.explanation.fallbackReason ? (
                <Text style={styles.fallbackNotice}>
                  Phần AI hiện chưa khả dụng; bạn vẫn có thể xem kết quả tính toán.
                </Text>
              ) : null}
            </Card>

            {/* Cảnh báo (bắt buộc hiển thị trước hoặc cạnh giải thích) */}
            {response.warnings.length > 0 ? (
              <View style={styles.warningList}>
                {response.warnings.map((warn) => (
                  <Card
                    key={warn.code}
                    style={styles.warningCard}
                    testID="fa-warning"
                  >
                    <View style={styles.warningHeaderRow}>
                      <AppIcon color={colors.warning} name="alert" size={18} />
                      <Text style={styles.warningTitle}>
                        {warn.code === "BASE_BUDGET_DEFICIT" ? "Ngân sách đang thâm hụt" : "Khoản dự phòng chưa được bảo đảm"}
                      </Text>
                    </View>
                    <Text style={styles.warningMessage}>{warn.message}</Text>
                  </Card>
                ))}
              </View>
            ) : null}

            {/* Metrics tổng quan */}
            <Card elevated style={styles.metricsCard}>
              <Text style={styles.sectionHeader}>Số liệu phân tích</Text>
              {response.kind === "SAVINGS_PLAN" ? (
                <>
                  <View style={styles.heroMetricBanner}>
                    <View style={styles.heroMetricBadge}>
                      <AppIcon color={colors.primary} name="savings" size={18} />
                      <Text style={styles.heroMetricBadgeText}>Mục tiêu tiết kiệm</Text>
                    </View>
                    <Text style={styles.heroMetricLabel}>Cần dành mỗi tháng</Text>
                    <Text
                      style={styles.heroMetricValue}
                      testID="fa-required-monthly"
                    >
                      {formatVnd(
                        response.metrics.requiredMonthlySavingsMinor,
                      )}
                    </Text>
                    <Text style={styles.heroMetricSubtext}>
                      Để đạt mục tiêu theo thời hạn đã lập
                    </Text>
                  </View>

                  <View style={styles.metricGrid}>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>Khả năng hiện tại</Text>
                      <Text
                        style={[
                          styles.metricValue,
                          response.metrics.capacityAfterBufferMinor.startsWith("-")
                            ? styles.negativeValue
                            : styles.positiveValue,
                        ]}
                        testID="fa-capacity"
                      >
                        {formatSignedVnd(
                          response.metrics.capacityAfterBufferMinor,
                        )}
                      </Text>
                    </View>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>Khoảng thiếu / tháng</Text>
                      <Text
                        style={[
                          styles.metricValue,
                          response.metrics.monthlyGapMinor !== "0"
                            ? styles.negativeValue
                            : styles.neutralValue,
                        ]}
                        testID="fa-gap"
                      >
                        {formatVnd(response.metrics.monthlyGapMinor)}
                      </Text>
                    </View>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>Còn cần cho mục tiêu</Text>
                      <Text style={styles.metricValue}>
                        {formatVnd(response.metrics.remainingGoalMinor)}
                      </Text>
                    </View>
                    {response.metrics.suggestedMonths !== null ? (
                      <View style={styles.metricItem}>
                        <Text style={styles.metricLabel}>Số tháng ước tính</Text>
                        <Text style={styles.metricValue}>
                          {response.metrics.suggestedMonths} tháng
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.heroMetricBanner}>
                    <View style={styles.heroMetricBadge}>
                      <AppIcon color={colors.primary} name="card" size={18} />
                      <Text style={styles.heroMetricBadgeText}>Cân đối thu chi</Text>
                    </View>
                    <Text style={styles.heroMetricLabel}>Khả năng sau dự phòng</Text>
                    <Text
                      style={[
                        styles.heroMetricValue,
                        response.metrics.capacityAfterBufferMinor.startsWith("-")
                          ? styles.negativeValue
                          : styles.positiveValue,
                      ]}
                      testID="fa-capacity"
                    >
                      {formatSignedVnd(
                        response.metrics.capacityAfterBufferMinor,
                      )}
                    </Text>
                    <Text style={styles.heroMetricSubtext}>
                      Khả năng tích lũy thực tế sau khi trừ dự phòng
                    </Text>
                  </View>

                  <View style={styles.metricGrid}>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>Khoảng thiếu mục tiêu</Text>
                      <Text
                        style={[
                          styles.metricValue,
                          response.metrics.targetGapMinor !== "0"
                            ? styles.negativeValue
                            : styles.neutralValue,
                        ]}
                        testID="fa-gap"
                      >
                        {formatVnd(response.metrics.targetGapMinor)}
                      </Text>
                    </View>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>Còn lại sau mục tiêu</Text>
                      <Text
                        style={[
                          styles.metricValue,
                          response.metrics.remainingAfterTargetMinor.startsWith("-")
                            ? styles.negativeValue
                            : styles.positiveValue,
                        ]}
                      >
                        {formatSignedVnd(
                          response.metrics.remainingAfterTargetMinor,
                        )}
                      </Text>
                    </View>
                    <View style={styles.metricItem}>
                      <Text style={styles.metricLabel}>Chi tiêu khai báo</Text>
                      <Text style={styles.metricValue}>
                        {formatVnd(response.metrics.declaredOutgoingsMinor)}
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </Card>

            {/* Đoạn giải thích từ hệ thống / AI */}
            <Card style={styles.explanationCard}>
              <View style={styles.explanationHeader}>
                <AppIcon color={colors.primary} name="check" size={20} />
                <Text style={styles.explanationTitle}>
                  {response.kind === "SAVINGS_PLAN" ? "Kết quả kế hoạch tiết kiệm" : "Kết quả cân đối ngân sách"}
                </Text>
              </View>
              <View style={styles.paragraphsContainer}>
                {response.explanation.paragraphs.map((p, idx) => (
                  <Text key={idx} style={styles.paragraphText}>
                    {p}
                  </Text>
                ))}
              </View>
            </Card>

            {/* Các phương án gợi ý */}
            <View style={styles.optionsSection}>
              <Text style={styles.sectionHeader}>Các phương án đề xuất</Text>
              {response.options.map((opt: FinancialAdviceOption) => {
                const isPreferred =
                  opt.id === response.preferredOptionId;
                const testId = getOptionTestId(opt.id);
                return (
                  <Card
                    elevated={isPreferred}
                    key={opt.id}
                    style={[
                      styles.optionCard,
                      isPreferred ? styles.preferredOptionCard : null,
                    ]}
                    testID={testId}
                  >
                    <View style={styles.optionHeaderRow}>
                      <Text style={styles.optionTitle}>{opt.title}</Text>
                      {isPreferred ? (
                        <View style={styles.preferredBadge}>
                          <Text style={styles.preferredBadgeText}>
                            Phương án ưu tiên
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.optionSummary}>{opt.description}</Text>
                  </Card>
                );
              })}
            </View>

            {/* Các giả định bắt buộc */}
            <Card style={styles.assumptionsCard}>
              <Text style={styles.assumptionsTitle}>Giả định tính toán</Text>
              {response.assumptions.map((item, i) => (
                <Text key={i} style={styles.assumptionItem}>
                  • {item}
                </Text>
              ))}
            </Card>

            {/* Nút chỉnh sửa số liệu để tính lại */}
            <Button
              label="Chỉnh sửa số liệu"
              onPress={handleEditInput}
              testID="fa-edit-input"
              variant="outline"
            />
          </View>
        ) : (
          /* Khung nhập liệu Form */
          <View style={styles.formContainer}>
            {/* Cảnh báo hướng dẫn */}
            <Card style={styles.guideCard}>
              <View style={styles.guideHeader}>
                <AppIcon color={colors.primary} name="shield" size={18} />
                <Text style={styles.guideTitle}>Số liệu một tháng đại diện</Text>
              </View>
              <Text style={styles.guideDescription}>
                Dữ liệu do bạn tự nhập để lập kế hoạch tài chính. Ứng dụng không
                lấy số liệu từ lịch sử giao dịch hoặc thay đổi số dư tài khoản của bạn.
              </Text>
            </Card>

            {/* Nhóm chi tiêu cơ bản hàng tháng */}
            <Card style={styles.inputSectionCard}>
              <Text style={styles.sectionHeader}>Thu nhập & Chi phí hàng tháng</Text>

              <TextField
                accessibilityLabel="Thu nhập hàng tháng"
                editable={!isSubmitting}
                error={fieldErrors["monthlyIncomeMinor"]}
                helperText="Ví dụ: 15.000.000"
                keyboardType="numeric"
                label="Thu nhập hàng tháng (₫)"
                onChangeText={(text) => handleFieldChange("monthlyIncomeMinor", text)}
                placeholder="0"
                testID="fa-income"
                value={formValues.monthlyIncomeMinor}
              />

              <TextField
                accessibilityLabel="Chi tiêu thiết yếu"
                editable={!isSubmitting}
                error={fieldErrors["essentialExpensesMinor"]}
                helperText="Tiền thuê nhà, ăn uống, điện nước, y tế..."
                keyboardType="numeric"
                label="Chi tiêu thiết yếu (₫)"
                onChangeText={(text) =>
                  handleFieldChange("essentialExpensesMinor", text)
                }
                placeholder="0"
                testID="fa-essential"
                value={formValues.essentialExpensesMinor}
              />

              <TextField
                accessibilityLabel="Chi tiêu linh hoạt"
                editable={!isSubmitting}
                error={fieldErrors["flexibleExpensesMinor"]}
                helperText="Mua sắm, giải trí, du lịch..."
                keyboardType="numeric"
                label="Chi tiêu linh hoạt (₫)"
                onChangeText={(text) =>
                  handleFieldChange("flexibleExpensesMinor", text)
                }
                placeholder="0"
                testID="fa-flexible"
                value={formValues.flexibleExpensesMinor}
              />

              <TextField
                accessibilityLabel="Khoản trả nợ hàng tháng"
                editable={!isSubmitting}
                error={fieldErrors["monthlyDebtPaymentsMinor"]}
                helperText="Khoản trả nợ mỗi tháng; không nhập tổng dư nợ."
                keyboardType="numeric"
                label="Khoản trả nợ hàng tháng (₫)"
                onChangeText={(text) =>
                  handleFieldChange("monthlyDebtPaymentsMinor", text)
                }
                placeholder="0"
                testID="fa-debt-payment"
                value={formValues.monthlyDebtPaymentsMinor}
              />

              <TextField
                accessibilityLabel="Khoản giữ lại dự phòng"
                editable={!isSubmitting}
                error={fieldErrors["monthlyBufferMinor"]}
                helperText="Khoản bạn muốn giữ lại mỗi tháng ngoài mục tiêu tiết kiệm."
                keyboardType="numeric"
                label="Khoản giữ lại dự phòng (₫)"
                onChangeText={(text) =>
                  handleFieldChange("monthlyBufferMinor", text)
                }
                placeholder="0"
                testID="fa-buffer"
                value={formValues.monthlyBufferMinor}
              />
            </Card>

            {/* Nhóm mục tiêu theo tab */}
            <Card style={styles.inputSectionCard}>
              <Text style={styles.sectionHeader}>
                {formValues.kind === "SAVINGS_PLAN"
                  ? "Mục tiêu tiết kiệm"
                  : "Mức tiết kiệm mong muốn"}
              </Text>

              {formValues.kind === "SAVINGS_PLAN" ? (
                <>
                  <TextField
                    accessibilityLabel="Số tiền mục tiêu"
                    editable={!isSubmitting}
                    error={fieldErrors["targetAmountMinor"]}
                    helperText="Số tiền bạn dự định tích lũy được"
                    keyboardType="numeric"
                    label="Số tiền mục tiêu (₫)"
                    onChangeText={(text) =>
                      handleFieldChange("targetAmountMinor", text)
                    }
                    placeholder="Ví dụ: 50.000.000"
                    testID="fa-goal-target"
                    value={formValues.targetAmountMinor}
                  />

                  <TextField
                    accessibilityLabel="Số tiền đã dành riêng"
                    editable={!isSubmitting}
                    error={fieldErrors["alreadySavedMinor"]}
                    helperText="Khoản đã dành riêng cho mục tiêu này."
                    keyboardType="numeric"
                    label="Số tiền đã có sẵn (₫)"
                    onChangeText={(text) =>
                      handleFieldChange("alreadySavedMinor", text)
                    }
                    placeholder="0"
                    testID="fa-goal-saved"
                    value={formValues.alreadySavedMinor}
                  />

                  <TextField
                    accessibilityLabel="Thời hạn mục tiêu (tháng)"
                    editable={!isSubmitting}
                    error={fieldErrors["months"]}
                    helperText="Từ 1 đến 120 tháng"
                    keyboardType="numeric"
                    label="Thời hạn mục tiêu (tháng)"
                    onChangeText={(text) => handleFieldChange("months", text)}
                    placeholder="12"
                    testID="fa-goal-months"
                    value={formValues.months}
                  />

                  <View style={styles.durationPresetRow}>
                    <Text style={styles.durationPresetLabel}>Gợi ý nhanh:</Text>
                    <View style={styles.durationChips}>
                      {DURATION_PRESETS.map((m) => {
                        const isSelected = formValues.months === m;
                        return (
                          <Pressable
                            key={m}
                            accessibilityLabel={`Chọn thời hạn ${m} tháng`}
                            accessibilityRole="button"
                            disabled={isSubmitting}
                            onPress={() => handleFieldChange("months", m)}
                            style={[
                              styles.durationChip,
                              isSelected ? styles.durationChipActive : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.durationChipText,
                                isSelected ? styles.durationChipTextActive : null,
                              ]}
                            >
                              {m} tháng
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </>
              ) : (
                <TextField
                  accessibilityLabel="Mức tiết kiệm mong muốn"
                  editable={!isSubmitting}
                  error={fieldErrors["monthlySavingsTargetMinor"]}
                  helperText="Số tiền bạn muốn tích lũy thêm mỗi tháng"
                  keyboardType="numeric"
                  label="Mức tiết kiệm mong muốn / tháng (₫)"
                  onChangeText={(text) =>
                    handleFieldChange("monthlySavingsTargetMinor", text)
                  }
                  placeholder="Ví dụ: 3.000.000"
                  testID="fa-monthly-savings-target"
                  value={formValues.monthlySavingsTargetMinor}
                />
              )}
            </Card>

            {/* Lựa chọn ưu tiên */}
            <Card style={styles.inputSectionCard}>
              <Text style={styles.sectionHeader}>Ưu tiên của bạn</Text>

              <Pressable
                accessibilityRole="radio"
                accessibilityState={{
                  selected: formValues.preference === "KEEP_TARGET",
                }}
                disabled={isSubmitting}
                onPress={() => handleFieldChange("preference", "KEEP_TARGET")}
                style={[
                  styles.preferenceOption,
                  formValues.preference === "KEEP_TARGET"
                    ? styles.preferenceOptionActive
                    : null,
                ]}
                testID="fa-preference-target"
              >
                <AppIcon
                  color={
                    formValues.preference === "KEEP_TARGET"
                      ? colors.primary
                      : colors.muted
                  }
                  name="check"
                  size={18}
                />
                <View style={styles.preferenceTextCol}>
                  <Text style={styles.preferenceTitle}>Ưu tiên mục tiêu</Text>
                  <Text style={styles.preferenceDesc}>
                    Giữ nguyên mục tiêu/thời hạn khi có phương án phù hợp.
                  </Text>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="radio"
                accessibilityState={{
                  selected: formValues.preference === "KEEP_CURRENT_SPENDING",
                }}
                disabled={isSubmitting}
                onPress={() =>
                  handleFieldChange("preference", "KEEP_CURRENT_SPENDING")
                }
                style={[
                  styles.preferenceOption,
                  formValues.preference === "KEEP_CURRENT_SPENDING"
                    ? styles.preferenceOptionActive
                    : null,
                ]}
                testID="fa-preference-spending"
              >
                <AppIcon
                  color={
                    formValues.preference === "KEEP_CURRENT_SPENDING"
                      ? colors.primary
                      : colors.muted
                  }
                  name="check"
                  size={18}
                />
                <View style={styles.preferenceTextCol}>
                  <Text style={styles.preferenceTitle}>Ưu tiên giữ mức chi</Text>
                  <Text style={styles.preferenceDesc}>
                    Xem điều chỉnh thời hạn hoặc số tiền mục tiêu thay vì cắt giảm chi tiêu.
                  </Text>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="radio"
                accessibilityState={{
                  selected: formValues.preference === "BALANCED",
                }}
                disabled={isSubmitting}
                onPress={() => handleFieldChange("preference", "BALANCED")}
                style={[
                  styles.preferenceOption,
                  formValues.preference === "BALANCED"
                    ? styles.preferenceOptionActive
                    : null,
                ]}
                testID="fa-preference-balanced"
              >
                <AppIcon
                  color={
                    formValues.preference === "BALANCED"
                      ? colors.primary
                      : colors.muted
                  }
                  name="check"
                  size={18}
                />
                <View style={styles.preferenceTextCol}>
                  <Text style={styles.preferenceTitle}>Xem các lựa chọn</Text>
                  <Text style={styles.preferenceDesc}>
                    Trình bày đầy đủ các phương án để bạn tự cân nhắc.
                  </Text>
                </View>
              </Pressable>
            </Card>

            {/* Checkbox xác nhận không tính trùng nợ */}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: formValues.excludeDebtFromExpensesConfirmation,
              }}
              disabled={isSubmitting}
              onPress={() =>
                handleFieldChange(
                  "excludeDebtFromExpensesConfirmation",
                  !formValues.excludeDebtFromExpensesConfirmation,
                )
              }
              style={[
                styles.confirmCard,
                formValues.excludeDebtFromExpensesConfirmation
                  ? styles.confirmCardChecked
                  : null,
                fieldErrors["excludeDebtFromExpensesConfirmation"]
                  ? styles.confirmCardError
                  : null,
              ]}
              testID="fa-confirm-input"
            >
              <View
                style={[
                  styles.checkbox,
                  formValues.excludeDebtFromExpensesConfirmation
                    ? styles.checkboxChecked
                    : null,
                ]}
              >
                {formValues.excludeDebtFromExpensesConfirmation ? (
                  <AppIcon color={colors.surface} name="check" size={14} />
                ) : null}
              </View>
              <View style={styles.confirmContent}>
                <Text style={styles.confirmTitle}>
                  Cam kết số liệu không trùng lặp
                </Text>
                <Text style={styles.confirmText}>
                  Tôi xác nhận các khoản chi tiêu thiết yếu và linh hoạt đã nhập ở
                  trên không tính trùng khoản trả nợ.
                </Text>
              </View>
            </Pressable>
            {fieldErrors["excludeDebtFromExpensesConfirmation"] ? (
              <Text accessibilityLiveRegion="polite" style={styles.fieldErrorText}>
                {fieldErrors["excludeDebtFromExpensesConfirmation"]}
              </Text>
            ) : null}

            {/* Trạng thái Loading */}
            {isSubmitting ? (
              <StateCard
                loading
                message="Hệ thống đang tính toán các phương án tối ưu..."
                testID="fa-loading"
                title="Đang phân tích kế hoạch"
              />
            ) : null}

            {/* Banner Lỗi */}
            {!isSubmitting && errorState ? (
              <View
                accessibilityRole="alert"
                style={styles.errorContainer}
                testID="fa-error"
              >
                <View style={styles.errorHeaderRow}>
                  <AppIcon color={colors.danger} name="alert" size={20} />
                  <Text style={styles.errorTitle}>{errorState.title}</Text>
                </View>
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.errorMessage}
                >
                  {errorState.message}
                </Text>
                {errorState.isAuth ? (
                  <Button
                    label="Đăng nhập lại"
                    onPress={() => void logout()}
                    testID="fa-relogin-button"
                    variant="outline"
                  />
                ) : (
                  <Button
                    label="Thử lại"
                    onPress={handleSubmit}
                    testID="fa-retry"
                    variant="outline"
                  />
                )}
              </View>
            ) : null}

            {/* Nút gửi phân tích */}
            <Button
              disabled={isSubmitting}
              label={isSubmitting ? "Đang phân tích..." : "Phân tích kế hoạch"}
              loading={isSubmitting}
              onPress={handleSubmit}
              testID="fa-submit"
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
  },
  scroll: {
    width: "100%",
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: sizes.contentMaxWidth,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.lg,
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  tabButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  tabButtonActive: {
    backgroundColor: colors.surface,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  tabText: {
    ...typography.label,
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.primary,
    fontWeight: "700",
  },
  formContainer: {
    gap: spacing.lg,
  },
  guideCard: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  guideHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  guideTitle: {
    ...typography.label,
    color: colors.primary,
  },
  guideDescription: {
    ...typography.caption,
    color: colors.text,
    lineHeight: 18,
  },
  inputSectionCard: {
    gap: spacing.md,
  },
  sectionHeader: {
    ...typography.label,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  preferenceOption: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  preferenceOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  preferenceTextCol: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  preferenceTitle: {
    ...typography.label,
    color: colors.text,
  },
  preferenceDesc: {
    ...typography.caption,
    color: colors.muted,
    lineHeight: 18,
  },
  durationPresetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: -spacing.xs,
    flexWrap: "wrap",
  },
  durationPresetLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  durationChips: {
    flexDirection: "row",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  durationChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  durationChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  durationChipText: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: "600",
  },
  durationChipTextActive: {
    color: colors.primary,
    fontWeight: "700",
  },
  confirmCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  confirmCardChecked: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  confirmCardError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1.5,
  },
  confirmContent: {
    flex: 1,
    gap: 2,
  },
  confirmTitle: {
    ...typography.label,
    fontSize: 14,
    color: colors.text,
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.sm,
  },
  confirmRowError: {
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  confirmText: {
    flex: 1,
    ...typography.caption,
    color: colors.text,
    lineHeight: 18,
  },
  fieldErrorText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: -spacing.xs,
    marginLeft: spacing.sm,
  },
  errorContainer: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  errorTitle: {
    ...typography.label,
    color: colors.danger,
  },
  errorMessage: {
    ...typography.body,
    color: colors.text,
  },
  resultContainer: {
    gap: spacing.lg,
  },
  modeCard: {
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  modeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  modeTitle: {
    ...typography.label,
    color: colors.text,
  },
  fallbackNotice: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.xs,
  },
  warningList: {
    gap: spacing.sm,
  },
  warningCard: {
    backgroundColor: colors.warningSoft,
    borderColor: "#FCD34D",
    gap: spacing.xs,
  },
  warningHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  warningTitle: {
    ...typography.label,
    color: colors.warning,
  },
  warningMessage: {
    ...typography.caption,
    color: colors.text,
    lineHeight: 18,
  },
  metricsCard: {
    gap: spacing.md,
  },
  heroMetricBanner: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    gap: spacing.xs / 2,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  heroMetricBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs / 2,
  },
  heroMetricBadgeText: {
    ...typography.caption,
    fontWeight: "700",
    color: colors.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  heroMetricLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  heroMetricValue: {
    ...typography.heading,
    fontSize: 22,
    color: colors.primary,
    fontWeight: "800",
    textAlign: "center",
    marginVertical: spacing.xs / 2,
  },
  heroMetricSubtext: {
    ...typography.caption,
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  metricItem: {
    width: "47%",
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs / 2,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  metricValue: {
    ...typography.label,
    fontSize: 15,
    color: colors.text,
  },
  positiveValue: {
    color: colors.success,
  },
  negativeValue: {
    color: colors.danger,
  },
  neutralValue: {
    color: colors.text,
  },
  explanationCard: {
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  explanationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  explanationTitle: {
    flex: 1,
    ...typography.label,
    fontSize: 15,
    color: colors.text,
  },
  paragraphsContainer: {
    gap: spacing.sm,
  },
  paragraphText: {
    ...typography.body,
    lineHeight: 20,
    color: colors.text,
  },
  optionsSection: {
    gap: spacing.md,
  },
  optionCard: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  preferredOptionCard: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  optionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionTitle: {
    ...typography.label,
    fontSize: 15,
    color: colors.text,
  },
  preferredBadge: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  preferredBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "700",
  },
  optionSummary: {
    ...typography.caption,
    color: colors.muted,
    marginVertical: spacing.xs / 2,
  },
  optionDetailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  optionDetailLabel: {
    ...typography.caption,
    fontWeight: "700",
    color: colors.text,
    width: 65,
  },
  optionDetailValue: {
    flex: 1,
    ...typography.caption,
    color: colors.text,
  },
  assumptionsCard: {
    backgroundColor: colors.surfaceMuted,
    gap: spacing.xs,
  },
  assumptionsTitle: {
    ...typography.label,
    fontSize: 13,
    color: colors.muted,
  },
  assumptionItem: {
    ...typography.caption,
    color: colors.muted,
    lineHeight: 18,
  },
});
