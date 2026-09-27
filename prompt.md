# Nhiệm vụ: Hoàn thiện cô lập phiên và bằng chứng kiểm thử Admin Web

Workspace: C:\Projects\banking-system.
Chế độ khi thực thi prompt này: sửa code có giới hạn, chạy kiểm thử local và cập nhật tài liệu.
Ưu tiên: P1 cho cô lập phiên; P2 cho sửa kiểm thử và độ chính xác của báo cáo.
Quyền Git: không git add, commit, push, merge, rebase, reset, restore, clean hoặc tag.

## 1. Mục tiêu và giới hạn

Hoàn thành ba việc còn thiếu sau lượt rà soát mới nhất:

1. Ngăn callback của request thuộc phiên đã kết thúc ghi lại hoặc xóa state của phiên mới, kể cả đăng nhập lại cùng staffId.
2. Sửa R-07 để thực sự giữ request của khách hàng A, cho B hoàn thành trước, rồi kiểm tra A không ghi đè B; bao gồm cả mở mới và tải lại tài khoản.
3. Bổ sung kiểm thử giao diện cho response JSON hợp lệ nhưng thiếu action ID, rồi cập nhật báo cáo đúng bằng chứng đã chạy.

Đây là đợt hoàn thiện nhỏ phù hợp đồ án tốt nghiệp. Giữ các sửa đang hoạt động: review trước khi gửi, snapshot/key ổn định, timeout hữu hạn, kiểm tra action ID, giữ INDETERMINATE khi retry gặp xung đột, quyền theo action và reject qua MFA.

Không làm lại AW-01–06 hoặc toàn bộ FIX-01–05. Không thêm nghiệp vụ, dashboard, framework state, hàng đợi offline, lưu intent xuống đĩa, phục hồi cold restart, cơ chế đa tab trình duyệt hay tích hợp production.

Triển khai lần lượt các bước bên dưới, không dừng ở việc lập lại kế hoạch. Tự quyết định chi tiết thông thường trong phạm vi. Nếu cần mở rộng backend/contract/chính sách, ghi blocker và tiếp tục phần độc lập; không tự mở rộng quyền.

## 2. Kiểm tra hiện trạng trước khi sửa

- Đọc AGENTS.md, PROJECT_CONTEXT.md, hướng dẫn trong phạm vi, admin-web/README.md và documents/admin/{admin-web-improvement-plan.md,admin-web-improvement-report.md,manual-test.md}.
- Kiểm tra HEAD, git status, git diff và file untracked. Snapshot rà soát gần nhất: 9254922a9bfe486f1b0b833d80c5fd2e508bcc3b cùng WIP; không checkout về snapshot này.
- Nếu có .codegraph/, dùng CodeGraph trước khi tìm/đọc code. Xác minh lại các đầu mối dưới đây; số dòng và implementation có thể đã thay đổi.
- Bảo toàn WIP ngoài task. Với file Admin đang untracked/modified, sửa tiếp có chủ đích; phân biệt thay đổi có sẵn và thay đổi của phiên này.

Đầu mối đã thấy trong lượt rà soát:

- R-07 trong admin-web/e2e/admin-web.spec.ts chỉ delay URL có chuỗi cust-e2e-synthetic, nhưng e2e/fixture-server.mjs dùng randomUUID() cho customer ID. Nhánh delay có thể không chạy dù test PASS.
- StaffContext.tsx đã clearSessionPendingIntents khi logout/refresh thất bại. Tuy nhiên catch của submitAccountAction/submitCustomerAction vẫn có thể ghi intent sau thời điểm clear.
- Store nhận currentStaffId nhưng chưa có cơ chế vô hiệu hóa callback theo vòng đời phiên. getSessionPendingIntents/subscription và banner còn đọc toàn bộ map.
- R-06 có timeout và JSON không parse được; chưa có nhánh E2E trả {} để kiểm tra validator action ID trên giao diện thật.

Lập bảng ngắn: vấn đề được xác nhận → nguyên nhân → file sửa → bằng chứng dự kiến. Không lặp lại các kết luận cũ đã được sửa như thể vẫn còn lỗi.

## 3. Phạm vi được phép

Được sửa:

- admin-web/src/features/customers/actionIntent.ts và Customers.tsx.
- admin-web/src/context/StaffContext.tsx; một helper quản lý phiên nhỏ nếu thực sự cần.
- admin-web/src/api.ts hoặc App.tsx chỉ khi cần nối vòng đời phiên, giữ diff tối thiểu.
- admin-web/test/admin-web.ui-logic.test.cjs, e2e/admin-web.spec.ts và fixture/config liên quan trực tiếp.
- admin-web/README.md, documents/admin/manual-test.md, admin-web-improvement-report.md; cập nhật kế hoạch Admin nếu cần phản ánh tiến độ.

Không sửa backend source/test, database/migration, OpenAPI, policy RBAC, Mobile, core, CI, Docker/Nginx, infrastructure hoặc file môi trường chứa bí mật. Không thêm dependency cho đợt này.

Được chạy các kiểm tra local nêu trong mục 7. Dùng fixture in-memory hiện có, cổng riêng; kiểm tra cổng trước và chỉ dừng tiến trình do phiên này tạo. Nếu fixture cần backend dist, kiểm tra prerequisites; chỉ build backend hiện có khi không đụng WIP và không sửa backend source. Nếu không thể, báo blocker.

Không restart stack demo, seed/reset database, gửi email, bật worker, deploy hay kết nối dịch vụ thật. Không đưa password, OTP, token, cookie, CSRF hoặc raw auth response vào báo cáo/log/ảnh/trace. Dữ liệu thử nghiệm phải synthetic; không công bố credential dù là fixture.

## 4. Bước S-01 — Cô lập phiên cho mọi cập nhật bất đồng bộ

### Giải pháp

Dùng một định danh vòng đời phiên nhỏ trong bộ nhớ, ví dụ session generation/epoch kết hợp staffId. Đây không phải token xác thực. Ưu tiên tích hợp vào owner phiên hiện có, không dựng kiến trúc mới.

- Khi phiên được thiết lập, có session scope hiện hành. Đăng nhập lại cùng nhân viên sau logout phải là scope mới.
- Khi bắt đầu logout hoặc kết thúc/đổi phiên, vô hiệu hóa scope cũ và dọn intent ngay. Không chờ request logout trả về mới ngăn callback cũ.
- Các đường refresh/login/logout phải nhất quán. Refresh thành công cùng phiên không tự ý mất intent. Kết quả auth đến muộn cũng không được khôi phục phiên đã bị vô hiệu hóa.
- Không thực hiện side effect dọn store trong functional updater của setState. Tổ chức chuyển phiên rõ ràng, an toàn khi React StrictMode chạy lại effect/updater.
- Trước khi gửi command, chụp session scope, intent ID, target, method/path, snapshot và key. Retry cùng intent giữ snapshot/key như hiện tại.
- Sau mỗi await, chỉ cập nhật UI, store, success/error, gọi reload/onRefresh nếu scope còn hiện hành và operation vẫn là operation được phép cập nhật.
- Bảo vệ cả nhánh thành công, lỗi và finally. Response thành công muộn không được xóa intent mới; response lỗi muộn không được thêm intent cũ.
- Kiểm tra scope ngay trong API ghi/xóa store để caller cũ không thể vượt guard chỉ bằng cách truyền staffId cũ. Khi xóa theo target, xác nhận đúng intent ID nếu cần để không xóa intent thay thế.
- Đọc map, subscription và banner chỉ cung cấp intent thuộc scope đang hoạt động. Thiếu/sai scope phải từ chối an toàn, không fallback sang toàn bộ map.
- Abort có thể dùng để dừng chờ, nhưng không thay thế scope guard và không được coi là rollback server. Không tự replay request hoặc tạo key mới khi đổi phiên.

Không vô hiệu hóa phiên chỉ vì chuyển tab chức năng hoặc đóng modal: các intent chưa xác định vẫn cần giữ được trong cùng phiên. Tránh dùng mounted flag làm lý do bỏ mất intent hợp lệ khi Customers unmount do chuyển tab. Store thuộc owner phiên có thể tiếp nhận kết quả hợp lệ của cùng phiên; state của component đã unmount thì không cần cập nhật.

### Bằng chứng bắt buộc

Unit test phải import helper sản phẩm mà UI thực sự dùng:

- Callback phiên A sau invalidation không thể set/delete store.
- Callback thành công cũ không xóa intent của phiên B trên cùng target.
- Login lại cùng staffId có scope mới và không nhận intent cũ.
- Reader/subscriber của B không nhận thông tin của A.
- Chuyển tab cùng phiên vẫn giữ/retry đúng snapshot/key.

Thêm E2E tương tác thật, không chỉ gọi clear helper trong test:

1. Nhân viên A gửi command; giữ response tại network boundary và xác nhận request đã vào nhánh giữ.
2. Thực hiện logout qua UI rồi đăng nhập B trong cùng browser context để giữ cùng bộ nhớ ứng dụng; không page.reload/new context để vô tình xóa module store.
3. Giải phóng request cũ thành lỗi mạng/response hỏng, hoặc chờ deadline có kiểm soát. Đợi handler cũ hoàn tất, không chỉ nhìn banner ngay sau login.
4. B không thấy banner/payload/key/thành công/lỗi của A; mở target không khôi phục intent A; không có POST tự phát sinh.
5. Bao phủ cả kết quả cũ thành công và thất bại bằng test phù hợp; bảo vệ cả Account và Customer access actions. Dùng bảng ca/helper test để tránh sao chép dài.
6. Có ca logout rồi login lại A để bắt lỗi chỉ so staffId. Nếu chỉ một phần được chứng minh bằng unit, phân biệt rõ với phần đã chạy E2E trong báo cáo.

## 5. Bước S-02 — Sửa R-07 để điều khiển đúng request

Giữ fixture dùng UUID hiện có. Lấy ID A/B từ response khách hàng thực tế, xác định bằng dữ liệu synthetic ổn định. Assert A và B tồn tại, khác ID, có account khác nhau. Không hardcode chuỗi không có trong URL hoặc dùng first request tùy thời điểm.

Mỗi nhánh phải có hai tín hiệu rõ ràng: request A đã bị giữ và cho phép A tiếp tục. So khớp chính xác method + path chứa ID A đã thu được.

Nhánh 1 — mở mới:

1. Cài route giữ GET accounts của A; mở A.
2. Await tín hiệu đã chặn đúng request A trước khi mở B.
3. Đợi B hoàn tất, xác nhận tên khách hàng/tài khoản/số dư synthetic đúng.
4. Giải phóng A, đợi sự kiện xử lý/abort tương ứng rồi xác nhận B không bị thay dữ liệu, loading hoặc lỗi.
5. Mở thao tác trên B, kiểm tra đúng account ID B trong hành vi/đích request phù hợp; không chỉ nhìn một nhãn trùng nhau.

Nhánh 2 — tải lại:

1. Mở A và đợi hoàn tất trước khi cài route giữ lượt reload tiếp theo của A.
2. Bấm Tải lại danh sách; await xác nhận reload A đã bị giữ.
3. Chọn B và đợi B hoàn tất; sau đó giải phóng reload A và kiểm tra tương tự.

Không dùng waitForTimeout(150) làm bằng chứng response cũ đã hoàn tất. Dùng deferred gate và sự kiện/assertion có thời hạn rõ ràng. Dọn route, giải phóng gate trong finally để test thất bại không treo suite.

Nếu client abort A trước khi response được giao, ghi đúng đó là bằng chứng hủy request và giữ UI. Giữ/bổ sung unit test AccountLoadManager với fetcher cố ý bỏ qua AbortSignal và hoàn tất A sau B để chứng minh generation guard độc lập với abort. Unit test phải chạy class sản phẩm, không chép logic vào test.

Assertion bắt buộc phải chạy: nếu không bắt đúng request A thì test FAIL, không bỏ qua bằng if/catch rỗng. Không thêm test hook vào production chỉ để làm test PASS.

## 6. Bước S-03 — Response thiếu action ID và hồi quy

Mở rộng R-06 hoặc thêm test có tên rõ ràng, giữ các ca timeout và JSON hỏng đã có:

- POST trả 2xx với JSON hợp lệ {}.
- POST trả action.id rỗng hoặc thiếu, ví dụ {"action":{}}.
- UI thoát busy, hiện INDETERMINATE/INVALID_RESPONSE, giữ modal, snapshot và key; không hiển thị thành công, không xóa intent, không tự replay.
- Khi người dùng retry với response hợp lệ: path/body/key khớp lần đầu và kết thúc bằng action ID hợp lệ.
- Bao phủ cả Account và Customer access handler bằng test thích hợp; báo rõ phạm vi từng tầng.

Mock ở network boundary, không thay component/state machine/validator bằng implementation trong test. Theo dõi số POST để phát hiện replay. Response giả chỉ chứng minh xử lý UI; không mô tả là server đã commit.

Giữ hồi quy R-01–R-10 và P0 đang có. Với assertion liên quan trực tiếp đến task, bỏ kiểu kiểm tra điều kiện có thể âm thầm bỏ qua bằng chứng bắt buộc. Ví dụ committedActionId cần được assert hợp lệ trước khi so sánh; nếu mô tả MFA mới thì test phải buộc/đợi bước MFA, còn tái sử dụng step-up còn hiệu lực phải ghi đúng.

## 7. Kiểm tra và cập nhật báo cáo

Task thực thi này yêu cầu chạy kiểm thử. Đọc scripts/config trước khi chạy, xác minh fixture độc lập và không thu thập auth secrets trong trace/video/screenshot.

- admin-web: npm run typecheck, npm run lint, npm test, npm run build, npm run test:e2e, npm run audit.
- backend: các validator hiện có npm run validate:admin-authz và npm run validate:admin-openapi nếu prerequisites khả dụng, không sửa policy để làm PASS.
- Chạy riêng test mục tiêu khi cần chẩn đoán rồi chạy toàn bộ suite Admin để kiểm tra hồi quy.
- Nếu lint và typecheck cùng là tsc --noEmit, nói rõ cùng cơ chế, không coi là hai loại bằng chứng độc lập.
- Ghi chính xác audit dùng --omit=dev hay phạm vi nào; không suy ra toàn bộ dependencies sạch từ scan hẹp.
- Không hạ threshold, xóa test, thêm skip hoặc đổi expected sai để làm PASS. Không npm audit fix --force.
- Nếu lệnh bị chặn bởi môi trường hoặc baseline, ghi BLOCKED/FAIL và nguyên nhân; không dùng kết quả lịch sử để thay kết quả mới.

Cập nhật tài liệu theo source và output thực tế: số test từng nhóm, tình huống đã chạy, thời điểm, HEAD + mô tả WIP liên quan, giới hạn fixture. Không mặc định giữ số 17/17 hoặc 11/11 sau khi thêm test; không viết trước thời gian chạy/PASS.

Hướng dẫn demo phải có đủ prerequisites fixture, đúng port và proxy. Không mô tả npm run dev riêng lẻ là đã khởi động fixture. OPERATIONS không tự mở Approval Inbox nếu không có audit.read; hướng dẫn phối hợp checker hoặc retry đúng snapshot theo quyền hiện có. Không mở rộng quyền.

## 8. Điều kiện hoàn thành

| Mã | Điều kiện nghiệm thu |
| --- | --- |
| AC-01 | Phiên cũ không thể thêm/xóa/cập nhật intent hoặc UI của phiên mới sau logout/đổi phiên, bao gồm cùng staffId đăng nhập lại; có bằng chứng callback muộn. |
| AC-02 | Banner, reader, subscriber chỉ thấy scope hiện hành; chuyển tab trong cùng phiên vẫn phục hồi intent đúng. |
| AC-03 | R-07 bắt đúng ID A, xác nhận gate đã vào ở cả open/reload; B hoàn tất trước khi A được giải phóng; unit chứng minh guard khi fetcher bỏ qua abort. |
| AC-04 | Response {} và thiếu/rỗng action ID không gây thành công giả hoặc replay; retry giữ snapshot/key, kiểm tra cả hai handler ở tầng phù hợp. |
| AC-05 | Hồi quy và gate liên quan đã chạy, kết quả/bằng chứng khớp báo cáo; không còn tuyên bố vượt test thực tế. |

Chỉ đánh dấu DONE khi các tiêu chí bắt buộc đạt. Có phần chưa chạy hoặc FAIL thì dùng IN_PROGRESS/BLOCKED theo thực tế, chỉ rõ phần còn thiếu. Bằng chứng local in-memory không thay PostgreSQL/staging; không tuyên bố production readiness.

## 9. Bàn giao bằng tiếng Việt

Báo cáo ngắn, có thể kiểm tra lại:

1. Trạng thái S-01/S-02/S-03 và AC-01–AC-05.
2. File tạo/sửa của phiên, tách khỏi WIP có sẵn.
3. Luồng request → session scope/intent → state → UI → error/retry; điểm chặn callback muộn.
4. Bảng ca kiểm thử: hành vi, file/test, assertion chính, kết quả, tầng bằng chứng và giới hạn.
5. Lệnh thực chạy và kết quả; dependency/config/API có thay đổi không.
6. Cách demo thủ công ngắn, giới hạn/rủi ro còn lại.
7. Điểm sinh viên cần giải thích: staffId khác session generation thế nào; clear store một lần vì sao chưa đủ; abort khác generation guard; JSON hợp lệ khác response nghiệp vụ hợp lệ.

Dừng sau khi hoàn thiện phạm vi này. Không đề xuất thêm kiến trúc/tính năng chỉ để mở rộng đồ án.
