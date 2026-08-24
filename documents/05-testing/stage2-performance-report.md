# Giai đoạn 2 — Performance và transfer integrity smoke

Ngày chạy: 2026-08-24  
Build ID: `stage2-20260824-df1f40b`  
Môi trường: Docker Compose local, PostgreSQL 16.11, database sandbox riêng cho run; không phải cloud staging.

## Bài đo

- Node-native equivalent tại [`performance/node/stage2-smoke.cjs`](../../performance/node/stage2-smoke.cjs), không thêm dependency k6 vào runtime.
- Mỗi run tạo user/phone/email giả lập ngẫu nhiên.
- 20 vòng health + account/history/notification read.
- 20 request transfer đồng thời dùng cùng idempotency key và cùng challenge.
- Không ghi password, OTP, token, account number hoặc transfer ID vào output.
- Threshold giữ nguyên theo kế hoạch: health p95 `<100 ms`, read p95 `<300 ms`, transfer p95 `<700 ms`, lỗi HTTP `0`, canonical transfer `1`, reconciliation `ok`.

## Ba lượt đo

| Run | Health p50/p90/p95/p99 | Read p50/p90/p95/p99 | Transfer p50/p90/p95/p99 | HTTP failures | Canonical transfer | Reconciliation | Kết quả |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| 1 | 31.10 / 33.14 / 38.07 / 41.82 ms | 31.23 / 38.06 / 41.58 / 45.11 ms | 379.38 / 629.07 / 656.37 / 687.14 ms | 0 | 1 | ok | Đạt |
| 2 | 46.28 / 48.33 / 50.83 / 70.65 ms | 46.04 / 50.24 / 62.27 / 169.57 ms | 442.29 / 783.22 / 824.55 / 865.19 ms | 0 | 1 | ok | Threshold transfer fail |
| 3 | 61.32 / 62.89 / 63.96 / 67.96 ms | 62.27 / 67.60 / 68.71 / 74.83 ms | 563.01 / 986.85 / 1,051.23 / 1,116.84 ms | 0 | 1 | ok | Threshold transfer fail |

## Kết luận

- Integrity đạt: 20 request đồng thời tạo đúng một canonical transfer, không double-debit, health sau workload vẫn `ok` và reconciliation không lệch.
- Performance threshold chưa ổn định: lượt đầu đạt, nhưng transfer replay bị serialize cùng persistent state boundary; p95 tăng ở lượt 2/3 khi database disposable tích lũy thêm user/operation. Không hạ threshold để làm xanh bài đo.
- Defect `D2-004` được giữ mở ở mức P2, owner/định hướng tối ưu cần maintainer xác nhận. Hướng xử lý dự kiến: đo riêng first-submit/replay, giảm state read/write trên replay idempotency, hoặc chuyển workload sang relational command path có transaction tối thiểu trước khi chốt SLO.
- Median ba lượt theo p95: health `50.83 ms`, read `62.27 ms`, transfer `824.55 ms`; transfer median vượt ngưỡng sơ bộ. Đây là baseline local, chưa đại diện cloud; cần chạy lại trên staging HTTPS/database riêng sau khi tối ưu.
