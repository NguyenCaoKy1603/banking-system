import { useState, useMemo } from "react";
import { adminFetch, idempotencyKey, shortId, formatDate, type ApiError } from "../../api";
import { AutoRefreshControl } from "../../components/common/AutoRefreshControl";
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

type ModalType = "REQUEUE" | "RETRY" | "EVENT_DETAIL" | "JOB_DETAIL" | null;
type StatusFilter = "ALL" | "NEED_ATTENTION" | "PENDING_PROCESSING" | "SKIPPED_COMPLETED";
type ViewSection = "ALL" | "OUTBOX" | "JOBS";

export function Operations({
  summary,
  jobs,
  events,
  onReload,
  loading,
}: OperationsProps) {
  const { hasPermission } = useStaff();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Filter & Search states
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewSection, setViewSection] = useState<ViewSection>("ALL");

  // Pagination states
  const [eventsPage, setEventsPage] = useState(1);
  const EVENTS_PAGE_SIZE = 8;
  const [jobsPage, setJobsPage] = useState(1);
  const JOBS_PAGE_SIZE = 8;

  // Modal states
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedEvent, setSelectedEvent] = useState<OutboxEvent | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Form states inside modal
  const [modalReason, setModalReason] = useState("INCIDENT_RETRY");
  const [modalTicket, setModalTicket] = useState("OPS-INCIDENT-01");
  const [modalDescription, setModalDescription] = useState("Khôi phục sự cố vận hành");

  const canOperate =
    hasPermission("outbox.requeue.request") || hasPermission("job.retry.request");

  // Filtered Events
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Status filter
      if (statusFilter === "NEED_ATTENTION" && !["DEAD", "SKIPPED"].includes(event.status)) {
        return false;
      }
      if (statusFilter === "PENDING_PROCESSING" && !["PENDING", "PROCESSING"].includes(event.status)) {
        return false;
      }
      if (statusFilter === "SKIPPED_COMPLETED" && event.status !== "SKIPPED") {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const typeMatch = event.eventType.toLowerCase().includes(q);
        const idMatch = event.id.toLowerCase().includes(q);
        const errMatch = (event.lastErrorCode ?? "").toLowerCase().includes(q);
        const aggMatch = (event.aggregateId ?? "").toLowerCase().includes(q);
        if (!typeMatch && !idMatch && !errMatch && !aggMatch) {
          return false;
        }
      }

      return true;
    });
  }, [events, statusFilter, searchQuery]);

  // Filtered Jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      // Status filter
      if (statusFilter === "NEED_ATTENTION" && !["DEAD", "FAILED"].includes(job.status)) {
        return false;
      }
      if (statusFilter === "PENDING_PROCESSING" && !["PENDING", "RUNNING"].includes(job.status)) {
        return false;
      }
      if (statusFilter === "SKIPPED_COMPLETED" && job.status !== "COMPLETED") {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const typeMatch = job.jobType.toLowerCase().includes(q);
        const idMatch = job.id.toLowerCase().includes(q);
        const errMatch = (job.lastErrorCode ?? "").toLowerCase().includes(q);
        if (!typeMatch && !idMatch && !errMatch) {
          return false;
        }
      }

      return true;
    });
  }, [jobs, statusFilter, searchQuery]);

  const totalEventsPages = Math.max(1, Math.ceil(filteredEvents.length / EVENTS_PAGE_SIZE));
  const safeEventsPage = Math.min(eventsPage, totalEventsPages);
  const pageEvents = filteredEvents.slice(
    (safeEventsPage - 1) * EVENTS_PAGE_SIZE,
    safeEventsPage * EVENTS_PAGE_SIZE
  );

  const totalJobsPages = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PAGE_SIZE));
  const safeJobsPage = Math.min(jobsPage, totalJobsPages);
  const pageJobs = filteredJobs.slice(
    (safeJobsPage - 1) * JOBS_PAGE_SIZE,
    safeJobsPage * JOBS_PAGE_SIZE
  );

  // Open modal handlers
  const openRequeueModal = (event: OutboxEvent) => {
    setSelectedEvent(event);
    setModalReason("INCIDENT_RETRY");
    setModalTicket("OPS-OUTBOX-01");
    setModalDescription(`Yêu cầu Requeue cho Outbox Event ${event.eventType} (${shortId(event.id)})`);
    setActiveModal("REQUEUE");
  };

  const openRetryModal = (job: Job) => {
    setSelectedJob(job);
    setModalReason("INCIDENT_RETRY");
    setModalTicket("OPS-JOB-01");
    setModalDescription(`Yêu cầu Retry cho Background Job ${job.jobType} (${shortId(job.id)})`);
    setActiveModal("RETRY");
  };

  const openEventDetail = (event: OutboxEvent) => {
    setSelectedEvent(event);
    setActiveModal("EVENT_DETAIL");
  };

  const openJobDetail = (job: Job) => {
    setSelectedJob(job);
    setActiveModal("JOB_DETAIL");
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelectedEvent(null);
    setSelectedJob(null);
  };

  // Submit Requeue
  const handleRequeueSubmit = async () => {
    if (!selectedEvent) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ action: { id: string } }>(
        `/admin/operations/outbox/events/${selectedEvent.id}/requeue-requests`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("outbox-requeue") },
          body: JSON.stringify({
            reasonCode: modalReason.trim() || "INCIDENT_RETRY",
            ticketReference: modalTicket.trim() || "ADMIN-OUTBOX",
            description: modalDescription.trim() || "Canonical outbox requeue",
          }),
        }
      );
      setSuccessNotice(
        `Đã tạo yêu cầu Requeue cho Outbox event ${shortId(selectedEvent.id)} (Mã action: ${
          result.action?.id ?? "Mới"
        }). Chờ ADMIN phê duyệt trong Approval Inbox.`
      );
      closeModal();
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  // Submit Retry Job
  const handleRetrySubmit = async () => {
    if (!selectedJob) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ action: { id: string } }>(
        `/admin/operations/jobs/${selectedJob.id}/retry-requests`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("job-retry") },
          body: JSON.stringify({
            reasonCode: modalReason.trim() || "INCIDENT_RETRY",
            ticketReference: modalTicket.trim() || "ADMIN-JOB",
            description: modalDescription.trim() || "Canonical background job retry",
          }),
        }
      );
      setSuccessNotice(
        `Đã tạo yêu cầu Retry cho Background Job ${shortId(selectedJob.id)} (Mã action: ${
          result.action?.id ?? "Mới"
        }). Chờ ADMIN phê duyệt trong Approval Inbox.`
      );
      closeModal();
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const deadCount = summary.DEAD ?? 0;

  return (
    <section className="operations-page">
      <Heading
        eyebrow="WORKER OPERATIONS"
        title="Outbox và background jobs"
        actions={
          <div className="heading-action-group">
            <AutoRefreshControl onRefresh={onReload} disabled={loading || busy} />
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => void onReload()}
            >
              {loading ? "Đang tải…" : "Làm mới dữ liệu"}
            </button>
          </div>
        }
      />

      <Notice error={error} retry={() => void onReload()} />
      {successNotice ? (
        <Notice type="success" onDismiss={() => setSuccessNotice(null)}>
          {successNotice}
        </Notice>
      ) : null}

      {/* Hero Guide Card: Hướng dẫn nghiệp vụ chuyên sâu */}
      <div
        style={{
          background: "var(--color-surface, #fff)",
          border: "1px solid var(--color-border, #e2e8f0)",
          borderRadius: "12px",
          padding: "20px 24px",
          marginBottom: "20px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              background: "var(--color-secondary-bg, #eff6ff)",
              color: "var(--color-primary, #1d4ed8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.5rem",
              flexShrink: 0,
            }}
          >
            ⚙️
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: "0 0 6px 0", fontSize: "1.08rem", color: "var(--color-text-main, #0f172a)" }}>
              Cổng giám sát tác vụ nền & Hàng đợi sự kiện (Transactional Outbox & Worker Dispatcher)
            </h3>
            <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "var(--color-text-muted, #64748b)", lineHeight: 1.6 }}>
              Đây là trung tâm điều hành ngầm của ngân hàng nhằm bảo đảm tính nhất quán giao dịch và gửi tin nhắn an toàn:
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "12px",
                fontSize: "0.82rem",
                color: "var(--color-text-muted, #475569)",
              }}
            >
              <div style={{ background: "var(--color-bg, #f8fafc)", padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--color-border, #e2e8f0)" }}>
                <strong style={{ color: "var(--color-text-main, #1e293b)", display: "block", marginBottom: "3px" }}>
                  📨 Transactional Outbox
                </strong>
                Lưu trữ các thông báo giao dịch (Email/Push) đồng bộ cùng cơ sở dữ liệu. Worker chạy ngầm sẽ quét và gửi tin tự động theo cơ chế Exponential Backoff (tối đa 5 lần).
              </div>
              <div style={{ background: "var(--color-bg, #f8fafc)", padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--color-border, #e2e8f0)" }}>
                <strong style={{ color: "var(--color-text-main, #1e293b)", display: "block", marginBottom: "3px" }}>
                  🛑 Hàng đợi Dead-Letter (DEAD)
                </strong>
                Khi gửi lỗi quá 5 lần (do sập mạng/nhà cung cấp), sự kiện chuyển sang <code>DEAD</code>. Khi sự cố được khắc phục, cán bộ bấm <strong>Requeue</strong> để hệ thống gửi lại.
              </div>
              <div style={{ background: "var(--color-bg, #f8fafc)", padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--color-border, #e2e8f0)" }}>
                <strong style={{ color: "var(--color-text-main, #1e293b)", display: "block", marginBottom: "3px" }}>
                  ⏱️ Background Jobs
                </strong>
                Tác vụ chạy theo lịch định kỳ (quét tất toán sổ tiết kiệm đáo hạn, chốt sao kê quá hạn). Nếu tiến trình gặp sự cố, cán bộ bấm <strong>Retry</strong> để kích hoạt chạy lại.
              </div>
              <div style={{ background: "var(--color-bg, #f8fafc)", padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--color-border, #e2e8f0)" }}>
                <strong style={{ color: "var(--color-text-main, #1e293b)", display: "block", marginBottom: "3px" }}>
                  🛡️ Cơ chế 4 mắt (Maker-Checker)
                </strong>
                Mọi lệnh Requeue hoặc Retry đều tạo một Action Request chuyển vào <strong>Approval Inbox</strong> để Admin phê duyệt trước khi máy chủ thực sự chạy lại.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Thống kê Metric Grid */}
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

        <article
          className="metric-card"
          style={deadCount > 0 ? { borderColor: "var(--color-danger, #ef4444)", background: "#fef2f2" } : {}}
        >
          <span>Dead (Sự cố)</span>
          <strong className={deadCount > 0 ? "danger-text" : ""}>
            {deadCount}
          </strong>
          <small>{deadCount > 0 ? "⚠️ Cần tạo yêu cầu Requeue / Retry" : "Lỗi tối đa attempts, cần can thiệp"}</small>
        </article>

        <article className="metric-card">
          <span>Skipped</span>
          <strong>{summary.SKIPPED ?? 0}</strong>
          <small>Sự kiện đã chủ động bỏ qua</small>
        </article>
      </div>

      {/* Banner thông báo trạng thái vận hành */}
      {deadCount > 0 ? (
        <div
          style={{
            margin: "16px 0",
            padding: "12px 18px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "0.88rem", color: "#991b1b" }}>
            <span style={{ fontSize: "1.2rem" }}>⚠️</span>
            <span>
              <strong>CẢNH BÁO VẬN HÀNH:</strong> Đang có <strong>{deadCount}</strong> sự kiện/tác vụ ở trạng thái <code>DEAD</code> cần xử lý khôi phục.
            </span>
          </div>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: "0.82rem", padding: "4px 12px" }}
            onClick={() => setStatusFilter("NEED_ATTENTION")}
          >
            Lọc ngay các sự kiện lỗi ➔
          </button>
        </div>
      ) : (
        <div
          style={{
            margin: "16px 0",
            padding: "10px 16px",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "0.86rem",
            color: "#166534",
          }}
        >
          <span>✅</span>
          <span>
            <strong>Trạng thái ổn định:</strong> Tất cả các sự kiện Outbox và Background Jobs đang hoạt động bình thường, không có hàng đợi nào bị kẹt ở trạng thái DEAD.
          </span>
        </div>
      )}

      {/* Thanh điều khiển, tìm kiếm và lọc */}
      <div
        style={{
          background: "var(--color-surface, #fff)",
          border: "1px solid var(--color-border, #e2e8f0)",
          borderRadius: "10px",
          padding: "14px 18px",
          marginBottom: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.84rem", fontWeight: 600, color: "var(--color-text-main)" }}>
            Lọc trạng thái:
          </span>
          <button
            type="button"
            className={statusFilter === "ALL" ? "primary" : "secondary"}
            style={{ fontSize: "0.8rem", padding: "4px 12px", borderRadius: "16px" }}
            onClick={() => {
              setStatusFilter("ALL");
              setEventsPage(1);
              setJobsPage(1);
            }}
          >
            Tất cả ({events.length + jobs.length})
          </button>
          <button
            type="button"
            className={statusFilter === "NEED_ATTENTION" ? "primary" : "secondary"}
            style={{ fontSize: "0.8rem", padding: "4px 12px", borderRadius: "16px" }}
            onClick={() => {
              setStatusFilter("NEED_ATTENTION");
              setEventsPage(1);
              setJobsPage(1);
            }}
          >
            ⚠️ Cần can thiệp (DEAD / FAILED)
          </button>
          <button
            type="button"
            className={statusFilter === "PENDING_PROCESSING" ? "primary" : "secondary"}
            style={{ fontSize: "0.8rem", padding: "4px 12px", borderRadius: "16px" }}
            onClick={() => {
              setStatusFilter("PENDING_PROCESSING");
              setEventsPage(1);
              setJobsPage(1);
            }}
          >
            ⏳ Đang chờ & Chạy
          </button>
          <button
            type="button"
            className={statusFilter === "SKIPPED_COMPLETED" ? "primary" : "secondary"}
            style={{ fontSize: "0.8rem", padding: "4px 12px", borderRadius: "16px" }}
            onClick={() => {
              setStatusFilter("SKIPPED_COMPLETED");
              setEventsPage(1);
              setJobsPage(1);
            }}
          >
            Bỏ qua (SKIPPED)
          </button>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flex: 1, minWidth: "260px", maxWidth: "450px" }}>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setEventsPage(1);
              setJobsPage(1);
            }}
            placeholder="Tìm theo loại sự kiện, Job, mã ID, mã lỗi…"
            style={{ flex: 1, padding: "6px 12px", fontSize: "0.84rem", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          />
          <select
            value={viewSection}
            onChange={(e) => setViewSection(e.target.value as ViewSection)}
            style={{ padding: "6px 10px", fontSize: "0.84rem", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          >
            <option value="ALL">Xem cả hai mục</option>
            <option value="OUTBOX">Chỉ Outbox Events</option>
            <option value="JOBS">Chỉ Background Jobs</option>
          </select>
        </div>
      </div>

      {/* Panel 1: Transactional Outbox Events */}
      {(viewSection === "ALL" || viewSection === "OUTBOX") && (
        <section className="panel" style={{ marginBottom: "20px" }}>
          <div className="panel-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
                📨 Transactional Outbox Events ({filteredEvents.length} / {events.length})
              </h2>
              <small style={{ color: "var(--color-text-muted)" }}>
                Hàng đợi phân phối thông báo giao dịch (Email/Push) tới khách hàng
              </small>
            </div>
            {canOperate && (
              <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                Bấm <strong>Requeue</strong> để gửi lại sự kiện bị lỗi DEAD
              </span>
            )}
          </div>

          {filteredEvents.length === 0 ? (
            <div className="empty" style={{ padding: "30px", textAlign: "center" }}>
              {events.length === 0
                ? "Không có sự kiện outbox nào trong hệ thống."
                : "Không tìm thấy sự kiện outbox nào khớp với bộ lọc hiện tại."}
            </div>
          ) : (
            <>
              <DataTable>
                {pageEvents.map((event) => {
                  const isDead = event.status === "DEAD";
                  const canRequeue = canOperate && ["DEAD", "SKIPPED"].includes(event.status);

                  return (
                    <tr key={event.id} style={isDead ? { background: "#fff5f5" } : {}}>
                      <th style={{ width: "280px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span style={{ fontWeight: 600, color: "var(--color-text-main)", fontSize: "0.9rem" }}>
                            {event.eventType}
                          </span>
                          <span style={{ fontSize: "0.76rem", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>
                            ID: {shortId(event.id, 14)}
                          </span>
                        </div>
                      </th>
                      <td>
                        <div className="operation-item-details" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                            <StatusBadge status={event.status} />
                            <span style={{ fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
                              Lần thử: <strong>{event.attempts}</strong>/5
                            </span>
                            {event.lastErrorCode ? (
                              <span style={{ fontSize: "0.8rem", color: "#dc2626", background: "#fee2e2", padding: "2px 6px", borderRadius: "4px" }}>
                                Lỗi: <code>{event.lastErrorCode}</code>
                              </span>
                            ) : null}
                            <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                              · {formatDate(event.occurredAt)}
                            </span>
                          </div>

                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <button
                              type="button"
                              className="ghost"
                              style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                              onClick={() => openEventDetail(event)}
                            >
                              🔍 Chi tiết
                            </button>

                            {canRequeue ? (
                              <button
                                className="secondary"
                                type="button"
                                disabled={busy}
                                style={{ padding: "4px 12px", fontSize: "0.8rem", fontWeight: 600, color: "var(--color-primary)" }}
                                onClick={() => openRequeueModal(event)}
                              >
                                🔄 Requeue request
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>

              {totalEventsPages > 1 ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
                  <div>
                    Hiển thị {(safeEventsPage - 1) * EVENTS_PAGE_SIZE + 1} - {Math.min(safeEventsPage * EVENTS_PAGE_SIZE, filteredEvents.length)} trong tổng số {filteredEvents.length} sự kiện
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                      disabled={safeEventsPage <= 1}
                      onClick={() => setEventsPage((p) => Math.max(1, p - 1))}
                    >
                      « Trước
                    </button>
                    <span style={{ fontWeight: 600 }}>{safeEventsPage} / {totalEventsPages}</span>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                      disabled={safeEventsPage >= totalEventsPages}
                      onClick={() => setEventsPage((p) => Math.min(totalEventsPages, p + 1))}
                    >
                      Sau »
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      {/* Panel 2: Background Jobs */}
      {(viewSection === "ALL" || viewSection === "JOBS") && (
        <section className="panel" style={{ marginBottom: "20px" }}>
          <div className="panel-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
                ⏱️ Background Jobs ({filteredJobs.length} / {jobs.length})
              </h2>
              <small style={{ color: "var(--color-text-muted)" }}>
                Các tiến trình chạy ngầm theo chu kỳ (tất toán tiết kiệm, chốt sao kê quá hạn, tính lãi)
              </small>
            </div>
            {canOperate && (
              <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                Bấm <strong>Retry</strong> để tái thực thi job bị lỗi FAILED/DEAD
              </span>
            )}
          </div>

          {filteredJobs.length === 0 ? (
            <div className="empty" style={{ padding: "30px", textAlign: "center" }}>
              {jobs.length === 0
                ? "Không có background job nào trong hệ thống."
                : "Không tìm thấy job nào khớp với bộ lọc hiện tại."}
            </div>
          ) : (
            <>
              <DataTable>
                {pageJobs.map((job) => {
                  const isFailedOrDead = ["FAILED", "DEAD"].includes(job.status);
                  const canRetry = canOperate && isFailedOrDead;

                  return (
                    <tr key={job.id} style={isFailedOrDead ? { background: "#fff5f5" } : {}}>
                      <th style={{ width: "280px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span style={{ fontWeight: 600, color: "var(--color-text-main)", fontSize: "0.9rem" }}>
                            {job.jobType}
                          </span>
                          <span style={{ fontSize: "0.76rem", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>
                            ID: {shortId(job.id, 14)}
                          </span>
                        </div>
                      </th>
                      <td>
                        <div className="operation-item-details" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                            <StatusBadge status={job.status} />
                            <span style={{ fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
                              Lần thử: <strong>{job.attempts}</strong>
                            </span>
                            {job.lastErrorCode ? (
                              <span style={{ fontSize: "0.8rem", color: "#dc2626", background: "#fee2e2", padding: "2px 6px", borderRadius: "4px" }}>
                                Lỗi: <code>{job.lastErrorCode}</code>
                              </span>
                            ) : null}
                            <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                              · Tạo: {formatDate(job.createdAt)}
                            </span>
                          </div>

                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <button
                              type="button"
                              className="ghost"
                              style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                              onClick={() => openJobDetail(job)}
                            >
                              🔍 Chi tiết
                            </button>

                            {canRetry ? (
                              <button
                                className="secondary"
                                type="button"
                                disabled={busy}
                                style={{ padding: "4px 12px", fontSize: "0.8rem", fontWeight: 600, color: "var(--color-primary)" }}
                                onClick={() => openRetryModal(job)}
                              >
                                🔄 Retry job request
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>

              {totalJobsPages > 1 ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
                  <div>
                    Hiển thị {(safeJobsPage - 1) * JOBS_PAGE_SIZE + 1} - {Math.min(safeJobsPage * JOBS_PAGE_SIZE, filteredJobs.length)} trong tổng số {filteredJobs.length} jobs
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                      disabled={safeJobsPage <= 1}
                      onClick={() => setJobsPage((p) => Math.max(1, p - 1))}
                    >
                      « Trước
                    </button>
                    <span style={{ fontWeight: 600 }}>{safeJobsPage} / {totalJobsPages}</span>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                      disabled={safeJobsPage >= totalJobsPages}
                      onClick={() => setJobsPage((p) => Math.min(totalJobsPages, p + 1))}
                    >
                      Sau »
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      {/* Thông báo chính sách bảo mật vận hành */}
      <div className="notice info" style={{ marginTop: "16px" }}>
        <strong>🔒 Nguyên tắc Maker-Checker trong quản trị tác vụ:</strong> Mọi thao tác Requeue/Retry đều dùng payload gốc bất biến (canonical payload) đã được ghi nhận trong cơ sở dữ liệu. Thao tác trên Admin Web chỉ tạo yêu cầu phê duyệt gửi sang Approval Inbox; không cho phép sửa đổi payload, thay đổi số dư hoặc chạy lệnh trực tiếp trên máy chủ.
      </div>

      {/* MODAL 1: Requeue Outbox Event */}
      {activeModal === "REQUEUE" && selectedEvent && (
        <div className="modal-backdrop">
          <div className="modal stack" style={{ maxWidth: "560px" }}>
            <div className="panel-heading">
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Tạo yêu cầu Requeue Outbox Event</h2>
                <small style={{ color: "var(--color-text-muted)" }}>
                  Đưa sự kiện thông báo trở lại hàng đợi để hệ thống gửi lại
                </small>
              </div>
              <button type="button" className="ghost" onClick={closeModal} disabled={busy}>
                ✕
              </button>
            </div>

            <div style={{ background: "var(--color-bg, #f8fafc)", padding: "12px 16px", borderRadius: "8px", fontSize: "0.85rem" }}>
              <div style={{ marginBottom: "6px" }}>
                <strong>Sự kiện:</strong> <code>{selectedEvent.eventType}</code>
              </div>
              <div style={{ marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
                <strong>Mã ID:</strong> {selectedEvent.id}
              </div>
              <div style={{ marginBottom: "6px" }}>
                <strong>Trạng thái:</strong> <StatusBadge status={selectedEvent.status} /> · Số lần đã thử: <strong>{selectedEvent.attempts}</strong>/5
              </div>
              {selectedEvent.lastErrorCode && (
                <div>
                  <strong>Mã lỗi ghi nhận:</strong> <code style={{ color: "#dc2626" }}>{selectedEvent.lastErrorCode}</code>
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleRequeueSubmit();
              }}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <label>
                Mã lý do (Reason code) *
                <input
                  data-testid="outbox-reason"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="INCIDENT_RETRY"
                  required
                  disabled={busy}
                />
              </label>

              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>Mã gợi ý:</span>
                {["INCIDENT_RETRY", "NETWORK_RESTORED", "PROVIDER_RECOVERED"].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="secondary"
                    style={{ padding: "2px 8px", fontSize: "0.72rem", borderRadius: "12px" }}
                    onClick={() => setModalReason(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>


              <label>
                Mô tả chi tiết
                <textarea
                  value={modalDescription}
                  onChange={(e) => setModalDescription(e.target.value)}
                  placeholder="Mô tả nguyên nhân và giải pháp khắc phục"
                  rows={2}
                  disabled={busy}
                />
              </label>

              <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px" }}>
                💡 Yêu cầu này sẽ được gửi vào <strong>Approval Inbox</strong> để cán bộ quản lý phê duyệt trước khi Worker thực sự gửi lại tin nhắn.
              </div>

              <div className="button-row" style={{ marginTop: "8px" }}>
                <button type="button" className="secondary" onClick={closeModal} disabled={busy}>
                  Hủy bỏ
                </button>
                <button type="submit" className="primary" disabled={busy || !modalReason.trim()}>
                  {busy ? "Đang gửi yêu cầu…" : "Xác nhận gửi yêu cầu Requeue"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Retry Background Job */}
      {activeModal === "RETRY" && selectedJob && (
        <div className="modal-backdrop">
          <div className="modal stack" style={{ maxWidth: "560px" }}>
            <div className="panel-heading">
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Tạo yêu cầu Retry Background Job</h2>
                <small style={{ color: "var(--color-text-muted)" }}>
                  Tái kích hoạt thực thi tác vụ chạy ngầm bị lỗi FAILED hoặc DEAD
                </small>
              </div>
              <button type="button" className="ghost" onClick={closeModal} disabled={busy}>
                ✕
              </button>
            </div>

            <div style={{ background: "var(--color-bg, #f8fafc)", padding: "12px 16px", borderRadius: "8px", fontSize: "0.85rem" }}>
              <div style={{ marginBottom: "6px" }}>
                <strong>Loại tác vụ:</strong> <code>{selectedJob.jobType}</code>
              </div>
              <div style={{ marginBottom: "6px", fontFamily: "var(--font-mono)" }}>
                <strong>Mã ID:</strong> {selectedJob.id}
              </div>
              <div style={{ marginBottom: "6px" }}>
                <strong>Trạng thái:</strong> <StatusBadge status={selectedJob.status} /> · Số lần đã thử: <strong>{selectedJob.attempts}</strong>
              </div>
              {selectedJob.lastErrorCode && (
                <div>
                  <strong>Mã lỗi ghi nhận:</strong> <code style={{ color: "#dc2626" }}>{selectedJob.lastErrorCode}</code>
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleRetrySubmit();
              }}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <label>
                Mã lý do (Reason code) *
                <input
                  data-testid="outbox-reason"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="INCIDENT_RETRY"
                  required
                  disabled={busy}
                />
              </label>

              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>Mã gợi ý:</span>
                {["INCIDENT_RETRY", "DATABASE_RESTORED", "SCHEDULER_RESUME"].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="secondary"
                    style={{ padding: "2px 8px", fontSize: "0.72rem", borderRadius: "12px" }}
                    onClick={() => setModalReason(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>


              <label>
                Mô tả chi tiết
                <textarea
                  value={modalDescription}
                  onChange={(e) => setModalDescription(e.target.value)}
                  placeholder="Mô tả nguyên nhân và giải pháp khắc phục"
                  rows={2}
                  disabled={busy}
                />
              </label>

              <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", background: "#f8fafc", padding: "8px 12px", borderRadius: "6px" }}>
                💡 Yêu cầu này sẽ được gửi vào <strong>Approval Inbox</strong> để cán bộ quản lý phê duyệt trước khi Worker thực sự chạy lại tác vụ này.
              </div>

              <div className="button-row" style={{ marginTop: "8px" }}>
                <button type="button" className="secondary" onClick={closeModal} disabled={busy}>
                  Hủy bỏ
                </button>
                <button type="submit" className="primary" disabled={busy || !modalReason.trim()}>
                  {busy ? "Đang gửi yêu cầu…" : "Xác nhận gửi yêu cầu Retry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Chi tiết Outbox Event */}
      {activeModal === "EVENT_DETAIL" && selectedEvent && (
        <div className="modal-backdrop">
          <div className="modal stack" style={{ maxWidth: "620px" }}>
            <div className="panel-heading">
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Chi tiết Transactional Outbox Event</h2>
                <small style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                  ID: {selectedEvent.id}
                </small>
              </div>
              <button type="button" className="ghost" onClick={closeModal}>
                ✕
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "0.85rem" }}>
              <div>
                <strong>Loại sự kiện (Event Type):</strong>
                <p style={{ margin: "2px 0 8px", fontWeight: 600 }}>{selectedEvent.eventType}</p>
              </div>
              <div>
                <strong>Trạng thái:</strong>
                <div style={{ marginTop: "2px" }}>
                  <StatusBadge status={selectedEvent.status} />
                </div>
              </div>
              <div>
                <strong>Số lần thử (Attempts):</strong>
                <p style={{ margin: "2px 0 8px" }}>{selectedEvent.attempts} / 5</p>
              </div>
              <div>
                <strong>Thời gian ghi nhận:</strong>
                <p style={{ margin: "2px 0 8px" }}>{formatDate(selectedEvent.occurredAt)}</p>
              </div>
              <div>
                <strong>Mã Aggregate ID:</strong>
                <p style={{ margin: "2px 0 8px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                  {selectedEvent.aggregateId || "—"}
                </p>
              </div>
              <div>
                <strong>Mã lỗi gần nhất:</strong>
                <p style={{ margin: "2px 0 8px" }}>
                  {selectedEvent.lastErrorCode ? (
                    <code style={{ color: "#dc2626", background: "#fee2e2", padding: "2px 6px", borderRadius: "4px" }}>
                      {selectedEvent.lastErrorCode}
                    </code>
                  ) : (
                    "—"
                  )}
                </p>
              </div>
            </div>

            {selectedEvent.payload && Object.keys(selectedEvent.payload).length > 0 ? (
              <div>
                <strong style={{ fontSize: "0.85rem", display: "block", marginBottom: "4px" }}>
                  Dữ liệu gói tin (Payload):
                </strong>
                <pre
                  style={{
                    background: "var(--color-bg, #f8fafc)",
                    border: "1px solid var(--color-border, #e2e8f0)",
                    borderRadius: "6px",
                    padding: "10px 12px",
                    fontSize: "0.78rem",
                    maxHeight: "180px",
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(selectedEvent.payload, null, 2)}
                </pre>
              </div>
            ) : null}

            <div className="button-row" style={{ marginTop: "10px" }}>
              <button type="button" className="secondary" onClick={closeModal}>
                Đóng
              </button>
              {canOperate && ["DEAD", "SKIPPED"].includes(selectedEvent.status) ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    openRequeueModal(selectedEvent);
                  }}
                >
                  🔄 Tạo yêu cầu Requeue
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Chi tiết Background Job */}
      {activeModal === "JOB_DETAIL" && selectedJob && (
        <div className="modal-backdrop">
          <div className="modal stack" style={{ maxWidth: "620px" }}>
            <div className="panel-heading">
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Chi tiết Background Job</h2>
                <small style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                  ID: {selectedJob.id}
                </small>
              </div>
              <button type="button" className="ghost" onClick={closeModal}>
                ✕
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "0.85rem" }}>
              <div>
                <strong>Loại tác vụ (Job Type):</strong>
                <p style={{ margin: "2px 0 8px", fontWeight: 600 }}>{selectedJob.jobType}</p>
              </div>
              <div>
                <strong>Trạng thái:</strong>
                <div style={{ marginTop: "2px" }}>
                  <StatusBadge status={selectedJob.status} />
                </div>
              </div>
              <div>
                <strong>Số lần thử (Attempts):</strong>
                <p style={{ margin: "2px 0 8px" }}>{selectedJob.attempts}</p>
              </div>
              <div>
                <strong>Thời gian tạo:</strong>
                <p style={{ margin: "2px 0 8px" }}>{formatDate(selectedJob.createdAt)}</p>
              </div>
              <div>
                <strong>Thời gian cập nhật:</strong>
                <p style={{ margin: "2px 0 8px" }}>{formatDate(selectedJob.updatedAt)}</p>
              </div>
              <div>
                <strong>Mã lỗi gần nhất:</strong>
                <p style={{ margin: "2px 0 8px" }}>
                  {selectedJob.lastErrorCode ? (
                    <code style={{ color: "#dc2626", background: "#fee2e2", padding: "2px 6px", borderRadius: "4px" }}>
                      {selectedJob.lastErrorCode}
                    </code>
                  ) : (
                    "—"
                  )}
                </p>
              </div>
            </div>

            <div className="button-row" style={{ marginTop: "10px" }}>
              <button type="button" className="secondary" onClick={closeModal}>
                Đóng
              </button>
              {canOperate && ["FAILED", "DEAD"].includes(selectedJob.status) ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    openRetryModal(selectedJob);
                  }}
                >
                  🔄 Tạo yêu cầu Retry
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
