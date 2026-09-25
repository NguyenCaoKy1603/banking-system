/**
 * Types and schemas for the offline evaluation suite of NOVA Assistant (Phase 5).
 */

export type EvaluationGroup = "POS" | "NEG" | "EXTRA";

export type EvaluationCase = {
  id: string;
  group: EvaluationGroup;
  subGroup?: "original" | "paraphrase";
  question: string;
  sourceRef: string;
  description: string;
  requiredBehaviors: string[];
  forbiddenBehaviors: string[];
  requiredConditions: string[];
  automatedChecks: string[];
  semanticReviewCriteria: string[];
};

export type ConditionId =
  | "C1_NAVIGATION"
  | "C2_BUSINESS_CONDITIONS"
  | "C3_NO_HALLUCINATION"
  | "C4_NO_SECRET_HARVESTING";

export type ConditionVerdict =
  | "PASS"
  | "FAIL"
  | "NEEDS_REVIEW"
  | "NOT_APPLICABLE";

export type OverallVerdict =
  | "PASS"
  | "FAIL"
  | "NEEDS_REVIEW"
  | "ERROR"
  | "NOT_RUN";

export type ConditionEvaluation = {
  conditionId: ConditionId;
  verdict: ConditionVerdict;
  reason: string;
  evidenceSnippets?: string[];
  isAutomated: boolean;
};

export type CaseEvaluationResult = {
  caseId: string;
  group: EvaluationGroup;
  subGroup?: "original" | "paraphrase";
  question: string;
  response: string;
  overallVerdict: OverallVerdict;
  conditionResults: Record<ConditionId, ConditionEvaluation>;
  needsReview: boolean;
  reviewNotes: string[];
  durationMs: number;
  error?: string;
};

export type EvaluationRunMetadata = {
  runId: string;
  timestamp: string;
  mode: "offline-fake" | "local-ollama";
  gitHead: string;
  workingTreeStatus: string;
  datasetVersion: string;
  datasetHash: string;
  promptVersion: string;
  promptHash: string;
  faqVersion: string;
  faqHash: string;
  model: string;
  tokenUsage: string;
  cost: string;
  externalAiCalls: number;
  localModelCalls?: number;
};

export type GroupStatistics = {
  total: number;
  passed: number;
  failed: number;
  needsReview: number;
  error: number;
};

export type ConditionStatistics = {
  passed: number;
  failed: number;
  needsReview: number;
  notApplicable: number;
};

export type EvaluationSummary = {
  metadata: EvaluationRunMetadata;
  totalCases: number;
  runCases: number;
  passedCases: number;
  failedCases: number;
  needsReviewCases: number;
  errorCases: number;
  notRunCases: number;
  groupStats: Record<EvaluationGroup, GroupStatistics>;
  conditionStats: Record<ConditionId, ConditionStatistics>;
  cases: CaseEvaluationResult[];
};
