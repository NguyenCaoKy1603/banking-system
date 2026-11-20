import { useState, useMemo, type FormEvent } from "react";
import { adminFetch, formatDate, idempotencyKey, shortId, type ApiError } from "../../api";
import { AutoRefreshControl } from "../../components/common/AutoRefreshControl";
import { Heading } from "../../components/common/Heading";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { AuditEvent } from "../../types";

interface AuditViewProps {
  items: AuditEvent[];
  onReload: () => Promise<void>;
  loading: boolean;
}

type TabType = "ALL" | "STAFF" | "CUSTOMER" | "SYSTEM";
type OutcomeFilter = "ALL" | "SUCCEEDED" | "DENIED" | "FAILED";

const ACTION_TRANSLATIONS: Record<string, { label: string; icon: string }> = {
  // Khách hàng Mobile App
  REFRESH_ROTATED: { label: "Làm mới phiên Mobile App (Refresh Token)", icon: "🔄" },
  SESSION_CREATED: { label: "Đăng nhập Mobile App thành công", icon: "📱" },
  SESSION_DESTROYED: { label: "Đăng xuất Mobile App", icon: "🚪" },
  TRANSFER_SUBMITTED: { label: "Khởi tạo lệnh chuyển tiền", icon: "💸" },
  TRANSFER_EXECUTED: { label: "Chuyển tiền Core Banking thành công", icon: "✅" },
  KYC_SUBMITTED: { label: "Nộp hồ sơ định danh", icon: "📝" },
  CREDIT_APPLICATION_SUBMITTED: { label: "Nộp hồ sơ mở thẻ tín dụng", icon: "💳" },
  BENEFICIARY_RESOLVED: { label: "Tra cứu thông tin người thụ hưởng", icon: "🔍" },

  // Nhân viên Web Admin
  CUSTOMER_SEARCH_READ: { label: "Tra cứu danh sách khách hàng (PII)", icon: "👥" },
  CUSTOMER_READ_MASKED: { label: "Xem chi tiết thông tin khách hàng", icon: "👤" },
  CUSTOMER_ACCOUNTS_READ: { label: "Xem danh sách tài khoản khách hàng", icon: "💳" },
  ACCOUNT_READ: { label: "Xem thông tin số dư tài khoản", icon: "🏦" },
  ACCOUNT_TRANSACTIONS_READ: { label: "Xem sao kê giao dịch tài khoản", icon: "📜" },
  ACCOUNT_BLOCK: { label: "Khóa tài khoản thanh toán", icon: "🔒" },
  ACCOUNT_UNBLOCK: { label: "Mở khóa tài khoản thanh toán", icon: "🔓" },
  CUSTOMER_ACCESS_LOCK: { label: "Khóa đăng nhập khách hàng", icon: "🚫" },
  CUSTOMER_ACCESS_UNLOCK: { label: "Mở khóa đăng nhập khách hàng", icon: "✅" },
  SIMULATION_FUNDING: { label: "Nạp tiền vào tài khoản", icon: "💵" },
  SIMULATION_FUNDING_REVERSAL: { label: "Thu hồi tiền nạp tài khoản", icon: "↩️" },
  TRANSFER_QUEUE_READ: { label: "Xem danh sách giao dịch chuyển tiền", icon: "📋" },
  TRANSFER_DETAIL_READ: { label: "Xem chi tiết giao dịch chuyển tiền", icon: "🔍" },
  TRANSFER_TIMELINE_READ: { label: "Xem tiến trình lịch sử giao dịch", icon: "⏱️" },
  TRANSFER_OPERATION: { label: "Xử lý giao dịch (Hoàn tiền / Thử lại)", icon: "⚡" },
  APPLICATION_QUEUE_READ: { label: "Xem hàng đợi hồ sơ thẩm định", icon: "📂" },
  KYC_APPLICATION_READ: { label: "Mở hồ sơ định danh để thẩm định", icon: "📄" },
  KYC_CASE_CLAIMED: { label: "Nhân viên tiếp nhận hồ sơ định danh", icon: "📌" },
  KYC_DECISION: { label: "Quyết định phê duyệt định danh", icon: "⚖️" },
  CREDIT_APPLICATION_READ: { label: "Mở hồ sơ thẻ tín dụng thẩm định", icon: "📄" },
  CREDIT_CASE_CLAIMED: { label: "Nhân viên tiếp nhận hồ sơ tín dụng", icon: "📌" },
  CREDIT_DECISION: { label: "Quyết định hạn mức tín dụng", icon: "⚖️" },
  STAFF_ROLE_CHANGE: { label: "Thay đổi phân quyền vai trò nhân viên", icon: "🛡️" },
  STAFF_DISABLE: { label: "Vô hiệu hóa tài khoản nhân viên", icon: "🚫" },
  OUTBOX_SUMMARY_READ: { label: "Kiểm tra tiến trình Outbox ngầm", icon: "📊" },
  OUTBOX_EVENTS_READ: { label: "Xem hàng đợi sự kiện Outbox", icon: "📨" },
  OUTBOX_EVENT_READ: { label: "Xem chi tiết sự kiện Outbox", icon: "🔍" },
  OUTBOX_DEAD_LETTERS_READ: { label: "Xem sự kiện Outbox lỗi (Dead Letter)", icon: "⚠️" },
  OUTBOX_REQUEUE: { label: "Đưa sự kiện Outbox vào hàng đợi lại", icon: "🔁" },
  JOBS_READ: { label: "Xem danh sách Job ngầm", icon: "⚙️" },
  JOB_READ: { label: "Xem chi tiết Job ngầm", icon: "🔍" },
  JOB_RETRY: { label: "Kích hoạt chạy lại Job thất bại", icon: "🔄" },
  AUDIT_READ: { label: "Xem nhật ký kiểm toán hệ thống", icon: "🛡️" },
  AUDIT_DETAIL_READ: { label: "Xem chi tiết bản ghi kiểm toán", icon: "🔎" },
  AUDIT_EXPORT_REQUESTED: { label: "Yêu cầu xuất tệp dữ liệu kiểm toán", icon: "📥" },
  ADMIN_PERMISSION_DENIED: { label: "Truy cập bị từ chối do thiếu quyền", icon: "⛔" },
  LOCAL_ADMIN_PASSWORD_RECOVERY: { label: "Khôi phục mật khẩu Admin cục bộ", icon: "🔑" },
  LOCAL_FIXTURE_CLEANUP: { label: "Dọn dẹp fixture môi trường cục bộ", icon: "🧹" },
  MFA_BIOMETRIC_ENROLLED: { label: "Kích hoạt xác thực Sinh trắc học trên thiết bị", icon: "🛡️" },
  TRANSACTION_ANOMALY_DETECTED: { label: "Phát hiện cảnh báo giao dịch bất thường", icon: "🚨" },
  TRANSACTION_ANOMALY_ACKNOWLEDGED: { label: "Khách hàng phản hồi cảnh báo bất thường", icon: "📌" },
  ADMIN_ANOMALY_RESOLVED: { label: "Quản trị viên xử lý cảnh báo bất thường", icon: "✅" },
};

function formatAction(action: string): { label: string; icon: string } {
  if (ACTION_TRANSLATIONS[action]) {
    return ACTION_TRANSLATIONS[action];
  }
  const clean = action.replace(/_/g, " ").toLowerCase();
  const title = clean.charAt(0).toUpperCase() + clean.slice(1);
  return { label: title, icon: "⚡" };
}

export function AuditView({ items, onReload, loading }: AuditViewProps) {
  const { canReadApprovals, hasPermission } = useStaff();
  const canExport = hasPermission("audit.export");

  const [activeTab, setActiveTab] = useState<TabType>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("ALL");
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 15;

  const [exportOpen, setExportOpen] = useState(false);
  const [exportReason, setExportReason] = useState("COMPLIANCE_AUDIT_2026");
  const [exportFormat, setExportFormat] = useState<"CSV" | "JSON">("CSV");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<ApiError | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Thống kê nhanh số lượng
  const stats = useMemo(() => {
    let staff = 0;
    let customer = 0;
    let system = 0;
    for (const item of items) {
      if (item.actorType === "STAFF") staff++;
      else if (item.actorType === "CUSTOMER") customer++;
      else if (item.actorType === "SYSTEM") system++;
    }
    return {
      all: items.length,
      staff,
      customer,
      system,
    };
  }, [items]);

  // Bộ lọc dữ liệu theo Tab, Search, Outcome
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Lọc theo Tab đối tượng
      if (activeTab === "STAFF" && item.actorType !== "STAFF") return false;
      if (activeTab === "CUSTOMER" && item.actorType !== "CUSTOMER") return false;
      if (activeTab === "SYSTEM" && item.actorType !== "SYSTEM") return false;

      // Lọc theo Kết quả
      if (outcomeFilter !== "ALL" && item.outcome !== outcomeFilter) return false;

      // Tìm kiếm theo từ khóa
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const actorName = (item.actorName ?? "").toLowerCase();
        const actorEmail = (item.actorEmail ?? "").toLowerCase();
        const actorCode = (item.actorEmployeeCode ?? "").toLowerCase();
        const action = item.action.toLowerCase();
        const targetType = (item.targetType ?? "").toLowerCase();
        const targetId = (item.targetId ?? "").toLowerCase();
        const reason = (item.reasonCode ?? "").toLowerCase();
        const id = item.id.toLowerCase();
        const actionTrans = (ACTION_TRANSLATIONS[item.action]?.label ?? "").toLowerCase();

        const match =
          actorName.includes(q) ||
          actorEmail.includes(q) ||
          actorCode.includes(q) ||
          action.includes(q) ||
          actionTrans.includes(q) ||
          targetType.includes(q) ||
          targetId.includes(q) ||
          reason.includes(q) ||
          id.includes(q);

        if (!match) return false;
      }

      return true;
    });
  }, [items, activeTab, outcomeFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleExport = async (event: FormEvent) => {
    event.preventDefault();
    if (!exportReason.trim()) return;
    setExportBusy(true);
    setExportError(null);
    try {
      await adminFetch("/admin/audit-export-requests", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey("audit-export") },
        body: JSON.stringify({ reasonCode: exportReason.trim() }),
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `audit_report_${activeTab.toLowerCase()}_${timestamp}.${exportFormat.toLowerCase()}`;
      let blob: Blob;

      const exportSource = filteredItems;

      if (exportFormat === "JSON") {
        const cleanItems = exportSource.map((item) => ({
          id: item.id,
          actorType: item.actorType,
          actorName: item.actorName,
          actorEmail: item.actorEmail,
          actorEmployeeCode: item.actorEmployeeCode,
          action: item.action,
          actionDescription: ACTION_TRANSLATIONS[item.action]?.label ?? item.action,
          targetType: item.targetType,
          targetId: item.targetId,
          outcome: item.outcome,
          reasonCode: item.reasonCode,
          occurredAt: item.occurredAt,
          metadata: item.metadata,
        }));
        blob = new Blob([JSON.stringify(cleanItems, null, 2)], {
          type: "application/json;charset=utf-8",
        });
      } else {
        const header = "ID,Actor Type,Actor Name,Actor Email,Action,Action Description,Target Type,Target ID,Outcome,Reason Code,Occurred At\n";
        const rows = exportSource
          .map((i) =>
            [
              `"${i.id}"`,
              `"${i.actorType ?? ""}"`,
              `"${i.actorName ?? ""}"`,
              `"${i.actorEmail ?? ""}"`,
              `"${i.action}"`,
              `"${ACTION_TRANSLATIONS[i.action]?.label ?? i.action}"`,
              `"${i.targetType ?? ""}"`,
              `"${i.targetId ?? ""}"`,
              `"${i.outcome}"`,
              `"${i.reasonCode ?? ""}"`,
              `"${i.occurredAt}"`,
            ].join(",")
          )
          .join("\n");
        blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportSuccess(`Đã xuất ${exportSource.length} bản ghi kiểm toán thành công ra tệp ${filename}.`);
      setExportOpen(false);
      void onReload();
    } catch (caught) {
      setExportError(caught as ApiError);
    } finally {
      setExportBusy(false);
    }
  };

  if (!canReadApprovals) {
    return (
      <section className="audit-page">
        <Heading eyebrow="IMMUTABLE EVIDENCE" title="Audit Explorer" />
        <div className="notice info">
          Audit Explorer chỉ dành cho nhân sự có quyền tra cứu kiểm toán (<code>audit.read</code>).
        </div>
      </section>
    );
  }

  return (
    <section className="audit-page">
      <Heading
        eyebrow="IMMUTABLE AUDIT LOG — APPEND ONLY"
        title="Nhật ký kiểm toán (Audit Explorer)"
        actions={
          <div className="heading-action-group">
            <AutoRefreshControl onRefresh={onReload} disabled={loading || exportBusy} />
            {canExport ? (
              <button
                type="button"
                className="primary"
                data-testid="export-audit"
                onClick={() => {
                  setExportOpen(true);
                  setExportError(null);
                }}
              >
                Xuất báo cáo
              </button>
            ) : null}
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => void onReload()}
            >
              {loading ? "Đang tải…" : "Làm mới nhật ký"}
            </button>
          </div>
        }
      />

      {exportSuccess ? (
        <Notice type="success" onDismiss={() => setExportSuccess(null)}>
          {exportSuccess}
        </Notice>
      ) : null}

      {/* 4 Thẻ thống kê tương tác theo nhóm */}
      <div className="audit-stats-grid">
        <div
          className={`audit-stat-card ${activeTab === "ALL" ? "active" : ""}`}
          onClick={() => setActiveTab("ALL")}
        >
          <div className="stat-label">
            <span>🌐</span> Tất cả sự kiện
          </div>
          <div className="stat-value">{stats.all}</div>
        </div>

        <div
          className={`audit-stat-card ${activeTab === "STAFF" ? "active" : ""}`}
          onClick={() => setActiveTab("STAFF")}
        >
          <div className="stat-label">
            <span>👤</span> Nhân sự Web Admin
          </div>
          <div className="stat-value">{stats.staff}</div>
        </div>

        <div
          className={`audit-stat-card ${activeTab === "CUSTOMER" ? "active" : ""}`}
          onClick={() => setActiveTab("CUSTOMER")}
        >
          <div className="stat-label">
            <span>📱</span> Khách hàng Mobile App
          </div>
          <div className="stat-value">{stats.customer}</div>
        </div>

        <div
          className={`audit-stat-card ${activeTab === "SYSTEM" ? "active" : ""}`}
          onClick={() => setActiveTab("SYSTEM")}
        >
          <div className="stat-label">
            <span>⚙️</span> Hệ thống ngầm
          </div>
          <div className="stat-value">{stats.system}</div>
        </div>
      </div>

      {/* Thanh công cụ: Tabs phân loại + Ô tìm kiếm + Bộ lọc Outcome */}
      <div className="audit-toolbar">
        <div className="audit-tabs">
          <button
            type="button"
            className={`audit-tab-btn ${activeTab === "ALL" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("ALL");
              setCurrentPage(1);
            }}
          >
            Tất cả <span className="audit-tab-badge">{stats.all}</span>
          </button>
          <button
            type="button"
            className={`audit-tab-btn ${activeTab === "STAFF" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("STAFF");
              setCurrentPage(1);
            }}
          >
            👤 Nhân sự (STAFF) <span className="audit-tab-badge">{stats.staff}</span>
          </button>
          <button
            type="button"
            className={`audit-tab-btn ${activeTab === "CUSTOMER" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("CUSTOMER");
              setCurrentPage(1);
            }}
          >
            📱 Khách hàng (CUSTOMER) <span className="audit-tab-badge">{stats.customer}</span>
          </button>
          <button
            type="button"
            className={`audit-tab-btn ${activeTab === "SYSTEM" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("SYSTEM");
              setCurrentPage(1);
            }}
          >
            ⚙️ Hệ thống (SYSTEM) <span className="audit-tab-badge">{stats.system}</span>
          </button>
        </div>

        <div className="audit-search-filter">
          <input
            type="text"
            className="audit-search-input"
            placeholder="Tìm theo tên người thực hiện, email, hành động, ID…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
          />
          <select
            value={outcomeFilter}
            onChange={(e) => {
              setOutcomeFilter(e.target.value as OutcomeFilter);
              setCurrentPage(1);
            }}
            style={{ width: "160px", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--color-border)" }}
          >
            <option value="ALL">Kết quả: Tất cả</option>
            <option value="SUCCEEDED">Thành công (SUCCEEDED)</option>
            <option value="DENIED">Bị từ chối (DENIED)</option>
            <option value="FAILED">Thất bại (FAILED)</option>
          </select>
        </div>
      </div>

      {/* Bảng nhật ký */}
      {filteredItems.length === 0 ? (
        <div className="empty">
          {items.length === 0
            ? "Chưa có bản ghi kiểm toán nào trong hệ thống."
            : "Không tìm thấy sự kiện kiểm toán nào phù hợp với điều kiện tìm kiếm."}
        </div>
      ) : (
        <div className="audit-table-wrapper">
          <table className="audit-table">
            <thead>
              <tr>
                <th style={{ width: "160px" }}>Thời gian</th>
                <th style={{ width: "230px" }}>Người thực hiện (Actor)</th>
                <th>Hành động</th>
                <th style={{ width: "180px" }}>Đối tượng tác động</th>
                <th style={{ width: "120px" }}>Kết quả</th>
                <th style={{ width: "80px", textAlign: "center" }}>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item) => {
                const actionInfo = formatAction(item.action);
                const actorTypeClass = (item.actorType ?? "STAFF").toLowerCase();
                const actorTypeLabel =
                  item.actorType === "CUSTOMER"
                    ? "Khách hàng Mobile"
                    : item.actorType === "SYSTEM"
                    ? "Hệ thống"
                    : "Nhân sự Web";

                return (
                  <tr key={item.id}>
                    <td className="audit-time-cell">
                      {formatDate(item.occurredAt)}
                    </td>
                    <td>
                      <div className="audit-actor-cell">
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                          <span className={`audit-actor-badge ${actorTypeClass}`}>
                            {actorTypeLabel}
                          </span>
                          {item.actorEmployeeCode ? (
                            <span style={{ fontSize: "0.72rem", color: "var(--color-primary)", fontWeight: 600 }}>
                              {item.actorEmployeeCode}
                            </span>
                          ) : null}
                        </div>
                        <div className="audit-actor-name">
                          {item.actorName ||
                            (item.actorType === "SYSTEM"
                              ? "Tiến trình tự động"
                              : shortId(item.actorStaffId || item.actorCustomerId))}
                        </div>
                        {item.actorEmail ? (
                          <div className="audit-actor-sub">{item.actorEmail}</div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="audit-action-cell">
                        <div className="audit-action-title">
                          <span style={{ marginRight: "6px" }}>{actionInfo.icon}</span>
                          {actionInfo.label}
                        </div>
                        <div className="audit-action-code">{item.action}</div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: "0.82rem" }}>
                        <span style={{ fontWeight: 600, color: "var(--color-text-main)" }}>
                          {item.targetType ?? "Hệ thống"}
                        </span>
                        {item.targetId ? (
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                            ID: {shortId(item.targetId, 12)}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <StatusBadge status={item.outcome} />
                        {item.reasonCode && item.reasonCode !== "ADMIN_READ" && item.reasonCode !== "MASKED_READ" ? (
                          <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                            {item.reasonCode}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className="audit-detail-btn"
                        onClick={() => setSelectedEvent(item)}
                      >
                        Xem
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", fontSize: "0.84rem", color: "var(--color-text-muted)" }}>
              <div>
                Hiển thị {(safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, filteredItems.length)} trong tổng số {filteredItems.length} sự kiện kiểm toán
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  « Trang trước
                </button>
                <span style={{ fontWeight: 600, color: "var(--color-text-main)", padding: "0 4px" }}>
                  {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  Trang sau »
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "right", fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "8px" }}>
              Tổng cộng: {filteredItems.length} sự kiện kiểm toán
            </div>
          )}
        </div>
      )}

      <div className="notice info">
        <strong>🔒 Nguyên tắc kiểm toán bất biến (Append-Only):</strong> Bảng <code>audit_events</code> trong PostgreSQL được bảo vệ bởi database trigger <code>reject_audit_mutation()</code>, cấm tuyệt đối mọi hành vi UPDATE/DELETE. Mọi thao tác từ tra cứu PII, duyệt hồ sơ cho đến xuất báo cáo đều sinh một bản ghi kiểm toán mới.
      </div>

      {/* Modal xem chi tiết sự kiện */}
      {selectedEvent ? (
        <div className="modal-backdrop">
          <div className="modal stack" style={{ maxWidth: "650px" }}>
            <div className="panel-heading">
              <div>
                <h2 style={{ margin: 0 }}>Chi tiết bản ghi kiểm toán</h2>
                <small style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                  ID: {selectedEvent.id}
                </small>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setSelectedEvent(null)}
              >
                Đóng
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "0.85rem" }}>
              <div>
                <strong>Thời gian ghi nhận:</strong>
                <p style={{ margin: "2px 0 8px", fontFamily: "var(--font-mono)" }}>
                  {formatDate(selectedEvent.occurredAt)} ({selectedEvent.occurredAt})
                </p>
              </div>
              <div>
                <strong>Kết quả:</strong>
                <div style={{ marginTop: "4px" }}>
                  <StatusBadge status={selectedEvent.outcome} />
                  {selectedEvent.reasonCode ? (
                    <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                      ({selectedEvent.reasonCode})
                    </span>
                  ) : null}
                </div>
              </div>
              <div>
                <strong>Người thực hiện:</strong>
                <p style={{ margin: "2px 0 8px" }}>
                  <span className={`audit-actor-badge ${(selectedEvent.actorType ?? "STAFF").toLowerCase()}`} style={{ marginRight: "6px" }}>
                    {selectedEvent.actorType ?? "STAFF"}
                  </span>
                  {selectedEvent.actorName || "—"}
                  {selectedEvent.actorEmail ? ` (${selectedEvent.actorEmail})` : ""}
                </p>
              </div>
              <div>
                <strong>Đối tượng tác động:</strong>
                <p style={{ margin: "2px 0 8px", fontFamily: "var(--font-mono)" }}>
                  {selectedEvent.targetType ?? "SYSTEM"} : {selectedEvent.targetId ?? "—"}
                </p>
              </div>
            </div>

            <div>
              <strong>Hành động:</strong>
              <p style={{ margin: "4px 0 10px" }}>
                <span style={{ fontWeight: 600 }}>{formatAction(selectedEvent.action).label}</span>
                <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)", fontSize: "0.8rem" }}>
                  [{selectedEvent.action}]
                </span>
              </p>
            </div>

            {selectedEvent.metadata && Object.keys(selectedEvent.metadata).length > 0 ? (
              <div>
                <strong style={{ display: "block", marginBottom: "6px" }}>Metadata kỹ thuật (Đã lọc bí mật):</strong>
                <div className="audit-code-box">
                  {JSON.stringify(selectedEvent.metadata, null, 2)}
                </div>
              </div>
            ) : (
              <p className="muted" style={{ fontStyle: "italic" }}>Không có metadata bổ sung cho sự kiện này.</p>
            )}

            <div className="button-row" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setSelectedEvent(null)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal xuất báo cáo */}
      {exportOpen ? (
        <div className="modal-backdrop">
          <form className="modal stack" onSubmit={(e) => void handleExport(e)}>
            <div className="panel-heading">
              <h2>Yêu cầu xuất báo cáo kiểm toán</h2>
              <button
                type="button"
                className="ghost"
                disabled={exportBusy}
                onClick={() => setExportOpen(false)}
              >
                Đóng
              </button>
            </div>

            <Notice error={exportError} />

            <p className="muted">
              Lệnh xuất báo cáo sẽ được ghi vào nhật ký kiểm toán với hành động <code>AUDIT_EXPORT_REQUESTED</code>. Tệp dữ liệu chứa <strong>{filteredItems.length}</strong> bản ghi thuộc nhóm <strong>{activeTab}</strong> đã lọc sạch bí mật và token.
            </p>

            <label>
              Lý do xuất báo cáo (Reason code)
              <input
                data-testid="export-reason"
                value={exportReason}
                onChange={(e) => setExportReason(e.target.value)}
                placeholder="COMPLIANCE_AUDIT_2026"
                required
                disabled={exportBusy}
              />
            </label>

            <label>
              Định dạng tệp xuất
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as "CSV" | "JSON")}
                disabled={exportBusy}
              >
                <option value="CSV">CSV (Bảng tính Excel / Thống kê)</option>
                <option value="JSON">JSON (Đầy đủ cấu trúc metadata kỹ thuật)</option>
              </select>
            </label>

            <div className="button-row" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                type="button"
                className="secondary"
                disabled={exportBusy}
                onClick={() => setExportOpen(false)}
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className="primary"
                disabled={exportBusy || !exportReason.trim()}
              >
                {exportBusy ? "Đang xuất…" : `Xác nhận & Tải tệp ${exportFormat}`}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
