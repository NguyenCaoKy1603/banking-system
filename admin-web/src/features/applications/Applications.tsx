import { useEffect, useState, type FormEvent } from "react";
import { adminFetch, formatDate, formatMinor, idempotencyKey, shortId, type ApiError } from "../../api";
import { DataTable } from "../../components/common/DataTable";
import { Heading } from "../../components/common/Heading";
import { Modal } from "../../components/common/Modal";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { Application } from "../../types";

interface ApplicationsProps {
  items: Application[];
  onReload: () => Promise<void>;
  loading: boolean;
  tabType?: "KYC" | "CREDIT";
}

export function Applications({ items, onReload, loading, tabType }: ApplicationsProps) {
  const { hasPermission } = useStaff();
  const [filterType, setFilterType] = useState<"ALL" | "KYC" | "CREDIT">(tabType ?? "ALL");
  const [selected, setSelected] = useState<Application | null>(null);
  const [decision, setDecision] = useState("APPROVED");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [modalError, setModalError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  useEffect(() => {
    if (tabType) {
      setFilterType(tabType);
    }
  }, [tabType]);

  const canReviewKyc = hasPermission("kyc.review");
  const canReviewCredit = hasPermission("credit-application.review");
  const canDecideKyc = hasPermission("kyc.decision.request");
  const canDecideCredit = hasPermission("credit-application.review");

  const filteredItems = items.filter((item) => {
    if (filterType === "ALL") return true;
    return item.applicationType === filterType;
  });

  const handleClaim = async (item: Application) => {
    setBusy(true);
    setError(null);
    const path =
      item.applicationType === "KYC"
        ? `/admin/kyc-applications/${item.id}/claim`
        : `/admin/credit-applications/${item.id}/claim`;

    try {
      await adminFetch(path, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey("case-claim") },
        body: "{}",
      });
      setSuccessNotice(`Đã tiếp nhận hồ sơ ${item.applicationType} ${shortId(item.id)}.`);
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDecision = (item: Application) => {
    setSelected(item);
    setDecision(item.applicationType === "KYC" ? "APPROVED" : "PENDING_ACTIVATION");
    setReason("");
    setTicket("");
    setLimit(item.requestedLimitMinor || "");
    setModalError(null);
  };

  const handleSubmitDecision = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !reason.trim() || !ticket.trim()) return;

    setBusy(true);
    setModalError(null);

    const path =
      selected.applicationType === "KYC"
        ? `/admin/kyc-applications/${selected.id}/review-recommendations`
        : `/admin/credit-applications/${selected.id}/review-recommendations`;

    const body: Record<string, unknown> = {
      decision,
      reasonCode: reason.trim(),
      ticketReference: ticket.trim(),
      description: `Admin Web ${selected.applicationType} case review recommendation`,
    };

    if (selected.applicationType === "CREDIT" && limit.trim()) {
      body.approvedLimitMinor = limit.trim();
    }

    try {
      const result = await adminFetch<{ action: { id: string } }>(path, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey("application-decision") },
        body: JSON.stringify(body),
      });

      setSelected(null);
      setSuccessNotice(
        `Đã tạo đề xuất quyết định cho hồ sơ ${selected.applicationType} thành công (Mã yêu cầu: ${result.action?.id ?? "Mới"}). Yêu cầu đã chuyển vào Approval Inbox.`
      );
      await onReload();
    } catch (caught) {
      setModalError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="applications-page">
      <Heading
        eyebrow="CASE OPERATIONS"
        title="KYC và hồ sơ tín dụng"
        actions={
          <div className="filter-button-group">
            <button
              type="button"
              className={filterType === "ALL" ? "primary" : "secondary"}
              onClick={() => setFilterType("ALL")}
            >
              Tất cả ({items.length})
            </button>
            <button
              type="button"
              className={filterType === "KYC" ? "primary" : "secondary"}
              onClick={() => setFilterType("KYC")}
            >
              Hồ sơ KYC ({items.filter((i) => i.applicationType === "KYC").length})
            </button>
            <button
              type="button"
              className={filterType === "CREDIT" ? "primary" : "secondary"}
              onClick={() => setFilterType("CREDIT")}
            >
              Hồ sơ Tín dụng ({items.filter((i) => i.applicationType === "CREDIT").length})
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

      {filteredItems.length === 0 ? (
        <div className="empty">Chưa có hồ sơ trong reference dataset.</div>
      ) : (
        <DataTable>
          {filteredItems.map((item) => {
            const canClaim =
              item.applicationType === "KYC" ? canReviewKyc : canReviewCredit;
            const canDecide =
              item.applicationType === "KYC" ? canDecideKyc : canDecideCredit;
            const isPendingDecision = ["SUBMITTED", "UNDER_REVIEW"].includes(item.status);

            return (
              <tr key={item.id}>
                <th>
                  {item.applicationType} · {shortId(item.id)}
                </th>
                <td>
                  <div className="application-details">
                    <StatusBadge status={item.status} />
                    <span className="muted">
                      · Khách hàng: {shortId(item.customerId)} · Version: {item.version} ·{" "}
                      {formatDate(item.createdAt)}
                    </span>
                    {item.requestedLimitMinor ? (
                      <span className="muted">
                        · Hạn mức đề nghị: {formatMinor(item.requestedLimitMinor)}
                      </span>
                    ) : null}
                    {item.assignedStaffId ? (
                      <span className="muted">
                        · Nhân viên phụ trách: {shortId(item.assignedStaffId)}
                      </span>
                    ) : null}

                    {isPendingDecision ? (
                      <span className="button-row">
                        {canClaim && item.status === "SUBMITTED" ? (
                          <button
                            className="secondary"
                            data-testid="claim-application"
                            type="button"
                            disabled={busy}
                            onClick={() => void handleClaim(item)}
                          >
                            Tiếp nhận hồ sơ
                          </button>
                        ) : null}

                        {canDecide ? (
                          <button
                            className="primary"
                            data-testid="application-decision"
                            type="button"
                            disabled={busy}
                            onClick={() => handleOpenDecision(item)}
                          >
                            Đề xuất phê duyệt
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <div className="notice info">
        Nhân viên Operations tiếp nhận hồ sơ và tạo đề xuất xử lý; quyết định cuối cùng được gửi vào Approval Inbox và phải được Control phê duyệt. Hệ thống không lưu trữ ảnh giấy tờ hoặc dữ liệu sinh trắc học PII ngoài hợp đồng.
      </div>

      {/* Recommendation Modal */}
      {selected ? (
        <div className="modal-backdrop">
          <form className="modal stack" onSubmit={(event) => void handleSubmitDecision(event)}>
            <div className="panel-heading">
              <h2>Đề xuất thẩm định {selected.applicationType === "KYC" ? "hồ sơ KYC" : "hồ sơ tín dụng"}</h2>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Đóng
              </button>
            </div>

            <div className="target-summary-box">
              <div>
                <b>Hồ sơ:</b> {selected.applicationType} · {selected.id}
              </div>
              <div>
                <b>Khách hàng:</b> {selected.customerId} · <b>Trạng thái:</b> {selected.status}
              </div>
              {selected.requestedLimitMinor ? (
                <div>
                  <b>Hạn mức yêu cầu:</b> {formatMinor(selected.requestedLimitMinor)}
                </div>
              ) : null}
            </div>

            <Notice error={modalError} />

            <label>
              Quyết định
              <select
                value={decision}
                onChange={(event) => setDecision(event.target.value)}
                disabled={busy}
              >
                {selected.applicationType === "KYC" ? (
                  <>
                    <option value="APPROVED">APPROVED (Chấp thuận định danh)</option>
                    <option value="REJECTED">REJECTED (Từ chối định danh)</option>
                    <option value="NEEDS_MORE_INFO">NEEDS_MORE_INFO (Yêu cầu bổ sung hồ sơ)</option>
                  </>
                ) : (
                  <>
                    <option value="PENDING_ACTIVATION">
                      PENDING_ACTIVATION (Phê duyệt cấp hạn mức)
                    </option>
                    <option value="REJECTED">REJECTED (Từ chối hạn mức)</option>
                  </>
                )}
              </select>
            </label>

            {selected.applicationType === "CREDIT" ? (
              <label>
                Hạn mức đề xuất (minor VND)
                <input
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                  placeholder="500000"
                  disabled={busy}
                />
              </label>
            ) : null}

            <label>
              Reason code
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="OPERATIONS_REVIEW"
                required
                disabled={busy}
              />
            </label>

            <label>
              Ticket reference
              <input
                value={ticket}
                onChange={(event) => setTicket(event.target.value)}
                placeholder="TICKET-1234"
                required
                disabled={busy}
              />
            </label>

            <button
              className="primary"
              type="submit"
              disabled={busy || !reason.trim() || !ticket.trim()}
            >
              {busy ? "Đang gửi…" : "Gửi vào Approval Inbox"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
