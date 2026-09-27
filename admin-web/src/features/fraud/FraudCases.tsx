import { useEffect, useState, type FormEvent } from "react";
import { adminFetch, formatDate, idempotencyKey, shortId, type ApiError } from "../../api";
import { DataTable } from "../../components/common/DataTable";
import { Heading } from "../../components/common/Heading";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { FraudCase } from "../../types";

interface FraudCasesProps {
  items: FraudCase[];
  onReload: () => Promise<void>;
  loading: boolean;
}

export function FraudCases({ items, onReload, loading }: FraudCasesProps) {
  const { hasPermission } = useStaff();
  const [selectedCase, setSelectedCase] = useState<FraudCase | null>(null);
  const [resolutionTarget, setResolutionTarget] = useState<FraudCase | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [modalError, setModalError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Auto-select first case if none selected and items exist
  useEffect(() => {
    if (!selectedCase && items.length > 0) {
      setSelectedCase(items[0]);
    } else if (selectedCase) {
      const refreshed = items.find((i) => i.id === selectedCase.id);
      if (refreshed) setSelectedCase(refreshed);
    }
  }, [items, selectedCase]);

  const canInvestigate = hasPermission("fraud.investigate");
  const canClaim = hasPermission("fraud.claim");

  const handleClaim = async (item: FraudCase) => {
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/admin/fraud-cases/${item.id}/claim`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey("fraud-claim") },
        body: "{}",
      });
      setSelectedCase(item);
      setSuccessNotice(`Đã tiếp nhận điều tra case ${shortId(item.id)}.`);
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const handleAddNote = async () => {
    const targetCase = selectedCase ?? items[0];
    if (!targetCase || !note.trim()) return;

    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/admin/fraud-cases/${targetCase.id}/notes`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey("fraud-note") },
        body: JSON.stringify({ note: note.trim() }),
      });
      setSuccessNotice(`Đã lưu ghi chú vào case ${shortId(targetCase.id)} thành công.`);
      setNote("");
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenResolution = (item: FraudCase) => {
    setResolutionTarget(item);
    setReason("");
    setModalError(null);
  };

  const handleSubmitResolution = async (event: FormEvent) => {
    event.preventDefault();
    if (!resolutionTarget || !reason.trim()) return;

    setBusy(true);
    setModalError(null);

    try {
      const result = await adminFetch<{ action: { id: string } }>(
        `/admin/fraud-cases/${resolutionTarget.id}/resolution-requests`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("fraud-resolution") },
          body: JSON.stringify({
            operation: "RESOLVE",
            resolutionCode: "NOT_FRAUD",
            reasonCode: reason.trim(),
            ticketReference: "ADMIN-FRAUD",
            description: "Admin Web fraud resolution",
          }),
        }
      );

      const targetId = resolutionTarget.id;
      setResolutionTarget(null);
      setSuccessNotice(
        `Đã tạo yêu cầu giải quyết cho case ${shortId(targetId)} (Mã action: ${
          result.action?.id ?? "Mới"
        }). Chờ Control phê duyệt.`
      );
      await onReload();
    } catch (caught) {
      setModalError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  // Determine button text: if the target is items[0], maintain "Ghi chú case đầu tiên"
  // for backwards compatibility, while always binding strictly to the target case!
  const isFirstCase = selectedCase?.id === items[0]?.id;
  const noteButtonLabel = isFirstCase
    ? "Ghi chú case đầu tiên"
    : `Ghi chú cho case đã chọn (${shortId(selectedCase?.id)})`;

  return (
    <section className="fraud-page">
      <Heading eyebrow="FRAUD OPERATIONS" title="Fraud cases" />

      <Notice error={error} retry={() => void onReload()} />
      {successNotice ? (
        <Notice type="success" onDismiss={() => setSuccessNotice(null)}>
          {successNotice}
        </Notice>
      ) : null}

      {items.length === 0 ? (
        <div className="empty">Chưa có fraud case nào trong reference dataset.</div>
      ) : (
        <DataTable>
          {items.map((item) => {
            const isSelected = selectedCase?.id === item.id;
            return (
              <tr
                key={item.id}
                className={isSelected ? "selected-row" : ""}
                onClick={() => setSelectedCase(item)}
                style={{ cursor: "pointer" }}
              >
                <th>
                  {item.severity} · {shortId(item.id)}
                  {isSelected ? " (Đang chọn)" : ""}
                </th>
                <td>
                  <div className="fraud-case-details">
                    <StatusBadge status={item.status} />
                    <span className="fraud-reason"> · {item.reasonPreview}</span>
                    <span className="muted">
                      · Account: {shortId(item.accountId)} · Phụ trách:{" "}
                      {shortId(item.assignedStaffId)} · Kết quả: {item.resolutionCode ?? "—"} ·{" "}
                      {formatDate(item.createdAt)}
                    </span>

                    {canInvestigate ? (
                      <span className="button-row">
                        {item.status === "RECEIVED" && canClaim ? (
                          <button
                            className="secondary"
                            type="button"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleClaim(item);
                            }}
                          >
                            Tiếp nhận (Claim)
                          </button>
                        ) : null}

                        <button
                          className="secondary"
                          type="button"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenResolution(item);
                          }}
                        >
                          Resolution request
                        </button>
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      {selectedCase ? (
        <div className="panel stack fraud-note-panel">
          <div className="panel-heading">
            <h3>
              Ghi chú điều tra cho case: <code>{selectedCase.id}</code> ({selectedCase.severity})
            </h3>
            <span className="muted">Hồ sơ mức độ: {selectedCase.severity}</span>
          </div>

          <label>
            Nội dung ghi chú điều tra nội bộ (Internal note)
            <textarea
              data-testid="fraud-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Nhập nhận định phân tích dấu hiệu rủi ro, bằng chứng synthetic đã rà soát..."
              rows={3}
              disabled={busy}
            />
          </label>

          <div className="button-row">
            <button
              className="secondary"
              data-testid="fraud-note-submit"
              type="button"
              disabled={busy || !note.trim() || !selectedCase}
              onClick={() => void handleAddNote()}
            >
              {noteButtonLabel}
            </button>
          </div>
        </div>
      ) : null}

      <div className="notice info">
        Giải quyết gian lận (Fraud resolution) không tự động hoàn tiền; thao tác hoàn tiền (reversal/refund) phải được khởi tạo bằng financial action riêng biệt theo đúng domain adapter.
      </div>

      {/* Resolution Request Modal */}
      {resolutionTarget ? (
        <div className="modal-backdrop">
          <form className="modal stack" onSubmit={(event) => void handleSubmitResolution(event)}>
            <div className="panel-heading">
              <h2>Fraud resolution request</h2>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => setResolutionTarget(null)}
              >
                Đóng
              </button>
            </div>

            <div className="target-summary-box">
              <p>
                Case <b>{resolutionTarget.id}</b> · Thao tác Maker sẽ chuyển yêu cầu RESOLVE vào
                Approval Inbox cho Control phê duyệt.
              </p>
              <div>
                <b>Lý do báo cáo:</b> {resolutionTarget.reasonPreview}
              </div>
            </div>

            <Notice error={modalError} />

            <label>
              Reason code
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="FRAUD_INVESTIGATION_RESOLVE"
                required
                disabled={busy}
              />
            </label>

            <button
              className="primary"
              type="submit"
              disabled={busy || !reason.trim()}
            >
              {busy ? "Đang gửi…" : "Gửi yêu cầu RESOLVE"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
