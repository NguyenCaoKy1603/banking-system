import { useState } from "react";
import { adminFetch, formatDate, formatMinor, idempotencyKey, shortId, type ApiError } from "../../api";
import { DataTable } from "../../components/common/DataTable";
import { Heading } from "../../components/common/Heading";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { Transfer } from "../../types";

interface TransfersProps {
  items: Transfer[];
  onReload: () => Promise<void>;
  onFilterChange: (status: string) => Promise<void>;
  loading: boolean;
}

export function Transfers({ items, onReload, onFilterChange, loading }: TransfersProps) {
  const { hasPermission } = useStaff();
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const canOperate = hasPermission("transfer.action.request");

  const handleFilter = async (status: string) => {
    setStatusFilter(status);
    await onFilterChange(status);
  };

  const handleTransferOperation = async (
    item: Transfer,
    operation: "retry" | "cancel" | "reversal"
  ) => {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    setSuccessNotice(null);

    const path = `/admin/transfers/${item.id}/${operation}-requests`;
    const body = {
      reasonCode: reason.trim(),
      ticketReference: "ADMIN-TRANSFER",
      description: `Admin Web transfer ${operation} operation`,
    };

    try {
      const result = await adminFetch<{ action: { id: string } }>(path, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey(`transfer-${operation}`) },
        body: JSON.stringify(body),
      });

      setSuccessNotice(
        `Đã tạo yêu cầu ${operation.toUpperCase()} cho giao dịch ${item.reference} thành công (Mã yêu cầu: ${
          result.action?.id ?? "Mới"
        }). Chờ ADMIN phê duyệt.`
      );
      setReason("");
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="transfers-page">
      <Heading
        eyebrow="PENDING TRANSFERS"
        title="Giao dịch chờ xử lý"
        actions={
          <div className="filter-button-group">
            <button
              type="button"
              className={statusFilter === "" ? "primary" : "secondary"}
              onClick={() => void handleFilter("")}
            >
              Tất cả
            </button>
            <button
              type="button"
              className={statusFilter === "PENDING" ? "primary" : "secondary"}
              onClick={() => void handleFilter("PENDING")}
            >
              PENDING (Chờ duyệt)
            </button>
            <button
              type="button"
              className={statusFilter === "FAILED" ? "primary" : "secondary"}
              onClick={() => void handleFilter("FAILED")}
            >
              FAILED (Thất bại)
            </button>
            <button
              type="button"
              className={statusFilter === "SUCCEEDED" ? "primary" : "secondary"}
              onClick={() => void handleFilter("SUCCEEDED")}
            >
              SUCCEEDED (Thành công)
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

      <div className="panel stack reason-box">
        <label>
          Reason code cho thao tác (Bắt buộc trước khi tạo yêu cầu)
          <input
            data-testid="transfer-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="TRANSFER_REVIEW"
            disabled={busy}
          />
        </label>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          {statusFilter ? `Không có giao dịch ở trạng thái ${statusFilter}.` : "Không có giao dịch nào."}
        </div>
      ) : (
        <DataTable>
          {items.map((item) => (
            <tr key={item.id}>
              <th>{item.reference}</th>
              <td>
                <div className="transfer-row-content">
                  <span className="transfer-amount">{formatMinor(item.amountMinor)}</span>
                  <StatusBadge status={item.status} />
                  <span className="muted">
                    · Account: {shortId(item.sourceAccountId)} · Phí: {formatMinor(item.feeMinor)} · Lỗi:{" "}
                    {item.lastErrorCode ?? "—"} · Version: {item.version} · {formatDate(item.createdAt)}
                  </span>

                  {canOperate ? (
                    <span className="button-row">
                      {item.status === "PENDING" ? (
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy || !reason.trim()}
                          onClick={() => void handleTransferOperation(item, "cancel")}
                        >
                          Cancel request
                        </button>
                      ) : null}

                      {item.status === "FAILED" ? (
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy || !reason.trim()}
                          onClick={() => void handleTransferOperation(item, "retry")}
                        >
                          Retry request
                        </button>
                      ) : null}

                      {item.status === "SUCCEEDED" ? (
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy || !reason.trim()}
                          onClick={() => void handleTransferOperation(item, "reversal")}
                        >
                          Reversal request
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <div className="notice info">
        Retry/cancel/reversal tạo yêu cầu chờ ADMIN phê duyệt; Admin Web không thể trực tiếp đổi trạng thái giao dịch thành SUCCEEDED.
      </div>
    </section>
  );
}
