import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type {
  AcknowledgeAnomalyDecision,
  AnomaliesListResponse,
  AnomalyDetailResponse,
  AnomalyStatus,
} from "@/features/anomalies/types/anomaly";
import {
  isAnomaliesListResponse,
  isAnomalyDetailResponse,
} from "@/features/anomalies/validation/anomalyResponseValidators";

export function listAnomalies(
  auth: RequestAuth,
  status?: AnomalyStatus,
): Promise<AnomaliesListResponse> {
  const path = status
    ? `/anomalies?status=${encodeURIComponent(status)}`
    : "/anomalies";
  return requestJson<AnomaliesListResponse>(path, { auth }, isAnomaliesListResponse);
}

export function getAnomalyDetail(
  anomalyId: string,
  auth: RequestAuth,
): Promise<AnomalyDetailResponse> {
  return requestJson<AnomalyDetailResponse>(
    `/anomalies/${encodeURIComponent(anomalyId)}`,
    { auth },
    isAnomalyDetailResponse,
  );
}

export function acknowledgeAnomaly(
  anomalyId: string,
  input: { decision: AcknowledgeAnomalyDecision; note?: string },
  auth: RequestAuth,
): Promise<AnomalyDetailResponse> {
  return requestJson<AnomalyDetailResponse>(
    `/anomalies/${encodeURIComponent(anomalyId)}/acknowledge`,
    {
      method: "POST",
      auth,
      body: input,
    },
    isAnomalyDetailResponse,
  );
}
