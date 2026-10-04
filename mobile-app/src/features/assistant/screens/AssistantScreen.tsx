import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { useAuth } from "@/features/auth/context/AuthContext";
import { askAssistantHelp } from "@/features/assistant/api/assistantApi";
import {
  countCodePoints,
  MAX_QUESTION_CODE_POINTS,
} from "@/features/assistant/types/assistant";
import { ApiError } from "@/services/api/ApiError";
import { colors, radius, sizes, spacing, typography } from "@/theme";

export const SAMPLE_QUESTIONS: readonly string[] = [
  "Tôi xem và ẩn số dư ở đâu?",
  "Tôi xem lịch sử giao dịch ở đâu?",
  "Tôi quét mã QR như thế nào?",
  "Tôi khóa hoặc mở khóa thẻ thế nào?",
];

type MappedError = {
  title: string;
  message: string;
  isAuth?: boolean;
};

export function mapAssistantError(error: unknown): MappedError {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        title: "Phiên đăng nhập hết hạn",
        message: "Vui lòng đăng nhập lại để tiếp tục sử dụng trợ lý hướng dẫn.",
        isAuth: true,
      };
    }

    if (error.code === "ASSISTANT_SENSITIVE_INPUT") {
      return {
        title: "Thông tin nhạy cảm",
        message:
          "Câu hỏi chứa thông tin bảo mật (mật khẩu, mã OTP, mã PIN, số tài khoản...). Vui lòng xóa các thông tin này và thử lại.",
      };
    }

    if (
      error.code === "ASSISTANT_CONCURRENCY_LIMIT" ||
      error.code === "ASSISTANT_RATE_LIMITED" ||
      error.status === 429
    ) {
      return {
        title: "Hệ thống đang bận",
        message:
          "Hệ thống trợ lý đang nhận nhiều yêu cầu cùng lúc. Vui lòng chờ vài giây rồi gửi lại.",
      };
    }

    if (error.code === "ASSISTANT_UNAVAILABLE" || error.status === 503) {
      return {
        title: "Dịch vụ tạm dừng",
        message:
          "Dịch vụ trợ lý hướng dẫn hiện đang tạm dừng bảo trì. Vui lòng thử lại sau.",
      };
    }

    if (error.code === "ASSISTANT_PROVIDER_ERROR" || error.status === 502) {
      return {
        title: "Lỗi kết nối mô hình",
        message:
          "Mô hình trợ lý AI đang không phản hồi. Vui lòng thử lại sau.",
      };
    }

    if (
      error.code === "ASSISTANT_TIMEOUT" ||
      error.code === "TIMEOUT" ||
      error.status === 504
    ) {
      return {
        title: "Hết thời gian chờ",
        message:
          "Yêu cầu đã hết thời gian chờ từ máy chủ. Bạn có thể nhấn Gửi để thử lại.",
      };
    }

    if (error.code === "NETWORK_ERROR") {
      return {
        title: "Lỗi kết nối mạng",
        message:
          "Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng của bạn.",
      };
    }

    if (error.code === "REQUEST_ABORTED") {
      return {
        title: "Yêu cầu đã hủy",
        message: "Yêu cầu tra cứu đã được hủy.",
      };
    }

    return {
      title: "Không thể nhận câu trả lời",
      message:
        error.message ||
        "Đã xảy ra lỗi trong quá trình xử lý. Vui lòng thử lại sau.",
    };
  }

  if (error instanceof Error) {
    return {
      title: "Không thể gửi câu hỏi",
      message: error.message,
    };
  }

  return {
    title: "Lỗi không xác định",
    message: "Không thể nhận câu trả lời lúc này. Vui lòng thử lại sau.",
  };
}

export function AssistantScreen() {
  const router = useRouter();
  const { deviceId, logout, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<MappedError | null>(null);

  const isMountedRef = useRef(true);
  const submittingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const trimmedQuestion = question.trim();
  const codePointsCount = countCodePoints(trimmedQuestion);
  const isOverLimit = codePointsCount > MAX_QUESTION_CODE_POINTS;
  const canSubmit =
    !isSubmitting && codePointsCount > 0 && !isOverLimit;

  const handleSend = useCallback(async () => {
    if (submittingRef.current || !canSubmit) {
      return;
    }

    Keyboard.dismiss();
    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorState(null);
    setAnswer(null);

    // Chuẩn bị abort controller riêng cho lượt gửi này
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await askAssistantHelp(trimmedQuestion, {
        auth,
        signal: controller.signal,
      });

      if (!isMountedRef.current) {
        return;
      }

      setAnswer(response.answer);
    } catch (err: unknown) {
      if (!isMountedRef.current) {
        return;
      }

      // Nếu client chủ động hủy khi rời màn hình thì không ghi lỗi lên UI
      if (err instanceof ApiError && err.code === "REQUEST_ABORTED") {
        return;
      }

      const mapped = mapAssistantError(err);
      setErrorState(mapped);
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
        submittingRef.current = false;
      }
    }
  }, [canSubmit, trimmedQuestion, auth]);

  const handleSelectSample = (sample: string) => {
    if (isSubmitting) return;
    setQuestion(sample);
    setErrorState(null);
  };

  const handleRelogin = useCallback(async () => {
    await logout();
  }, [logout]);

  return (
    <Screen style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        <AppHeader
          backTestID="assistant-back-button"
          eyebrow="TRỢ LÝ AI NOVA"
          onBack={() => router.back()}
          subtitle="Hướng dẫn thao tác trong ứng dụng; không thực hiện giao dịch."
          title="Trợ lý hướng dẫn"
        />

        {/* Điểm vào tính năng Tư vấn tài chính cá nhân */}
        <Card style={styles.financialAdviceCard} testID="assistant-financial-advice-card">
          <View style={styles.financialAdviceHeader}>
            <View style={styles.financialAdviceIconBox}>
              <AppIcon color={colors.primary} name="savings" size={20} />
            </View>
            <View style={styles.financialAdviceTextCol}>
              <Text style={styles.financialAdviceTitle}>Tư vấn tài chính</Text>
              <Text style={styles.financialAdviceSubtitle}>
                Lập kế hoạch từ thu nhập, chi phí và mục tiêu bạn cung cấp.
              </Text>
            </View>
          </View>
          <Button
            icon="chevronRight"
            label="Lập kế hoạch tài chính"
            onPress={() => router.push("/financial-advice")}
            testID="assistant-navigate-financial-advice"
            variant="outline"
          />
        </Card>

        {/* Cảnh báo an toàn thông tin bắt buộc */}
        <Card style={styles.disclaimerCard} testID="assistant-disclaimer">
          <View style={styles.disclaimerHeader}>
            <AppIcon color={colors.warning} name="shield" size={20} />
            <Text style={styles.disclaimerTitle}>Lưu ý an toàn</Text>
          </View>
          <Text style={styles.disclaimerText}>
            Trợ lý chỉ giải đáp thắc mắc về cách sử dụng ứng dụng NOVA. Tuyệt
            đối không gửi mật khẩu, mã PIN, mã xác thực OTP hay số tài khoản
            đầy đủ vào khung hỏi.
          </Text>
        </Card>

        {/* Khung nhập câu hỏi */}
        <Card style={styles.inputCard}>
          <Text style={styles.inputLabel}>Câu hỏi của bạn</Text>
          <View
            style={[
              styles.inputBox,
              isOverLimit ? styles.inputBoxError : null,
              isSubmitting ? styles.inputBoxDisabled : null,
            ]}
          >
            <TextInput
              accessibilityLabel="Ô nhập câu hỏi cho trợ lý"
              editable={!isSubmitting}
              multiline
              onChangeText={(text) => {
                setQuestion(text);
                if (errorState) setErrorState(null);
              }}
              placeholder="Ví dụ: Tôi xem lịch sử giao dịch ở đâu?"
              placeholderTextColor={colors.subtle}
              style={styles.textInput}
              testID="assistant-question-input"
              value={question}
            />
          </View>

          <View style={styles.inputFooter}>
            {isOverLimit ? (
              <Text
                accessibilityLiveRegion="polite"
                style={styles.overLimitWarning}
              >
                Vượt quá {MAX_QUESTION_CODE_POINTS} ký tự cho phép
              </Text>
            ) : (
              <Text style={styles.charCountText}>
                {codePointsCount}/{MAX_QUESTION_CODE_POINTS} ký tự
              </Text>
            )}

            <PrimaryButton
              disabled={!canSubmit}
              label={isSubmitting ? "Đang tra cứu..." : "Gửi câu hỏi"}
              onPress={handleSend}
              testID="assistant-send-button"
            />
          </View>
        </Card>

        {/* Câu hỏi mẫu gợi ý */}
        <View style={styles.samplesSection}>
          <Text style={styles.samplesHeader}>Câu hỏi gợi ý</Text>
          <View style={styles.chipsContainer}>
            {SAMPLE_QUESTIONS.map((sample, index) => (
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                key={sample}
                onPress={() => handleSelectSample(sample)}
                style={({ pressed }) => [
                  styles.chip,
                  pressed && !isSubmitting ? styles.chipPressed : null,
                  isSubmitting ? styles.chipDisabled : null,
                ]}
                testID={`assistant-sample-chip-${index}`}
              >
                <Text style={styles.chipText}>{sample}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Trạng thái đang tải */}
        {isSubmitting ? (
          <StateCard
            loading
            message="Trợ lý đang đối chiếu hướng dẫn sử dụng..."
            testID="assistant-loading-state"
            title="Đang tìm câu trả lời"
          />
        ) : null}

        {/* Hiển thị câu trả lời dạng văn bản sạch */}
        {!isSubmitting && answer ? (
          <Card elevated style={styles.answerCard} testID="assistant-answer-card">
            <View style={styles.answerHeader}>
              <View style={styles.answerIconBox}>
                <AppIcon color={colors.primary} name="check" size={20} />
              </View>
              <Text style={styles.answerTitle}>Hướng dẫn từ NOVA</Text>
            </View>
            <Text style={styles.answerText} testID="assistant-answer-text">
              {answer}
            </Text>
          </Card>
        ) : null}

        {/* Hiển thị lỗi thân thiện */}
        {!isSubmitting && errorState ? (
          <View
            accessibilityRole="alert"
            style={styles.errorContainer}
            testID="assistant-error-banner"
          >
            <View style={styles.errorHeaderRow}>
              <AppIcon color={colors.danger} name="alert" size={20} />
              <Text style={styles.errorTitle}>{errorState.title}</Text>
            </View>
            <Text
              accessibilityLiveRegion="polite"
              style={styles.errorMessage}
              testID="assistant-error-message"
            >
              {errorState.message}
            </Text>
            {errorState.isAuth ? (
              <Button
                label="Đăng nhập lại"
                // Logout clears auth state; Stack.Protected then redirects to the auth group.
                onPress={() => void handleRelogin()}
                testID="assistant-relogin-button"
                variant="outline"
              />
            ) : (
              <Button
                disabled={!canSubmit}
                label="Thử lại câu hỏi này"
                onPress={handleSend}
                testID="assistant-retry-button"
                variant="outline"
              />
            )}
          </View>
        ) : null}
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
  disclaimerCard: {
    backgroundColor: colors.warningSoft,
    borderColor: "#FCD34D",
    gap: spacing.xs,
  },
  disclaimerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  disclaimerTitle: {
    ...typography.label,
    color: colors.warning,
  },
  disclaimerText: {
    ...typography.caption,
    color: colors.text,
    lineHeight: 18,
  },
  inputCard: {
    gap: spacing.md,
  },
  inputLabel: {
    ...typography.label,
    color: colors.text,
  },
  inputBox: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  inputBoxError: {
    borderColor: colors.danger,
  },
  inputBoxDisabled: {
    backgroundColor: colors.surfaceMuted,
  },
  textInput: {
    ...typography.body,
    color: colors.text,
    textAlignVertical: "top",
    minHeight: 80,
    padding: 0,
  },
  inputFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    flexWrap: "wrap",
  },
  charCountText: {
    ...typography.caption,
    color: colors.muted,
  },
  overLimitWarning: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: "700",
  },
  samplesSection: {
    gap: spacing.sm,
  },
  samplesHeader: {
    ...typography.label,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    backgroundColor: colors.primarySoft,
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "600",
  },
  answerCard: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1.5,
    gap: spacing.sm,
  },
  answerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  answerIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  answerTitle: {
    ...typography.subheading,
    color: colors.primary,
  },
  answerText: {
    ...typography.body,
    color: colors.text,
    lineHeight: 24,
  },
  errorContainer: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
  },
  errorHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  errorTitle: {
    ...typography.bodyStrong,
    color: colors.danger,
  },
  errorMessage: {
    ...typography.body,
    color: colors.text,
  },
  financialAdviceCard: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  financialAdviceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  financialAdviceIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  financialAdviceTextCol: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  financialAdviceTitle: {
    ...typography.label,
    fontSize: 15,
    color: colors.text,
  },
  financialAdviceSubtitle: {
    ...typography.caption,
    color: colors.muted,
    lineHeight: 18,
  },
});
