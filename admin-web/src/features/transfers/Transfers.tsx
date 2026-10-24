import { useState, type FormEvent } from "react";
import { adminFetch, formatDate, formatMinor, idempotencyKey, shortId, type ApiError } from "../../api";
import { Heading } from "../../components/common/Heading";
import { Modal } from "../../components/common/Modal";
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
  const [statusFilter, setStatusFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;
  const [activeOperation, setActiveOperation] = useState<{
    item: Transfer;
    operation: "retry" | "cancel" | "reversal";
  } | null>(null);
  const [reason, setReason] = useState("TRANSFER_REVIEW");
  const [ticket, setTicket] = useState("ADMIN-TRANSFER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [modalError, setModalError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const canOperate = hasPermission("transfer.action.request");

  const handleFilter = async (status: string) => {
    setStatusFilter(status);
    setCurrentPage(1);
    await onFilterChange(status);
  };

  const handleOpenOperation = (item: Transfer, operation: "retry" | "cancel" | "reversal") => {
    setActiveOperation({ item, operation });
    if (operation === "cancel") setReason("CUSTOMER_CANCEL_REQUEST");
    else if (operation === "retry") setReason("NETWORK_TIMEOUT_RETRY");
    else setReason("CUSTOMER_TRANSFER_MISTAKE");
    setTicket(`TICKET-${item.reference.replace("REF-", "")}`);
    setModalError(null);
  };

  const handleSubmitOperation = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeOperation || !reason.trim()) return;

    setBusy(true);
    setModalError(null);
    const { item, operation } = activeOperation;
    const path = `/admin/transfers/${item.id}/${operation}-requests`;
    const body = {
      reasonCode: reason.trim(),
      ticketReference: ticket.trim() || "ADMIN-TRANSFER",
      description: `Admin Web transfer ${operation} operation for ${item.reference}`,
      directExecution: true,
    };

    try {
      const result = await adminFetch<{ action: { id: string } }>(path, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey(`transfer-${operation}`) },
        body: JSON.stringify(body),
      });

      setActiveOperation(null);
      setSuccessNotice(
        `Đã thực hiện thao tác ${operation.toUpperCase()} cho giao dịch ${item.reference} thành công. Hệ thống Core Banking đã xử lý và ghi sổ trực tiếp!`
      );
      await onReload();
    } catch (caught) {
      setModalError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const filteredItems = items.filter((item) => {
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const ref = item.reference.toLowerCase();
      const sender = (item.senderName || "").toLowerCase();
      const sourceAcc = (item.sourceAccountNumber || item.sourceAccountId || "").toLowerCase();
      const receiver = (item.destinationOwnerName || "").toLowerCase();
      const destAcc = (item.destinationAccountNumber || "").toLowerCase();
      return ref.includes(q) || sender.includes(q) || sourceAcc.includes(q) || receiver.includes(q) || destAcc.includes(q);
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <section className="transfers-page">
      <Heading
        eyebrow="TRANSFER OPERATIONS"
        title="Quản lý giao dịch chuyển tiền & Xử lý ngoại lệ"
        actions={
          <div className="filter-button-group">
            <button
              type="button"
              className={statusFilter === "" ? "primary" : "secondary"}
              onClick={() => void handleFilter("")}
            >
              Tất cả ({statusFilter === "" ? items.length : "…"})
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

      {/* Search & Filter Toolbar */}
      <div className="filter-controls-card" style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", background: "var(--color-surface, #fff)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--color-border, #e2e8f0)" }}>
        <div style={{ flex: 1, minWidth: "260px" }}>
          <input
            type="search"
            placeholder="🔍 Tìm theo mã GD (REF-...), người gửi, người nhận, số tài khoản…"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid var(--color-border, #cbd5e1)", fontSize: "0.9rem" }}
          />
        </div>
        <div style={{ fontSize: "0.85rem", color: "var(--color-muted, #64748b)" }}>
          Hiển thị <strong>{filteredItems.length}</strong> giao dịch
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="empty">
          {statusFilter ? `Không có giao dịch ở trạng thái ${statusFilter}.` : "Không tìm thấy giao dịch nào phù hợp."}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: "160px" }}>Mã tham chiếu</th>
                <th>Người gửi (Tài khoản nguồn)</th>
                <th>Người nhận (Tài khoản đích)</th>
                <th style={{ width: "150px" }}>Số tiền / Phí</th>
                <th style={{ width: "130px" }}>Trạng thái</th>
                <th style={{ width: "140px" }}>Thời gian</th>
                <th style={{ width: "150px", textAlign: "right" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong style={{ fontFamily: "monospace", fontSize: "0.9rem" }}>{item.reference}</strong>
                    <div className="muted" style={{ fontSize: "0.75rem" }}>
                      v{item.version}
                    </div>
                  </td>
                  <td>
                    <div><strong>{item.senderName || `KH: ${shortId(item.customerId)}`}</strong></div>
                    <div className="muted" style={{ fontSize: "0.75rem" }}>
                      TK: {item.sourceAccountNumber || shortId(item.sourceAccountId)}
                    </div>
                  </td>
                  <td>
                    <div><strong>{item.destinationOwnerName || "Người nhận liên ngân hàng"}</strong></div>
                    <div className="muted" style={{ fontSize: "0.75rem" }}>
                      TK: {item.destinationAccountNumber || "Tài khoản đối ứng"}
                    </div>
                  </td>
                  <td>
                    <div><strong style={{ color: "var(--color-success, #16a34a)", fontSize: "0.95rem" }}>{formatMinor(item.amountMinor)}</strong></div>
                    <div className="muted" style={{ fontSize: "0.75rem" }}>
                      Phí: {formatMinor(item.feeMinor)}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={item.status} />
                    {item.lastErrorCode ? (
                      <div className="muted" style={{ fontSize: "0.7rem", color: "var(--color-danger, #dc2626)", marginTop: "2px" }}>
                        {item.lastErrorCode}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                    {formatDate(item.createdAt)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {canOperate ? (
                      <div className="button-row" style={{ justifyContent: "flex-end" }}>
                        {item.status === "PENDING" ? (
                          <button
                            className="secondary"
                            style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem", borderColor: "var(--color-danger, #dc2626)", color: "var(--color-danger, #dc2626)" }}
                            type="button"
                            disabled={busy}
                            onClick={() => handleOpenOperation(item, "cancel")}
                          >
                            Hủy lệnh
                          </button>
                        ) : null}

                        {item.status === "FAILED" ? (
                          <button
                            className="secondary"
                            style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
                            type="button"
                            disabled={busy}
                            onClick={() => handleOpenOperation(item, "retry")}
                          >
                            Thử lại
                          </button>
                        ) : null}

                        {item.status === "SUCCEEDED" && !item.refunded ? (
                          <button
                            className="secondary"
                            style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
                            type="button"
                            disabled={busy}
                            onClick={() => handleOpenOperation(item, "reversal")}
                          >
                            Hoàn tiền
                          </button>
                        ) : null}

                        {item.refunded ? (
                          <span style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontStyle: "italic" }}>
                            Đã hoàn tiền
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="muted" style={{ fontSize: "0.8rem" }}>Chỉ xem</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", fontSize: "0.84rem", color: "var(--color-text-muted)" }}>
              <div>
                Hiển thị {(safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, filteredItems.length)} trong tổng số {filteredItems.length} giao dịch
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
              Tổng cộng: {filteredItems.length} giao dịch
            </div>
          )}
        </div>
      )}

      {/* Operation Modal */}
      {activeOperation ? (
        <Modal
          title={
            activeOperation.operation === "cancel"
              ? "Hủy giao dịch chuyển tiền (Cancel Transfer)"
              : activeOperation.operation === "retry"
              ? "Thử lại giao dịch chuyển tiền (Retry Transfer)"
              : "Yêu cầu hoàn trả giao dịch (Transfer Reversal)"
          }
          isOpen={true}
          onClose={() => setActiveOperation(null)}
          maxWidth="560px"
        >
          <form onSubmit={handleSubmitOperation} className="stack">
            <Notice error={modalError} />

            <div className="target-summary-box">
              <div>
                <b>Mã tham chiếu:</b> <code>{activeOperation.item.reference}</code>
              </div>
              <div>
                <b>Số tiền:</b> <strong style={{ color: "var(--color-primary)" }}>{formatMinor(activeOperation.item.amountMinor)}</strong> (Phí: {formatMinor(activeOperation.item.feeMinor)})
              </div>
              <div>
                <b>Người gửi:</b> {activeOperation.item.senderName || shortId(activeOperation.item.customerId)} · <b>Người nhận:</b> {activeOperation.item.destinationOwnerName || "Liên ngân hàng"}
              </div>
              <div>
                <b>Trạng thái hiện tại:</b> <StatusBadge status={activeOperation.item.status} />
              </div>
            </div>

            <label>
              Mã lý do nghiệp vụ (Reason Code):
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
                style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
              >
                {activeOperation.operation === "cancel" ? (
                  <>
                    <option value="CUSTOMER_CANCEL_REQUEST">CUSTOMER_CANCEL_REQUEST (Khách hàng yêu cầu hủy)</option>
                    <option value="SYSTEM_TIMEOUT_CANCEL">SYSTEM_TIMEOUT_CANCEL (Hệ thống nghẽn mạng quá hạn)</option>
                    <option value="DUPLICATE_SUSPECTED">DUPLICATE_SUSPECTED (Nghi ngờ gửi trùng lệnh)</option>
                  </>
                ) : activeOperation.operation === "retry" ? (
                  <>
                    <option value="NETWORK_TIMEOUT_RETRY">NETWORK_TIMEOUT_RETRY (Thử lại do rớt mạng)</option>
                    <option value="GATEWAY_RETRY">GATEWAY_RETRY (Thử lại qua cổng đối tác)</option>
                  </>
                ) : (
                  <>
                    <option value="CUSTOMER_TRANSFER_MISTAKE">CUSTOMER_TRANSFER_MISTAKE (Khách hàng chuyển nhầm tài khoản)</option>
                    <option value="FRAUD_DISPUTE_REVERSAL">FRAUD_DISPUTE_REVERSAL (Khiếu nại gian lận/lừa đảo)</option>
                    <option value="SERVICE_ORDER_CANCELLED">SERVICE_ORDER_CANCELLED (Đơn hàng dịch vụ bị hủy)</option>
                  </>
                )}
                <option value="TRANSFER_REVIEW">TRANSFER_REVIEW (Đánh giá lại giao dịch)</option>
              </select>
            </label>

            <div className="notice info" style={{ fontSize: "0.85rem" }}>
              ⚡ <b>Chế độ thực thi trực tiếp:</b> Lệnh <b>{activeOperation.operation === "reversal" ? "HOÀN TIỀN (REVERSAL)" : activeOperation.operation === "cancel" ? "HỦY LỆNH (CANCEL)" : "THỬ LẠI (RETRY)"}</b> sẽ được xử lý ngay lập tức trên hệ thống Core Banking và hạch toán trực tiếp vào số dư tài khoản của khách hàng.
            </div>

            <div className="button-row" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setActiveOperation(null)}
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className="primary"
                disabled={busy || !reason.trim()}
              >
                {busy
                  ? "Đang xử lý…"
                  : activeOperation.operation === "reversal"
                  ? "Xác nhận hoàn tiền ngay"
                  : activeOperation.operation === "cancel"
                  ? "Xác nhận hủy lệnh"
                  : "Xác nhận thử lại"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      <div className="notice info" style={{ marginTop: "1.5rem" }}>
        ⚡ <b>Xử lý ngoại lệ giao dịch trực tiếp (1 cấp):</b> Các lệnh can thiệp giao dịch (Thử lại / Hủy lệnh / Hoàn tiền) được thực thi và hạch toán trực tiếp trên hệ thống Core Banking.
      </div>
    </section>
  );
}
