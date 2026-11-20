import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppHeader } from "@/components/ui/AppHeader";
import { AppIcon } from "@/components/ui/AppIcon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RequestErrorNotice } from "@/components/ui/RequestErrorNotice";
import { Screen } from "@/components/ui/Screen";
import { StateCard } from "@/components/ui/StateCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  acknowledgeAnomaly,
  listAnomalies,
} from "@/features/anomalies/services/anomalyApi";
import {
  getAnomalyStatusPresentation,
  getRiskLevelPresentation,
  getRuleCodeLabel,
} from "@/features/anomalies/presentation/anomalyPresentation";
import type {
  AcknowledgeAnomalyDecision,
  AnomalyStatus,
  TransactionAnomaly,
} from "@/features/anomalies/types/anomaly";
import { useAuth } from "@/features/auth/context/AuthContext";
import { formatVndMinor } from "@/features/banking/presentation/formatMoney";
import { colors, radius, shadows, sizes, spacing, typography } from "@/theme";

type AnomalyFilter = "ALL" | AnomalyStatus;

const FILTERS: { value: AnomalyFilter; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "OPEN", label: "Chờ xác nhận" },
  { value: "REPORTED_SUSPICIOUS", label: "Đã báo nghi ngờ" },
  { value: "CONFIRMED_SAFE", label: "An toàn" },
  { value: "RESOLVED", label: "Đã xử lý" },
];

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export function AnomalyAlertsScreen() {
  const router = useRouter();
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const sessionEpoch = session?.sessionEpoch ?? null;
  const sessionEpochRef = useRef(sessionEpoch);

  useEffect(() => {
    sessionEpochRef.current = sessionEpoch;
  }, [sessionEpoch]);

  const auth = useMemo(
    () => ({ accessToken, deviceId, refreshAccessToken }),
    [accessToken, deviceId, refreshAccessToken],
  );

  const [anomalyState, setAnomalyState] = useState<{
    epoch: string | null;
    items: TransactionAnomaly[];
  }>({ epoch: sessionEpoch, items: [] });
  const [filter, setFilter] = useState<AnomalyFilter>("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<{
    id: string;
    decision: AcknowledgeAnomalyDecision;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    epoch: string | null;
    value: unknown;
  }>({ epoch: sessionEpoch, value: undefined });

  const anomalies = useMemo(
    () => (anomalyState.epoch === sessionEpoch ? anomalyState.items : []),
    [anomalyState, sessionEpoch],
  );
  const error = errorState.epoch === sessionEpoch ? errorState.value : undefined;

  const loadAnomalies = useCallback(
    async (isManualRefresh = false) => {
      if (!accessToken) {
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }
      if (isManualRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      const capturedEpoch = sessionEpoch;
      setErrorState({ epoch: capturedEpoch, value: undefined });

      try {
        const response = await listAnomalies(auth);
        if (sessionEpochRef.current !== capturedEpoch) return;
        setAnomalyState({ epoch: capturedEpoch, items: response.items });
      } catch (caught: unknown) {
        if (sessionEpochRef.current !== capturedEpoch) return;
        setErrorState({ epoch: capturedEpoch, value: caught });
      } finally {
        if (sessionEpochRef.current === capturedEpoch) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [accessToken, auth, sessionEpoch],
  );

  useFocusEffect(
    useCallback(() => {
      void loadAnomalies(false);
    }, [loadAnomalies]),
  );

  const handleAcknowledge = useCallback(
    async (anomalyId: string, decision: AcknowledgeAnomalyDecision) => {
      if (submittingAction) return;
      const capturedEpoch = sessionEpoch;
      setSubmittingAction({ id: anomalyId, decision });
      setErrorState({ epoch: capturedEpoch, value: undefined });
      try {
        const response = await acknowledgeAnomaly(anomalyId, { decision }, auth);
        if (sessionEpochRef.current !== capturedEpoch) return;
        setAnomalyState((current) => {
          const baseItems = current.epoch === capturedEpoch ? current.items : [];
          return {
            epoch: capturedEpoch,
            items: baseItems.map((item) =>
              item.id === response.anomaly.id ? response.anomaly : item,
            ),
          };
        });
      } catch (caught: unknown) {
        if (sessionEpochRef.current !== capturedEpoch) return;
        setErrorState({ epoch: capturedEpoch, value: caught });
      } finally {
        if (sessionEpochRef.current === capturedEpoch) {
          setSubmittingAction(null);
        }
      }
    },
    [auth, sessionEpoch, submittingAction],
  );

  const openCount = useMemo(
    () => anomalies.filter((item) => item.status === "OPEN").length,
    [anomalies],
  );

  const suspiciousCount = useMemo(
    () => anomalies.filter((item) => item.status === "REPORTED_SUSPICIOUS").length,
    [anomalies],
  );

  const visibleAnomalies = useMemo(() => {
    if (filter === "ALL") return anomalies;
    return anomalies.filter((item) => item.status === filter);
  }, [anomalies, filter]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            colors={[colors.primary]}
            onRefresh={() => void loadAnomalies(true)}
            refreshing={isRefreshing}
            tintColor={colors.primary}
          />
        }
      >
        <AppHeader
          backTestID="anomalies-back"
          eyebrow="Giám sát an toàn giao dịch"
          onBack={() => router.back()}
          subtitle="Hệ thống tự động chấm điểm rủi ro theo giá trị, tần suất, thời điểm và người nhận mới."
          title="Cảnh báo giao dịch bất thường"
        />

        {!isLoading && !error ? (
          <Card style={styles.summaryCard} testID="anomalies-summary">
            <View style={styles.summaryRow}>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryLabel}>Tổng cảnh báo</Text>
                <Text style={styles.summaryValue}>{anomalies.length}</Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryLabel}>Chờ bạn xác nhận</Text>
                <Text style={[styles.summaryValue, openCount > 0 ? styles.warningText : null]}>
                  {openCount}
                </Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryLabel}>Đang điều tra</Text>
                <Text style={[styles.summaryValue, suspiciousCount > 0 ? styles.dangerText : null]}>
                  {suspiciousCount}
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.filterRow}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          testID="anomalies-filters"
        >
          {FILTERS.map((item) => {
            const selected = filter === item.value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={item.value}
                onPress={() => setFilter(item.value)}
                style={[styles.filterChip, selected ? styles.filterChipSelected : null]}
                testID={`anomaly-filter-${item.value.toLowerCase()}`}
              >
                <Text style={[styles.filterChipLabel, selected ? styles.filterChipLabelSelected : null]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {isLoading ? (
          <StateCard loading message="Đang tải cảnh báo giao dịch bất thường..." />
        ) : error ? (
          <RequestErrorNotice
            error={error}
            fallbackMessage="Không thể tải danh sách cảnh báo. Vui lòng thử lại."
            onRetry={() => void loadAnomalies(false)}
            testID="anomalies-error"
          />
        ) : visibleAnomalies.length === 0 ? (
          <StateCard
            icon="shield"
            message={
              anomalies.length === 0
                ? "Chưa ghi nhận giao dịch nào có dấu hiệu bất thường trên tài khoản của bạn."
                : "Không có cảnh báo nào khớp bộ lọc hiện tại."
            }
            title={anomalies.length === 0 ? "Tài khoản an toàn" : "Không có kết quả"}
          />
        ) : (
          <View style={styles.list}>
            {visibleAnomalies.map((item) => {
              const riskMeta = getRiskLevelPresentation(item.riskLevel);
              const statusMeta = getAnomalyStatusPresentation(item.status);
              const isSafeLoading =
                submittingAction?.id === item.id &&
                submittingAction.decision === "CONFIRMED_SAFE";
              const isSuspiciousLoading =
                submittingAction?.id === item.id &&
                submittingAction.decision === "REPORTED_SUSPICIOUS";

              return (
                <Card elevated key={item.id} style={styles.anomalyCard} testID={`anomaly-card-${item.id}`}>
                  <View style={styles.cardHeader}>
                    <View style={styles.badgesRow}>
                      <StatusBadge label={`${riskMeta.label} (${item.riskScore}/100)`} tone={riskMeta.tone} />
                      <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
                    </View>
                  </View>

                  <View style={styles.amountRow}>
                    <View style={styles.alertIcon}>
                      <AppIcon color={colors.warning} name="alert" size={20} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.amountText}>
                        {formatVndMinor(item.amount.amountMinor)}
                      </Text>
                      <Text style={styles.recipientText}>
                        Người nhận: {item.counterpartyName ?? "Tài khoản nội bộ"}
                        {item.maskedDestinationAccount ? ` · ${item.maskedDestinationAccount}` : ""}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.summaryText}>{item.summary}</Text>

                  <View style={styles.flagsList}>
                    {item.flags.map((flag) => (
                      <View key={flag.code} style={styles.flagItem}>
                        <Text style={styles.flagTitle}>
                          • {getRuleCodeLabel(flag.code)} (+{flag.weight} điểm)
                        </Text>
                        <Text style={styles.flagDetail}>{flag.detail}</Text>
                      </View>
                    ))}
                  </View>

                  <Text style={styles.dateText}>
                    Phát hiện lúc: {formatDateTime(item.createdAt)}
                  </Text>

                  {item.status === "OPEN" ? (
                    <View style={styles.actionRow}>
                      <Button
                        disabled={Boolean(submittingAction)}
                        icon="check"
                        label="Tôi thực hiện (An toàn)"
                        loading={isSafeLoading}
                        onPress={() => void handleAcknowledge(item.id, "CONFIRMED_SAFE")}
                        testID={`anomaly-confirm-safe-${item.id}`}
                        variant="secondary"
                      />
                      <Button
                        disabled={Boolean(submittingAction)}
                        icon="alert"
                        label="Báo cáo giao dịch lạ"
                        loading={isSuspiciousLoading}
                        onPress={() => void handleAcknowledge(item.id, "REPORTED_SUSPICIOUS")}
                        testID={`anomaly-report-suspicious-${item.id}`}
                        variant="danger"
                      />
                    </View>
                  ) : null}
                </Card>
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
    maxWidth: sizes.contentMaxWidth,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  summaryCard: {
    padding: spacing.md,
  },
  summaryRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  summaryCell: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    gap: 2,
  },
  summaryLabel: { ...typography.caption, color: colors.muted },
  summaryValue: { ...typography.heading, color: colors.text },
  warningText: { color: colors.warning },
  dangerText: { color: colors.danger },
  filterScroll: { flexGrow: 0, maxHeight: 44 },
  filterRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: 2 },
  filterChip: {
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  filterChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  filterChipLabel: { ...typography.caption, color: colors.muted, fontWeight: "600" },
  filterChipLabelSelected: { color: colors.primary, fontWeight: "700" },
  list: { gap: spacing.md },
  anomalyCard: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  alertIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  amountText: { ...typography.heading, color: colors.text },
  recipientText: { ...typography.caption, color: colors.muted },
  summaryText: { ...typography.bodyStrong, color: colors.text },
  flagsList: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  flagItem: { gap: 2 },
  flagTitle: { ...typography.caption, color: colors.text, fontWeight: "700" },
  flagDetail: { ...typography.caption, color: colors.muted },
  dateText: { ...typography.caption, color: colors.subtle },
  actionRow: { gap: spacing.sm },
});
