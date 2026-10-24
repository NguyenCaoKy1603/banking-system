import { useState } from "react";
import { adminFetch, formatDate, idempotencyKey, shortId, type ApiError } from "../../api";
import { AutoRefreshControl } from "../../components/common/AutoRefreshControl";
import { Heading } from "../../components/common/Heading";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { Action } from "../../types";
import {
  canStaffApproveAction,
  getRequiredApprovalPermission,
  resolveDecisionEndpointAndBody,
} from "./approvalsLogic";

interface ApprovalsProps {
  actions: Action[];
  onReload: () => Promise<void>;
  loading: boolean;
}

const ACTION_TYPE_INFO: Record<string, { label: string; icon: string; category: string }> = {
  STAFF_DISABLE: { label: "Vô hiệu hóa tài khoản nhân sự", icon: "👤🚫", category: "Nhân sự" },
  STAFF_ROLE_CHANGE: { label: "Thay đổi phân quyền nhân sự", icon: "🔑", category: "Nhân sự" },
  STAFF_INVITE: { label: "Tạo tài khoản nhân sự mới", icon: "➕👤", category: "Nhân sự" },
  TRANSFER_OPERATION: { label: "Xử lý giao dịch chuyển tiền (Hoàn tiền / Hủy)", icon: "💸", category: "Giao dịch" },
  KYC_DECISION: { label: "Phê duyệt định danh khách hàng", icon: "🪪", category: "Khách hàng" },
  CREDIT_DECISION: { label: "Phê duyệt hạn mức thẻ tín dụng", icon: "💳", category: "Tín dụng" },
  ACCOUNT_BLOCK: { label: "Khóa tài khoản thanh toán", icon: "🔒", category: "Tài khoản" },
  ACCOUNT_UNBLOCK: { label: "Mở khóa tài khoản thanh toán", icon: "🔓", category: "Tài khoản" },
  CUSTOMER_ACCESS_LOCK: { label: "Khóa quyền truy cập khách hàng", icon: "🚫", category: "Khách hàng" },
  CUSTOMER_ACCESS_UNLOCK: { label: "Mở khóa truy cập khách hàng", icon: "✅", category: "Khách hàng" },
  SIMULATION_FUNDING: { label: "Nạp tiền vào tài khoản", icon: "💰", category: "Vận hành" },
  SIMULATION_FUNDING_REVERSAL: { label: "Thu hồi tiền nạp tài khoản", icon: "🔄", category: "Vận hành" },
  OUTBOX_REQUEUE: { label: "Đẩy lại sự kiện Outbox", icon: "📤", category: "Hệ thống" },
  JOB_RETRY: { label: "Chạy lại tiến trình nền (Job Retry)", icon: "⚙️", category: "Hệ thống" },
};

export function Approvals({ actions, onReload, loading }: ApprovalsProps) {
  const { staff, canReadApprovals, stepUpFreshUntil, setStepUpFreshUntil, hasPermission } = useStaff();
  const [selected, setSelected] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpCode, setStepUpCode] = useState("");
  const [pendingDecision, setPendingDecision] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  if (!canReadApprovals) {
    return (
      <section className="approvals-page">
        <Heading eyebrow="APPROVALS" title="Approval Inbox" />
        <div className="notice info">
          Approval Inbox dành cho Admin. Nhân viên Operations có thể gửi yêu cầu để Admin xử lý.
        </div>
      </section>
    );
  }

  const handleSelect = (action: Action) => {
    setSelected(action);
    setReason("ADMIN_REVIEW_APPROVED");
    setStepUpCode("");
    setStepUpOpen(false);
    setPendingDecision(null);
    setModalError(null);
    setCopyNotice(false);
  };

  const handleClose = () => {
    if (busy) return;
    setSelected(null);
    setReason("");
    setStepUpCode("");
    setStepUpOpen(false);
    setPendingDecision(null);
    setModalError(null);
    setCopyNotice(false);
  };

  const reloadSelectedAction = async () => {
    if (!selected) return;
    setBusy(true);
    setModalError(null);
    try {
      const result = await adminFetch<{ action: Action }>(`/admin/approvals/${selected.id}`);
      setSelected(result.action);
    } catch (caught) {
      setModalError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const executeDecision = async (decision: "APPROVED" | "REJECTED") => {
    if (!selected || !reason.trim()) return;

    // Check step-up freshness
    const fresh = Date.now() < stepUpFreshUntil;
    if (!fresh && !stepUpCode.trim()) {
      setPendingDecision(decision); // PRESERVE THE REQUESTED DECISION!
      setStepUpOpen(true);
      return;
    }

    const decisionToExecute = pendingDecision || decision;

    setBusy(true);
    setModalError(null);

    try {
      // Step-up verification if needed
      if (!fresh) {
        await adminFetch("/admin/auth/step-up", {
          method: "POST",
          body: JSON.stringify({ code: stepUpCode.trim() }),
        });
        setStepUpFreshUntil(Date.now() + 5 * 60 * 1000);
      }

      const { path, body } = resolveDecisionEndpointAndBody(selected, decisionToExecute, reason);
      const actionKey = decisionToExecute === "APPROVED" ? "admin-approve" : "admin-reject";
      await adminFetch(path, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey(actionKey) },
        body: JSON.stringify(body),
      });

      // Success: Close modal and reset fields
      const approvedActionId = selected.id;
      setSelected(null);
      setReason("");
      setStepUpCode("");
      setStepUpOpen(false);
      setPendingDecision(null);
      setSuccessNotice(
        `Đã ${decisionToExecute === "APPROVED" ? "phê duyệt" : "từ chối"} yêu cầu #${approvedActionId.slice(0, 8)} thành công.`
      );

      // Reload list
      try {
        await onReload();
      } catch {
        /* Reload list failed, user can reload manually */
      }
    } catch (caught) {
      setModalError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const canDecideAction = selected ? canStaffApproveAction(selected.actionType, hasPermission) : false;
  const isSelfMaker = Boolean(selected && staff?.id && selected.requesterStaffId === staff.id);
  const selectedInfo = selected ? ACTION_TYPE_INFO[selected.actionType] || { label: selected.actionType, icon: "⚡", category: "Nghiệp vụ" } : null;

  const filteredActions = actions.filter((action) => {
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const type = action.actionType.toLowerCase();
      const label = (action.targetLabel || "").toLowerCase();
      const id = action.id.toLowerCase();
      const reqName = (action.requesterName || "").toLowerCase();
      const reqCode = (action.requesterEmployeeCode || "").toLowerCase();
      const infoLabel = (ACTION_TYPE_INFO[action.actionType]?.label || "").toLowerCase();
      return (
        type.includes(q) ||
        label.includes(q) ||
        id.includes(q) ||
        reqName.includes(q) ||
        reqCode.includes(q) ||
        infoLabel.includes(q)
      );
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredActions.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageActions = filteredActions.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <section className="approvals-page">
      <Heading
        eyebrow="APPROVALS"
        title="Approval Inbox"
        actions={
          <div className="heading-action-group">
            <AutoRefreshControl onRefresh={onReload} disabled={loading || busy} />
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => void onReload()}
            >
              {loading ? "Đang tải…" : "Làm mới danh sách"}
            </button>
          </div>
        }
      />

      {successNotice ? (
        <Notice type="success" onDismiss={() => setSuccessNotice(null)}>
          {successNotice}
        </Notice>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", gap: "1rem", flexWrap: "wrap", background: "var(--color-surface, #fff)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--color-border, #e2e8f0)" }}>
        <input
          type="search"
          placeholder="🔍 Tìm theo loại yêu cầu, đối tượng, người đề xuất…"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentPage(1);
          }}
          style={{ padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid var(--color-border, #cbd5e1)", minWidth: "280px", flex: 1, fontSize: "0.9rem" }}
        />
        <div style={{ fontSize: "0.85rem", color: "var(--color-muted, #64748b)" }}>
          Hiển thị <strong>{filteredActions.length}</strong> yêu cầu
        </div>
      </div>

      {filteredActions.length === 0 ? (
        <div className="empty">
          {actions.length === 0
            ? "Không có yêu cầu nào đang chờ phê duyệt."
            : "Không tìm thấy yêu cầu nào phù hợp với từ khóa tìm kiếm."}
        </div>
      ) : (
        <>
          <div className="action-list">
            {pageActions.map((action) => {
              const isSelf = Boolean(staff?.id && action.requesterStaffId === staff.id);
              const info = ACTION_TYPE_INFO[action.actionType] || { label: action.actionType, icon: "⚡", category: "Nghiệp vụ" };
              return (
                <button
                  key={action.id}
                  className={`action-row ${isSelf ? "self-action" : ""}`}
                  type="button"
                  onClick={() => handleSelect(action)}
                >
                  <div className="action-main-info">
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "1.1rem" }}>{info.icon}</span>
                      <span className="action-type" style={{ color: "#0f172a" }}>{info.label}</span>
                      <span style={{ fontSize: "0.72rem", background: "#f1f5f9", padding: "1px 6px", borderRadius: "4px", color: "#64748b", fontFamily: "monospace" }}>
                        {action.actionType}
                      </span>
                    </div>
                    <span className="action-target" style={{ fontWeight: 500, color: "#1e293b", marginTop: "3px" }}>
                      {action.targetLabel || `${action.targetType} · ${shortId(action.targetId, 12)}`}
                    </span>
                  </div>

                  <div className="action-maker-info">
                    <span className="muted" style={{ fontWeight: 600 }}>
                      Người gửi: {action.requesterName ? `${action.requesterName} (${action.requesterEmployeeCode || shortId(action.requesterStaffId, 8)})` : shortId(action.requesterStaffId, 8)}
                      {isSelf ? " (Bạn)" : ""}
                    </span>
                    <small className="muted">Hết hạn: {formatDate(action.expiresAt)}</small>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                    <StatusBadge status={action.status} />
                    {isSelf && (
                      <span style={{ fontSize: "0.7rem", color: "#d97706", background: "#fef3c7", padding: "1px 6px", borderRadius: "4px", border: "1px solid #fde68a", fontWeight: 600 }}>
                        ⚠️ Maker tự kiểm tra
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {totalPages > 1 ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", fontSize: "0.84rem", color: "var(--color-text-muted)" }}>
              <div>
                Hiển thị {(safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, filteredActions.length)} trong tổng số {filteredActions.length} yêu cầu
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
              Tổng cộng: {filteredActions.length} yêu cầu
            </div>
          )}
        </>
      )}

      {selected && selectedInfo ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="approval-title" style={{ maxWidth: "680px" }}>
            <div className="panel-heading" style={{ marginBottom: "16px" }}>
              <div>
                <div style={{ fontSize: "0.8rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                  {selectedInfo.category} · {selected.actionType}
                </div>
                <h2 id="approval-title" style={{ margin: "4px 0 0 0", fontSize: "1.25rem", color: "#0f172a" }}>
                  {selectedInfo.icon} {selectedInfo.label}
                </h2>
              </div>
              <button type="button" className="ghost" disabled={busy} onClick={handleClose}>
                Đóng
              </button>
            </div>

            <Notice
              error={modalError}
              retry={modalError?.code === "ACTION_STALE" ? () => void reloadSelectedAction() : undefined}
            />

            {/* Cảnh báo Dual Control */}
            {isSelfMaker && (
              <div className="notice warning" style={{ marginBottom: "1rem" }}>
                <b>⚠️ Cảnh báo Dual Control (Kiểm soát 4 mắt):</b> Bạn chính là người đã khởi tạo yêu cầu này ({staff?.displayName || staff?.employeeCode || "Bạn"}). Theo quy chuẩn an toàn ngân hàng, để đảm bảo tính khách quan và kiểm soát rủi ro, yêu cầu này nên được một Cán bộ Quản trị độc lập khác kiểm tra và phê duyệt.
              </div>
            )}

            {/* Thông tin Đối tượng & Người đề xuất */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px" }}>
                <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#64748b", fontWeight: 700, marginBottom: "4px" }}>
                  🎯 Đối tượng tác động ({selected.targetType})
                </div>
                <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#0f172a", lineHeight: 1.4 }}>
                  {selected.targetLabel || selected.targetId}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "4px", fontFamily: "monospace" }}>
                  UUID: {shortId(selected.targetId, 16)}
                </div>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px" }}>
                <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#64748b", fontWeight: 700, marginBottom: "4px" }}>
                  👤 Cán bộ đề xuất (Maker)
                </div>
                <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>
                  {selected.requesterName || "Cán bộ quản trị"} {selected.requesterEmployeeCode ? `(${selected.requesterEmployeeCode})` : ""}
                  {isSelfMaker ? " — (Bạn)" : ""}
                </div>
                <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "2px" }}>
                  {selected.requesterEmail || selected.requesterStaffId}
                </div>
              </div>
            </div>

            {/* Dấu vân tay Fingerprint SHA-256 */}
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.85rem" }}>✓ Chữ ký số toàn vẹn (SHA-256)</span>
                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Phiên bản: {selected.version} · Hết hạn: {formatDate(selected.expiresAt)}</span>
                </div>
                <div style={{ fontSize: "0.78rem", color: "#1e293b", fontFamily: "monospace", marginTop: "2px" }}>
                  Fingerprint: {selected.requestFingerprint.slice(0, 16)}...{selected.requestFingerprint.slice(-12)}
                </div>
              </div>
              <button
                type="button"
                className="ghost"
                style={{ padding: "4px 8px", fontSize: "0.78rem" }}
                onClick={() => {
                  void navigator.clipboard.writeText(selected.requestFingerprint);
                  setCopyNotice(true);
                  setTimeout(() => setCopyNotice(false), 2000);
                }}
              >
                {copyNotice ? "✓ Đã copy" : "Copy mã"}
              </button>
            </div>

            {/* Bảng Payload chi tiết */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#475569", marginBottom: "6px" }}>
                📋 Chi tiết nội dung đề xuất (Payload nghiệp vụ):
              </div>
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden" }}>
                <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                  <tbody>
                    {Object.entries(selected.payload)
                      .filter(([k]) => !/token|secret|otp|password|cookie|cvv|pin/i.test(k))
                      .map(([key, value], idx) => {
                        const labelMap: Record<string, string> = {
                          reasonCode: "Mã lý do đề xuất",
                          description: "Diễn giải Maker",
                          ticketReference: "Mã phiếu yêu cầu / Ticket",
                          operation: "Thao tác yêu cầu",
                          amountMinor: "Số tiền giao dịch",
                          currency: "Loại tiền tệ",
                          decision: "Quyết định đề xuất",
                          approvedLimitMinor: "Hạn mức thẻ đề xuất",
                          roleCode: "Vai trò nhân sự",
                          environmentScope: "Môi trường phân quyền",
                        };
                        let displayVal = String(value);
                        if (key === "amountMinor" || key === "approvedLimitMinor") {
                          displayVal = Number(value).toLocaleString("vi-VN") + " VND";
                        }
                        return (
                          <tr key={key} style={{ background: idx % 2 === 0 ? "#f8fafc" : "#ffffff", borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "8px 12px", color: "#64748b", fontWeight: 600, width: "35%" }}>
                              {labelMap[key] || key}
                            </td>
                            <td style={{ padding: "8px 12px", color: "#0f172a", fontWeight: 500 }}>
                              {displayVal}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {!canDecideAction ? (
              <div className="notice warning" data-testid="permission-denied-notice">
                <b>Không đủ thẩm quyền phê duyệt:</b> Bạn có quyền xem yêu cầu này (audit.read) nhưng không có quyền phê duyệt/từ chối loại hành động này (<code>{getRequiredApprovalPermission(selected.actionType) ?? "không xác định"}</code>). Chỉ tài khoản ADMIN có quyền tương ứng mới có thể quyết định.
              </div>
            ) : null}

            {stepUpOpen ? (
              <div className="notice info" data-testid="step-up-decision-banner" style={{ marginBottom: "12px" }}>
                Đang tiến hành xác thực bảo mật 2 lớp TOTP để <b>{pendingDecision === "REJECTED" ? "TỪ CHỐI" : "PHÊ DUYỆT"}</b> yêu cầu này.
              </div>
            ) : null}

            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void executeDecision(pendingDecision || "APPROVED");
              }}
            >
              <label>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>Lý do phê duyệt / từ chối:</span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      className="ghost"
                      style={{ fontSize: "0.75rem", padding: "2px 6px" }}
                      onClick={() => setReason("ADMIN_REVIEW_APPROVED")}
                    >
                      ✓ Đã thẩm tra hợp lệ
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      style={{ fontSize: "0.75rem", padding: "2px 6px" }}
                      onClick={() => setReason("REJECT_INSUFFICIENT_DOCS")}
                    >
                      ✕ Thiếu chứng từ
                    </button>
                  </div>
                </div>
                <input
                  data-testid="approval-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ví dụ: ADMIN_REVIEW_APPROVED hoặc nhập ghi chú"
                  required
                  disabled={busy || !canDecideAction}
                />
              </label>

              {stepUpOpen ? (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "12px", marginTop: "4px" }}>
                  <label style={{ margin: 0 }}>
                    <span style={{ fontWeight: 700, color: "#1e40af", display: "block", marginBottom: "6px" }}>
                      🔑 Mã TOTP Step-up (6 số từ Authenticator):
                    </span>
                    <input
                      data-testid="step-up-mfa"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      autoComplete="one-time-code"
                      value={stepUpCode}
                      onChange={(event) => setStepUpCode(event.target.value)}
                      placeholder="123456"
                      required
                      disabled={busy || !canDecideAction}
                      autoFocus
                      style={{ fontSize: "1.25rem", letterSpacing: "0.25em", textAlign: "center", fontWeight: 700, background: "#fff" }}
                    />
                  </label>
                  <small style={{ color: "#2563eb", display: "block", marginTop: "6px" }}>
                    💡 Gợi ý kiểm thử: Chạy lệnh <code>node backend/scripts/get-admin-totp.cjs</code> để lấy mã TOTP 6 số ngay lập tức.
                  </small>
                </div>
              ) : null}

              <div className="button-row" style={{ marginTop: "12px" }}>
                <button
                  className="primary"
                  data-testid="approve-action"
                  type="submit"
                  disabled={
                    busy ||
                    !canDecideAction ||
                    !reason.trim() ||
                    (stepUpOpen && stepUpCode.trim().length !== 6)
                  }
                >
                  {busy
                    ? "Đang xử lý…"
                    : stepUpOpen
                    ? (pendingDecision === "REJECTED" ? "Xác thực MFA và từ chối" : "Xác thực MFA và approve")
                    : "Tiếp tục với step-up MFA"}
                </button>

                <button
                  className="secondary"
                  data-testid="reject-action"
                  type="button"
                  onClick={() => {
                    if (stepUpOpen && pendingDecision === "REJECTED") {
                      setStepUpOpen(false);
                      setPendingDecision(null);
                      setStepUpCode("");
                    } else {
                      void executeDecision("REJECTED");
                    }
                  }}
                  disabled={
                    busy ||
                    !canDecideAction ||
                    !reason.trim()
                  }
                >
                  {stepUpOpen && pendingDecision === "REJECTED" ? "Hủy bỏ step-up" : "Từ chối"}
                </button>
              </div>

              <p className="warning" style={{ margin: "6px 0 0 0", fontSize: "0.78rem" }}>
                Máy chủ thực thi kiểm tra nghiêm ngặt: Quyền hạn Checker, Dấu vân tay SHA-256, Phiên bản dữ liệu và TOTP hợp lệ trước khi ghi nhận vào sổ cái Core Banking.
              </p>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
