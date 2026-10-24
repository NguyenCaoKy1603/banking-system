# Financial Advice — acceptance review (2026-10-04)

Status: `WEB_DEMO_PENDING_USER_AUTHENTICATION`
Repository snapshot: `codex/staging-academic-completion` @ `dc741f6213d0f0391f9b334e3145698e39abec84`.

## Existing live evaluation reconciliation

The six source reports listed in the companion JSON were re-hashed and match the previously reviewed artifacts. Their common 19-entry source manifest still matches the current workspace. No evaluation suite or model inference was rerun for this reconciliation.

- 16 cases completed; schema, semantic contract, status, metrics, candidate feasibility, primary reason, warnings and public response are valid for 16/16.
- Qwen selected an option in AI-assisted mode for 16/16; 16 provider charges are already recorded in those reports.
- Strict preferred-oracle match is 15/16 (93.75%). B-01 is the only strict mismatch.
- B-01 is not a calculation or schema failure: both `REDUCE_FLEXIBLE_SPENDING` and `ADJUST_SAVINGS_TARGET` are feasible and have `MONTHLY_GAP` as the primary reason; the oracle's accepted preferred ID is only `ADJUST_SAVINGS_TARGET`, while the recorded Qwen selection is `REDUCE_FLEXIBLE_SPENDING`.
- The original product gate remains `PASS`. The 93.75% strict preferred-match rate determines only the separate live-preference gate: it is `PASS` if the Owner selects ≥15/16 and `FAIL` if the Owner selects ≥95%. The live threshold and whether B-01 should remain strict or accept all valid balanced candidates are still `UNRESOLVED`; no policy/oracle was changed.

## Offline checks and provider cap

Exact service-only B-01 with the provider disabled produced the deterministic `RULE_BASED/AI_DISABLED` fallback, capacity 1,000,000 VND and target gap 1,000,000 VND. Exact B-05 service-only fallback produced `DEFICIT` / `REVIEW_BASE_BUDGET` / `BASE_BUDGET_DEFICIT`. These are service-level checks, not HTTP or Web results.

The isolated demo launcher now injects one shared limiter into help and Financial Advice. The task-specific Web cap is two provider charges, with a separate attempt counter; the third attempt is rejected before reaching the fake provider in unit coverage. Typecheck, build, and the targeted isolated-demo suite passed (7/7). The live listener was restarted and its safe startup counters reported two Web charges available and zero charged. This startup observation plus fake-provider tests is not yet a live Web proof of the cap.

### W05–W08 offline regression evidence

The following targeted offline test commands completed without real Qwen calls or PostgreSQL:

- Backend: `node --import=tsx --test src/tests/financialAdviceHttp.test.ts src/tests/financialAdviceService.test.ts src/tests/financialAdviceIsolatedDemo.test.ts` — **41/41 PASS**.
- Mobile: `npm test -- --runInBand --runTestsByPath src/features/financial-advice/__tests__/FinancialAdviceScreen.test.tsx src/features/financial-advice/__tests__/financialAdviceApi.test.ts src/features/financial-advice/__tests__/FinancialAdviceReauthentication.integration.test.tsx` — **3 suites, 22/22 PASS**.

| Case | Offline evidence | Web/manual status and boundary |
| --- | --- | --- |
| W05 | Component regressions cover double-submit suppression, pending response after session-epoch change, and stale 401 not affecting the new session. | Component/Auth integration evidence only; editing the form while pending was not independently confirmed. Manual Web `NOT_RUN`. |
| W06 | Component/API tests cover retry affordance after 429 and `NETWORK_ERROR` mapping. | No stop/start of the Web backend was performed. This does not prove browser-level offline recovery or a network timeout; Web `NOT_RUN`. |
| W07 | Three integration tests exercise the real AuthProvider/protected-route composition with a fake Fetch transport, including final 401 → logout → protected login and stale-401 isolation. | App integration evidence, not a live Web HTTP/browser session. Web `NOT_RUN`. |
| W08 | Backend fake-provider/service/HTTP tests cover invalid selector fallback, shared help/advice quota, and the isolated demo's third-call rejection before provider; included in 41/41 above. | Offline contract evidence only; no real provider error was induced, and no Web error screen was exercised. Web `NOT_RUN`. |

These results complete the requested offline regression review for W05–W08 at their actual test layers, but do not upgrade the W cases to manual Web PASS. No additional offline server was started because the targeted fixtures already supplied the requested fake-provider and app-integration coverage.

## Web demonstration status

The only remaining authorized live Web cases are S-01 and B-01, at most one request each and no more than two provider calls total. Neither has been submitted in the restarted session: the browser remains at `/login`, and no Web provider charge has occurred. User authentication must be completed manually; no credentials were entered or captured by the agent. No help/warm-up request, PostgreSQL, Docker, or database action was run.

| Case | Web invocation | Provider charge | Result |
| --- | ---: | ---: | --- |
| S-01 | 0 | 0 | `NOT_RUN — awaiting manual login` |
| B-01 | 0 | 0 | `NOT_RUN — awaiting manual login` |

Backend is the isolated in-memory demo on loopback port 5010; Expo Web remains on localhost port 8082. Restarting the backend reset the prior in-memory authentication session. The task-owned listener is left running; Expo and Ollama were not stopped. No database state was touched.

## Owner decisions still needed

1. B-01 oracle: retain strict `ADJUST_SAVINGS_TARGET`, or accept any feasible balanced candidate including `REDUCE_FLEXIBLE_SPENDING`.
2. Product threshold: accept at least 15/16, require at least 95%, or keep the gate unresolved.

Until those decisions and the two Web observations are recorded, content/live acceptance remains partial; these results do not imply that the selector is correct for every case or that Mobile/Android/device E2E passed.

## Reproducibility hashes

The exact byte counts and SHA-256 values for the six evaluation reports and the three changed isolated-cap source/test files are recorded in `financial-advice-acceptance-review-20261004.json`. This review does not replace or rewrite any original evaluation report.
