import { useState, type ReactNode } from "react";
import { adminFetch, formatDate, idempotencyKey, shortId, type ApiError } from "../../api";
import { Heading } from "../../components/common/Heading";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { Action } from "../../types";
import {
  APPROVAL_PERMISSION_MAP,
  canStaffApproveAction,
  getRequiredApprovalPermission,
  resolveDecisionEndpointAndBody,
} from "./approvalsLogic";

interface ApprovalsProps {
  actions: Action[];
  onReload: () => Promise<void>;
  loading: boolean;
}

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
    setReason("");
    setStepUpCode("");
    setStepUpOpen(false);
    setPendingDecision(null);
    setModalError(null);
  };

  const handleClose = () => {
    if (busy) return;
    setSelected(null);
    setReason("");
    setStepUpCode("");
    setStepUpOpen(false);
    setPendingDecision(null);
    setModalError(null);
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
        `Đã ${decisionToExecute === "APPROVED" ? "phê duyệt" : "từ chối"} yêu cầu ${approvedActionId} thành công.`
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

  return (
    <section className="approvals-page">
      <Heading
        eyebrow="APPROVALS"
        title="Approval Inbox"
        actions={
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => void onReload()}
          >
            {loading ? "Đang tải…" : "Làm mới danh sách"}
          </button>
        }
      />

      {successNotice ? (
        <Notice type="success" onDismiss={() => setSuccessNotice(null)}>
          {successNotice}
        </Notice>
      ) : null}

      {actions.length === 0 ? (
        <div className="empty">Không có yêu cầu chờ phê duyệt.</div>
      ) : (
        <div className="action-list">
          {actions.map((action) => {
            const isSelf = staff?.id && action.requesterStaffId === staff.id;
            return (
              <button
                key={action.id}
                className={`action-row ${isSelf ? "self-action" : ""}`}
                type="button"
                onClick={() => handleSelect(action)}
              >
                <div className="action-main-info">
                  <span className="action-type">{action.actionType}</span>
                  <span className="action-target">
                    {action.targetType} · {shortId(action.targetId, 12)}
                  </span>
                </div>
                <div className="action-maker-info">
                  <span className="muted">
                    Người gửi: {shortId(action.requesterStaffId, 8)}
                    {isSelf ? " (Bạn)" : ""}
                  </span>
                  <small className="muted">Hết hạn: {formatDate(action.expiresAt)}</small>
                </div>
                <StatusBadge status={action.status} />
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="approval-title">
            <div className="panel-heading">
              <h2 id="approval-title">Duyệt yêu cầu: {selected.actionType}</h2>
              <button type="button" className="ghost" disabled={busy} onClick={handleClose}>
                Đóng
              </button>
            </div>

            <Notice
              error={modalError}
              retry={modalError?.code === "ACTION_STALE" ? () => void reloadSelectedAction() : undefined}
            />

            <dl className="detail-grid">
              <dt>Loại hành động</dt>
              <dd>
                <strong>{selected.actionType}</strong>
              </dd>

              <dt>Đối tượng</dt>
              <dd>
                {selected.targetType} · <code>{selected.targetId}</code>
              </dd>

              <dt>Người yêu cầu</dt>
              <dd>
                <code>{selected.requesterStaffId}</code>
              </dd>

              <dt>Action version</dt>
              <dd>{selected.version}</dd>

              <dt>Fingerprint</dt>
              <dd className="mono">{selected.requestFingerprint}</dd>

              <dt>Payload đã che</dt>
              <dd className="payload-display">
                {Object.entries(selected.payload)
                  .filter(
                    ([key]) => !/token|secret|otp|password|cookie|cvv|pin/i.test(key)
                  )
                  .map(([key, value]) => (
                    <div key={key} className="payload-item">
                      <b>{key}</b>: {String(value)}
                    </div>
                  ))}
              </dd>

              <dt>Hạn hiệu lực</dt>
              <dd>{formatDate(selected.expiresAt)}</dd>
            </dl>

            {!canDecideAction ? (
              <div className="notice warning" data-testid="permission-denied-notice">
                <b>Không đủ thẩm quyền phê duyệt:</b> Bạn có quyền xem yêu cầu này (audit.read) nhưng không có quyền phê duyệt/từ chối loại hành động này (<code>{getRequiredApprovalPermission(selected.actionType) ?? "không xác định"}</code>). Chỉ tài khoản ADMIN có quyền tương ứng mới có thể quyết định.
              </div>
            ) : null}

            {stepUpOpen ? (
              <div className="notice info" data-testid="step-up-decision-banner">
                Đang xác thực TOTP Step-up để <b>{pendingDecision === "REJECTED" ? "TỪ CHỐI" : "PHÊ DUYỆT"}</b> yêu cầu.
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
                Lý do phê duyệt / từ chối
                <input
                  data-testid="approval-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="ADMIN_REVIEW"
                  required
                  disabled={busy || !canDecideAction}
                />
              </label>

              {stepUpOpen ? (
                <label>
                  Mã TOTP step-up (Nhập từ Authenticator)
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
                  />
                </label>
              ) : null}

              <div className="button-row">
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

              <p className="warning">
                Máy chủ vẫn kiểm tra quyền, nội dung yêu cầu, phiên bản dữ liệu và xác thực MFA mới.
              </p>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
