import { useState } from "react";
import { adminFetch, idempotencyKey, shortId, type ApiError } from "../../api";
import { DataTable } from "../../components/common/DataTable";
import { Heading } from "../../components/common/Heading";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { Job, OutboxEvent } from "../../types";

interface OperationsProps {
  summary: Record<string, number>;
  jobs: Job[];
  events: OutboxEvent[];
  onReload: () => Promise<void>;
  loading: boolean;
}

export function Operations({
  summary,
  jobs,
  events,
  onReload,
  loading,
}: OperationsProps) {
  const { hasPermission } = useStaff();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const canOperate =
    hasPermission("outbox.requeue.request") || hasPermission("job.retry.request");

  const handleRequeue = async (event: OutboxEvent) => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ action: { id: string } }>(
        `/admin/operations/outbox/events/${event.id}/requeue-requests`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("outbox-requeue") },
          body: JSON.stringify({
            reasonCode: reason.trim() || "INCIDENT_RETRY",
            ticketReference: "ADMIN-OUTBOX",
            description: "Canonical outbox requeue",
          }),
        }
      );
      setSuccessNotice(
        `Đã tạo yêu cầu Requeue cho Outbox event ${shortId(event.id)} (Mã action: ${
          result.action?.id ?? "Mới"
        }). Chờ ADMIN phê duyệt.`
      );
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const handleRetryJob = async (job: Job) => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ action: { id: string } }>(
        `/admin/operations/jobs/${job.id}/retry-requests`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("job-retry") },
          body: JSON.stringify({
            reasonCode: reason.trim() || "INCIDENT_RETRY",
            ticketReference: "ADMIN-JOB",
            description: "Canonical background job retry",
          }),
        }
      );
      setSuccessNotice(
        `Đã tạo yêu cầu Retry cho background job ${shortId(job.id)} (Mã action: ${
          result.action?.id ?? "Mới"
        }). Chờ ADMIN phê duyệt.`
      );
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="operations-page">
      <Heading
        eyebrow="WORKER OPERATIONS"
        title="Outbox và background jobs"
        actions={
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => void onReload()}
          >
            {loading ? "Đang tải…" : "Làm mới dữ liệu"}
          </button>
        }
      />

      <Notice error={error} retry={() => void onReload()} />
      {successNotice ? (
        <Notice type="success" onDismiss={() => setSuccessNotice(null)}>
          {successNotice}
        </Notice>
      ) : null}

      <div className="metric-grid">
        <article className="metric-card">
          <span>Pending</span>
          <strong>{summary.PENDING ?? 0}</strong>
          <small>Đang đợi worker lấy xử lý</small>
        </article>

        <article className="metric-card">
          <span>Processing</span>
          <strong>{summary.PROCESSING ?? 0}</strong>
          <small>Worker đang thực thi</small>
        </article>

        <article className="metric-card">
          <span>Dead</span>
          <strong className={(summary.DEAD ?? 0) > 0 ? "danger-text" : ""}>
            {summary.DEAD ?? 0}
          </strong>
          <small>Lỗi tối đa attempts, cần can thiệp</small>
        </article>

        <article className="metric-card">
          <span>Skipped</span>
          <strong>{summary.SKIPPED ?? 0}</strong>
          <small>Sự kiện đã chủ động bỏ qua</small>
        </article>
      </div>

      <div className="panel stack reason-box">
        <label>
          Reason code cho thao tác retry / requeue
          <input
            data-testid="outbox-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="INCIDENT_RETRY"
            disabled={busy}
          />
        </label>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>Transactional Outbox Events ({events.length})</h2>
        </div>

        {events.length === 0 ? (
          <div className="empty">Không có outbox event trong reference dataset.</div>
        ) : (
          <DataTable>
            {events.map((event) => (
              <tr key={event.id}>
                <th>
                  {event.eventType} · {shortId(event.id)}
                </th>
                <td>
                  <div className="operation-item-details">
                    <StatusBadge status={event.status} />
                    <span className="muted">
                      · Số lần thử: {event.attempts} · Lỗi: {event.lastErrorCode ?? "—"}
                    </span>

                    {canOperate && ["DEAD", "SKIPPED"].includes(event.status) ? (
                      <span className="button-row">
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy || !reason.trim()}
                          onClick={() => void handleRequeue(event)}
                        >
                          Requeue request
                        </button>
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Background Jobs ({jobs.length})</h2>
        </div>

        {jobs.length === 0 ? (
          <div className="empty">Không có background job trong reference dataset.</div>
        ) : (
          <DataTable>
            {jobs.map((job) => (
              <tr key={job.id}>
                <th>
                  {job.jobType} · {shortId(job.id)}
                </th>
                <td>
                  <div className="operation-item-details">
                    <StatusBadge status={job.status} />
                    <span className="muted">
                      · Số lần thử: {job.attempts} · Lỗi: {job.lastErrorCode ?? "—"}
                    </span>

                    {canOperate && ["FAILED", "DEAD"].includes(job.status) ? (
                      <span className="button-row">
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy || !reason.trim()}
                          onClick={() => void handleRetryJob(job)}
                        >
                          Retry job request
                        </button>
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      <div className="notice info">
        Requeue/retry dùng payload canonical ban đầu và tạo yêu cầu chờ ADMIN phê duyệt; Admin Web không thể sửa payload hoặc chạy script trực tiếp trên máy chủ.
      </div>
    </section>
  );
}
