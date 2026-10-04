# Financial Advice evaluation evidence — fe62a8f1-11d3-4d03-9d16-3fcf018b03a7

- Run ID: `fe62a8f1-11d3-4d03-9d16-3fcf018b03a7`
- Timestamp UTC: `2026-10-03T09:12:50.701Z`
- Timestamp Asia/Bangkok: `2026-10-03 16:12:50 +07:00`
- Git: `codex/staging-academic-completion` @ `dc741f6213d0f0391f9b334e3145698e39abec84`
- Dataset: `2026.10-fa-v2` / SHA-256 `2aba2665369637793f13fe6a1a93a5c18ad125f0c8be2657c16de80afe2d3cfb`
- Policy/calculation/catalog: `fa-selection-v2` / `fa-calc-v1` / `fa-catalog-v2`
- Advisor prompt SHA-256: `35b75310934a5a0bbfff931b4cb47aa7b6ccd3528d4870f43906ae36b35b4163`
- Node/runtime: `v24.19.0`; host=win32/x64.
- Relevant source SHA-256 manifest:

| Path | SHA-256 |
| --- | --- |
| `backend/src/financialAdvice/adviceService.ts` | `42c7db921dcbdf4eadc4591d01a96d915b67915cf97059a0b1a4eb4427112c8b` |
| `backend/src/financialAdvice/advisorPrompt.ts` | `fececd95e6ff14951d26fb81e2b3722cf878bf3ed00986c43b75ae80cede439c` |
| `backend/src/financialAdvice/calculations.ts` | `8e84f145a51e4f2629acf8a4abf8d7e4641c627f08b68b03626c112b32b2b808` |
| `backend/src/financialAdvice/explanationCatalog.ts` | `6815fe35b556e0db31460c08ba400fa944a8c456d19294ac239bbb5e9b18ea38` |
| `backend/src/financialAdvice/options.ts` | `e62443bed9f87e22bc10bf584b413a74baaa7d0f986383bd5214e0214ba88002` |
| `backend/src/financialAdvice/selectionPolicy.ts` | `c8f7242f580ebe3ea42b11defd011fd64627b8f37954ca3305ec07986ce576c3` |
| `backend/src/financialAdvice/selectorValidation.ts` | `7fcae7ae6f9fa9bf14773b65d2c0acd3e1a663eb031c86f11ce18d01ab67e31f` |
| `backend/src/financialAdvice/types.ts` | `398ddecd5cc6466318fe3aeeee94c9da3513511dd0acf77babebf660b6817265` |
| `backend/src/financialAdvice/validation.ts` | `070b39e61e37bf17dd94a94c32c99e057cab92d01d5482d8ea1b00b93d64e8b4` |
| `backend/src/assistant/helpConfig.ts` | `8f1df7f1c6b38d7603006bab3b02816e65edcd5d0c26ec27b34a4282e19df818` |
| `backend/src/assistant/ollamaHelpProvider.ts` | `8e01a3adc2c00de1d9e6096caefe7cf65cdef78d8a6d688e7eb3fc599c84b07e` |
| `backend/src/assistant/rateLimiter.ts` | `78cc44510f5fd04a49350163e49e02acc02d18c34dcc91fd3cca20e18e0ff772` |
| `backend/src/tests/financialAdviceEvaluation/dataset.ts` | `08e6adadc0d05c2d2aa91288adbb8accdfb3bde9c702f5b8d3182dd6e064eee1` |
| `backend/src/tests/financialAdviceEvaluation/reporting.ts` | `dd780157dd928263f38a3c88b70ee0652149f8d4d1bc9aa1ae795b60a7c1f90a` |
| `backend/src/tests/financialAdviceEvaluation/runner.ts` | `ddfbae85d5f9d2fe43e768ca67fa4d2620b06c26ac1f6b0a0596f90ae15f4e03` |
| `mobile-app/src/features/financial-advice/types/financialAdvice.ts` | `d06668d948eb575d5e6934a6214ee79ecd71cbd606a22206e8ccd69735553640` |
| `mobile-app/src/features/financial-advice/validation/financialAdviceValidators.ts` | `ab3719274d539bc0117db359bea29e5ae93f88bfd6e1d0e16ed6d00fdcd9a7fc` |

- Mode/batch: `offline` / `all`
- Model: `qwen3.5:4b`; digest: `unavailable`
- Command: `node --import=tsx scripts/evaluate-financial-advice.ts --offline --batch=all`
- Resolved service fixture config: enabled=false; requestTimeoutMs=12000; providerTimeoutMs=10000; per-user-rate=5/min; maxConcurrent=2; provider budget=10/process
- Threshold source: PROVISIONAL — OWNER DECISION REQUIRED; selection: `UNRESOLVED`

## Summary (each ratio reports numerator / configured denominator)

- Configured cases/results: 16/16; complete=true; missing=0; duplicates=0.
- Provider attempted/charged: 0/16 / 0/16; per-run quota invariant=true; runs=fe62a8f1-11d3-4d03-9d16-3fcf018b03a7:0/0.
- AI_ASSISTED: 0/16 (0%); RULE_BASED: 16/16 (100%).
- Raw schema valid: 0/0 (N/A) of attempted; 0/16 (0%) of configured.
- Semantic valid: 0/0 (N/A) of attempted; 0/16 (0%) of configured.
- Metrics/status/candidate feasibility/preferred-primary/warnings/public: 16/16 (100%) / 16/16 (100%) / 16/16 (100%)+16/16 (100%) / 16/16 (100%)+16/16 (100%) / 16/16 (100%) / 15/16 (93.75%).
- Valid and appropriate live selectors: 0/16 (0%).
- Latency min/median/max/average: 0 ms / 0 ms / 1 ms / 0.13 ms.
- Provisional threshold checks: >=15/16=BLOCKED; >=95%=BLOCKED; product gate=FAIL; offline gate=FAIL; live gate=NOT_APPLICABLE; exit=1.

## Case results (no raw request, provider text, financial values, or exception messages)

| Case | Batch | Run | Execution | Attempt | Raw schema | Semantic | Public | Status | Metrics | Candidates/feasible | Preferred/primary | Warnings | Mode | Fallback | Selected ID | Reason IDs | Latency | Failure category |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| S-01 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | EXTEND_DEADLINE | MONTHLY_GAP,EXTEND_TIME_TO_CAPACITY | 1 | NONE |
| S-02 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | MAINTAIN_PLAN | GOAL_FEASIBLE | 0 | NONE |
| S-03 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | MAINTAIN_PLAN | GOAL_FEASIBLE | 0 | NONE |
| S-04 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | FAIL | false | N/A | N/A | false | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | GOAL_ALREADY_FUNDED | TARGET_ALREADY_FUNDED | 0 | PUBLIC_RESPONSE_INVALID |
| S-05 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | REVIEW_BASE_BUDGET | NO_SAVING_CAPACITY,REVIEW_DECLARED_INPUTS | 0 | NONE |
| S-06 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | REDUCE_FLEXIBLE_SPENDING | MONTHLY_GAP,KEEP_TARGET_WITH_FLEXIBLE_CUT | 0 | NONE |
| S-07 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | EXTEND_DEADLINE | MONTHLY_GAP,EXTEND_TIME_TO_CAPACITY,PRESERVE_CURRENT_SPENDING | 0 | NONE |
| S-08 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | LOWER_GOAL_AMOUNT | MONTHLY_GAP,ADJUST_GOAL_TO_CAPACITY,PRESERVE_CURRENT_SPENDING | 0 | NONE |
| B-01 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | ADJUST_SAVINGS_TARGET | MONTHLY_GAP,ADJUST_GOAL_TO_CAPACITY | 0 | NONE |
| B-02 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | MAINTAIN_BUDGET | BUDGET_TARGET_MET | 0 | NONE |
| B-03 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | MAINTAIN_BUDGET | BUDGET_TARGET_MET | 1 | NONE |
| B-04 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | MAINTAIN_BUDGET | BUDGET_TARGET_MET | 0 | NONE |
| B-05 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | REVIEW_BASE_BUDGET | BASE_BUDGET_DEFICIT,REVIEW_DECLARED_INPUTS,NO_SAVING_CAPACITY | 0 | NONE |
| B-06 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | REDUCE_FLEXIBLE_SPENDING | MONTHLY_GAP,KEEP_TARGET_WITH_FLEXIBLE_CUT | 0 | NONE |
| B-07 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | ADJUST_SAVINGS_TARGET | MONTHLY_GAP,ADJUST_GOAL_TO_CAPACITY,PRESERVE_CURRENT_SPENDING | 0 | NONE |
| B-08 | all | fe62a8f1-11d3-4d03-9d16-3fcf018b03a7 | PASS | false | N/A | N/A | true | true | true | true/true | true/true | true | RULE_BASED | AI_DISABLED | ADJUST_SAVINGS_TARGET | MONTHLY_GAP,ADJUST_GOAL_TO_CAPACITY | 0 | NONE |

## Interpretation

Offline deterministic evidence only. No live-model selector score is claimed; live evaluation remains BLOCKED until prerequisites, owner threshold decision, and separate authorization are present.

95% on 16 cases requires 16/16; 15/16 is 93.75%. Threshold approval is not inferred from these measurements.
