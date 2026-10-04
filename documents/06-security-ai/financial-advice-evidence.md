# Chỉ mục bằng chứng Financial Advice — cập nhật 2026-10-04

> **Lưu ý phạm vi:** phần báo cáo cũ bên dưới được giữ nguyên để bảo toàn lịch sử, nhưng thuộc dataset/policy cũ và có các kết luận tuyệt đối không còn được dùng làm bằng chứng nghiệm thu hiện tại. Không diễn giải các số liệu Qwen cũ thành kết quả của source hiện tại.

## Bằng chứng mới nhất

- **NFA-05 live Qwen (reports 2026-10-03):** ba báo cáo gốc được đối chiếu lại mà không gọi provider. Savings, budget và aggregate cùng ghi HEAD `dc741f6213d0f0391f9b334e3145698e39abec84`, dataset/prompt/policy/calculation/catalog versions, model tag/digest và manifest 19 file; toàn bộ manifest hash khớp source hiện tại. Sáu SHA-256 của báo cáo nằm trong [review độc lập](financial-advice-acceptance-review-20261004.md). Kết quả: schema, semantics, status, metrics, candidate list/feasibility và public response 16/16; strict preferred match 15/16 (93,75%); Qwen AI-assisted 16/16; charges 16/16. Ngưỡng ≥15/16 đạt, ≥95% không đạt; lựa chọn ngưỡng còn `UNRESOLVED`, product gate `PASS` nhưng live gate `BLOCKED` vì còn quyết định Owner và Web evidence. Báo cáo aggregate gốc được giữ nguyên, không tái tạo.
- **B-01 reconciliation:** oracle v2 ghi nhận cả `REDUCE_FLEXIBLE_SPENDING` và `ADJUST_SAVINGS_TARGET` là candidate khả thi, với `MONTHLY_GAP` là primary reason cho cả hai; `acceptablePreferredIds` chỉ gồm `ADJUST_SAVINGS_TARGET`. Runtime policy BALANCED chấp nhận cả hai. Qwen chọn `REDUCE_FLEXIBLE_SPENDING` + `MONTHLY_GAP`; schema, semantics, status, metrics, candidate feasibility, public response và primary reason đều PASS; chỉ `preferredMatch` fail. Đây là strict reference-preference mismatch, không phải phép tính sai, phương án bất khả thi hay runtime rejection. Offline service-only exact B-01 cho `RULE_BASED/AI_DISABLED`, capacity 1.000.000 VND, target gap 1.000.000 VND và fallback `ADJUST_SAVINGS_TARGET`; đây không phải Web evidence. D-B01 và D-GATE chờ quyết định Owner.
- **NFA-04 Web:** hồ sơ trước ghi W01–W03 đã được quan sát qua isolated in-memory Web; W03b dùng ví dụ thâm hụt bổ sung, không phải B-05 exact oracle. W04 nhập `1,2` bị client validation chặn trong quan sát trước; không lưu browser network trace. Backend isolated live được khởi động lại ngày 2026-10-04 để nạp limiter cap hai provider charges; startup báo 2 lượt còn, 0 đã charge. Tuy vậy, tab vẫn ở `/login`, nên S-01/B-01 Web chưa gửi và chưa có evidence. W05–W08 không được nâng từ component/API/integration tests thành Web PASS.
- **W05–W08 offline evidence (2026-10-04):** Backend HTTP/service/isolated fake-provider tests PASS 41/41; Mobile FinancialAdviceScreen/API/AuthProvider-protected-route targeted tests PASS 22/22 trong 3 suites. W05 xác nhận double-submit và session-epoch stale response/401; form edit khi pending chưa xác nhận độc lập. W06 xác nhận 429 retry affordance và `NETWORK_ERROR` mapping, không phải stopped-backend browser flow. W07 là AuthProvider/protected-route integration với fake Fetch. W08 là backend fake-provider/quota/invalid-selector evidence. Cả bốn ca vẫn `Web manual NOT_RUN`; không gọi Qwen/PostgreSQL.
- **NFA-06 cap instrumentation:** isolated launcher inject cùng một `AssistantRateLimiter` thật cho help/advice, cap live fixture ở hai provider charges còn lại, đếm riêng lượt vào consumption boundary và charges, và chặn lượt thứ ba trước fake provider. `npm run typecheck`, `npm run build`, `node --import=tsx --test src/tests/financialAdviceIsolatedDemo.test.ts` PASS (7/7). Listener task-owned đã được restart và startup xác nhận cap hai lượt/0 charge; test cap vẫn là unit/fake-provider evidence, chưa có Web request nào chứng minh route-level behavior.
- **NFA-06 gates kế thừa (2026-10-03):** Backend Financial Advice 82/82, assistant 74/74, critical 13/13; Mobile Financial Advice 38/38, Jest 470/470, cùng typecheck/lint/OpenAPI/export gates PASS theo evidence trước. Không chạy lại các gate đó trong phiên này. Web export không phải browser E2E; emulator/device/remote CI vẫn `NOT_RUN`.
- **Preflight lịch sử:** isolated Backend `/healthz` từng trả 200 với `storage=in-memory`, Expo Web render `/login`; warning React/SVG tại `AppIcon.tsx:95` chưa được chứng minh là Financial Advice demo blocker.
- NFA-01–03 evidence được ghi ở các checkpoint trước: HTTP boundary 18/18; reauthentication integration 4/4; launcher/evaluator 23/23. Các kết quả đó không bị tính lại trong bộ 82/82 hiện tại.
- CodeGraph sau thay đổi aggregator: sync `Synced 1 changed files`; focused query tìm thấy `aggregateEvaluationReports` trong `reporting.ts:843`, `writeAggregateReports` tại `reporting.ts:951`, được gọi bởi CLI `.ts` và evaluation tests. Query tổng hợp trả 206 symbols / 6 files do có liên kết loại rộng; không dùng đó làm blast radius sản phẩm. Generated JS hiện có trong WIP không được coi là source of truth; lệnh chuẩn chạy file `.ts` qua `tsx`.
- Không chạy Docker/PostgreSQL/migration hoặc test database. Listener owner trên cổng preview 5000 và Ollama được giữ nguyên; isolated Backend do task quản lý chạy tại loopback 5010 với limiter mới, Expo Web vẫn tại 8082. Restart Backend làm mất phiên đăng nhập in-memory; tab hiện `/login`. Không ghi thông tin đăng nhập/token vào evidence.
- Các kết quả cũ được nêu bên dưới giữ nguyên attribution; không suy ra chúng vừa chạy lại ở NFA-06. Ngưỡng live vẫn chưa được Owner chọn.
- [Offline oracle/evaluator run](financial-advice-run-offline-all-20261003-091522475-74ba1eb8-b20e-422e-8bf3-87a06df5a109.md): 16/16 case hoàn tất, offline gate PASS, provider calls = 0, cả 16 kết quả là `RULE_BASED`. Đây xác minh phép tính/oracle/public response cho fixture; **không phải** điểm chọn của Qwen.
- [Machine-readable offline run](financial-advice-run-offline-all-20261003-091522475-74ba1eb8-b20e-422e-8bf3-87a06df5a109.json): cùng run ID, dữ liệu allowlist đã sanitize.
- [Offline run trước khi sửa validator](financial-advice-run-offline-all-20261003-091250701-fe62a8f1-11d3-4d03-9d16-3fcf018b03a7.md): giữ làm lịch sử lỗi contract `suggestedMonths=0`; run này không được tính là PASS.
- Kiểm chứng cập nhật cùng phiên: Backend targeted Financial Advice 65/65 và `npm run test:assistant` 74/74 PASS (provider spies/fake loopback servers); Mobile Financial Advice/API/validator + shared protected-route regression 36/36; Backend typecheck/build/OpenAPI và Mobile typecheck/lint/OpenAPI/public-env/Maestro-structure PASS. Mobile 36 test gồm ba ca mới cho double-submit, response cũ sau đổi `sessionEpoch`, và 401 muộn không tác động phiên mới. Đây không phải test kết hợp Financial Advice 401 → AuthProvider → protected login route. Các kết quả không chứng minh HTTP Mobile–Backend live, Ollama live, Web demo, emulator hoặc remote CI.

## Báo cáo lịch sử (không dùng làm nghiệm thu hiện tại)

Nội dung báo cáo dataset `2026.10-fa-v1` phía dưới được lưu nguyên trạng. Các claim cũ như Qwen đang online, accuracy 100%, kiểm duyệt chuyên gia hoặc an toàn tuyệt đối chưa được xác minh lại trong remediation này.

# Bằng Chứng Nghiệm Thu Module Tư Vấn Tài Chính AI (Financial Advice Evidence)

**Thời điểm kiểm thử:** 2026-10-03T07:41:42.025Z (Asia/Bangkok: +07:00)
**Dataset Version:** 2026.10-fa-v1
**Mô hình sử dụng:** `qwen3.5:4b` (Ollama local)
**Trạng thái mô hình:** ONLINE (Live Ollama Provider)
**Digest mô hình:** `2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd`
**Thời gian tổng thực thi:** 19178 ms

## 1. Tổng Quan Chỉ Số Thực Nghiệm

| Chỉ số | Kết quả đạt được | Mục tiêu tiêu chuẩn | Trạng thái |
| --- | --- | --- | --- |
| Tổng số ca kiểm thử (Evaluation Cases) | **16/16** | 16/16 | PASS |
| Độ chính xác trạng thái tài chính (Status Match) | **16/16 (100%)** | 100% | PASS |
| Tính hợp lệ phương án ưu tiên (Option Candidate) | **15/16 (100%)** | >= 95% | PASS |
| Chế độ phản hồi AI (AI_ASSISTED) | **13/16** | >= 1 (khi Ollama online) | PASS |
| Chế độ phân tích quy tắc (RULE_BASED) | **3/16** | Fallback tự động khi cần | PASS |
| Độ trễ phản hồi trung bình (Average Latency) | **1198 ms** | < 10.000 ms | PASS |
| Tính nhất quán số liệu (Metrics Invariance) | **100% (Khớp BigInt)** | 100% | PASS |
| An toàn thông tin (Public Safety) | **100% (Không rò rỉ PII/secrets)** | 100% | PASS |

## 2. Bảng Kết Quả Chi Tiết Từng Ca Kiểm Thử (16 Ca)

| Mã ca | Loại | Tên kịch bản | Status thực tế / Kỳ vọng | Phương án ưu tiên | Chế độ | Fallback | Độ trễ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **S-01** | SAVINGS_PLAN | Tiết kiệm thiếu hụt - Ưu tiên linh hoạt | `GAP` / `GAP` | `REDUCE_FLEXIBLE_SPENDING` | `AI_ASSISTED` | `NONE` | 1718 ms |
| **S-02** | SAVINGS_PLAN | Tiết kiệm khả thi | `FEASIBLE` / `FEASIBLE` | `MAINTAIN_PLAN` | `AI_ASSISTED` | `NONE` | 1066 ms |
| **S-03** | SAVINGS_PLAN | Tiết kiệm vừa đủ sát nút | `FEASIBLE` / `FEASIBLE` | `MAINTAIN_PLAN` | `AI_ASSISTED` | `NONE` | 930 ms |
| **S-04** | SAVINGS_PLAN | Mục tiêu đã hoàn thành trước hạn | `ALREADY_FUNDED` / `ALREADY_FUNDED` | `GOAL_ALREADY_FUNDED` | `AI_ASSISTED` | `NONE` | 938 ms |
| **S-05** | SAVINGS_PLAN | Không có khả năng tiết kiệm (C=0) | `NO_CAPACITY` / `NO_CAPACITY` | `REDUCE_FLEXIBLE_SPENDING` | `RULE_BASED` | `PROVIDER_INVALID_OUTPUT` | 1249 ms |
| **S-06** | SAVINGS_PLAN | Ưu tiên mục tiêu (KEEP_TARGET) | `GAP` / `GAP` | `REDUCE_FLEXIBLE_SPENDING` | `AI_ASSISTED` | `NONE` | 1158 ms |
| **S-07** | SAVINGS_PLAN | Ưu tiên giữ mức chi (KEEP_CURRENT_SPENDING) | `GAP` / `GAP` | `EXTEND_DEADLINE` | `RULE_BASED` | `PROVIDER_INVALID_OUTPUT` | 1338 ms |
| **S-08** | SAVINGS_PLAN | Thời gian vượt horizon 120 tháng | `GAP` / `GAP` | `LOWER_GOAL_AMOUNT` | `AI_ASSISTED` | `NONE` | 1438 ms |
| **B-01** | BUDGET_BALANCE | Cân đối ngân sách thiếu hụt | `SURPLUS` / `SURPLUS` | `REDUCE_FLEXIBLE_SPENDING` | `AI_ASSISTED` | `NONE` | 1163 ms |
| **B-02** | BUDGET_BALANCE | Ngân sách đạt mục tiêu | `SURPLUS` / `SURPLUS` | `MAINTAIN_BUDGET` | `AI_ASSISTED` | `NONE` | 1054 ms |
| **B-03** | BUDGET_BALANCE | Ngân sách vừa khít mục tiêu | `SURPLUS` / `SURPLUS` | `MAINTAIN_BUDGET` | `AI_ASSISTED` | `NONE` | 1129 ms |
| **B-04** | BUDGET_BALANCE | Ngân sách cân bằng I=M và Target=0 | `BALANCED` / `BALANCED` | `MAINTAIN_BUDGET` | `AI_ASSISTED` | `NONE` | 1115 ms |
| **B-05** | BUDGET_BALANCE | Ngân sách thâm hụt nghiêm trọng | `DEFICIT` / `DEFICIT` | `REVIEW_BASE_BUDGET` | `AI_ASSISTED` | `NONE` | 1131 ms |
| **B-06** | BUDGET_BALANCE | Cân đối ưu tiên mục tiêu (KEEP_TARGET) | `SURPLUS` / `SURPLUS` | `REDUCE_FLEXIBLE_SPENDING` | `AI_ASSISTED` | `NONE` | 1345 ms |
| **B-07** | BUDGET_BALANCE | Cân đối giữ mức chi (KEEP_CURRENT_SPENDING) | `SURPLUS` / `SURPLUS` | `ADJUST_SAVINGS_TARGET` | `RULE_BASED` | `PROVIDER_INVALID_OUTPUT` | 1176 ms |
| **B-08** | BUDGET_BALANCE | Không đủ chi linh hoạt để cắt giảm | `SURPLUS` / `SURPLUS` | `ADJUST_SAVINGS_TARGET` | `AI_ASSISTED` | `NONE` | 1227 ms |

## 3. Đánh Giá Khả Năng Kiểm Soát & Ranh Giới An Toàn Của AI

- **Toán học xác định tuyệt đối (Deterministic Arithmetic):** Toàn bộ các chỉ số tài chính (khoản còn thiếu, số tiền cần mỗi tháng, khả năng tích lũy sau dự phòng) đều do Backend tính toán bằng `BigInt`. AI không tham gia vào các phép tính số học, loại bỏ hoàn toàn hiện tượng hallucination về tiền bạc.
- **Mô hình bộ chọn có kiểm soát (Constrained Selector Pattern):** AI chỉ chọn `preferredOptionId` và `reasonIds` trong danh sách các phương án hợp lệ được Backend lọc sẵn theo ngữ cảnh. Mọi văn bản giải thích hiển thị trên màn hình Mobile đều được Backend render từ facts & template catalogue đã được kiểm duyệt.
- **Cơ chế Fallback an toàn (Safe Degradation):** Khi Ollama quá tải, timeout, hoặc sinh JSON sai quy tắc, hệ thống chuyển sang chế độ `RULE_BASED` ngay lập tức mà không làm gián đoạn trải nghiệm người dùng.
- **Bảo mật và Giảm thiểu dữ liệu (Data Minimization):** Request chỉ truyền các con số tiền và lựa chọn, không lưu dữ liệu tư vấn xuống ổ đĩa, không can thiệp vào số dư thực tế hay giao dịch của khách hàng.

## 4. Kết Luận Nghiệm Thu

Module AI Tư vấn tài chính cá nhân đáp ứng đầy đủ các tiêu chuẩn của đồ án tốt nghiệp: có kiến trúc phân tầng an toàn, kiểm chứng thực tế với mô hình ngôn ngữ mã nguồn mở local (Qwen 3.5 4B), độ chính xác nghiệp vụ 100%, và giao diện Mobile thân thiện, bảo vệ tối đa lợi ích của người dùng.
