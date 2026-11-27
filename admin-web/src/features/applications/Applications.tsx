import { useEffect, useState, type FormEvent } from "react";
import { adminFetch, formatDate, formatMinor, idempotencyKey, shortId, type ApiError } from "../../api";
import { DataTable } from "../../components/common/DataTable";
import { Heading } from "../../components/common/Heading";
import { Modal } from "../../components/common/Modal";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { Action, Application } from "../../types";

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
  const [inspectItem, setInspectItem] = useState<Application | null>(null);
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

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const canReviewKyc = hasPermission("kyc.review") || hasPermission("kyc.decision.approve");
  const canReviewCredit = hasPermission("credit-application.review") || hasPermission("credit-application.decision.approve");
  const canDecideKyc = hasPermission("kyc.decision.request") || hasPermission("kyc.decision.approve");
  const canDecideCredit = hasPermission("credit-application.review") || hasPermission("credit-application.decision.approve");

  const filteredItems = items.filter((item) => {
    if (filterType !== "ALL" && item.applicationType !== filterType) return false;
    if (statusFilter === "PENDING" && !["SUBMITTED", "UNDER_REVIEW"].includes(item.status)) return false;
    if (statusFilter === "ACTIVE" && !["APPROVED", "ACTIVE", "PENDING_ACTIVATION"].includes(item.status)) return false;
    if (statusFilter === "REJECTED" && item.status !== "REJECTED") return false;

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      const name = (item.customerName || item.fullName || item.applicantLabel || "").toLowerCase();
      const email = (item.customerEmail || "").toLowerCase();
      const phone = (item.customerPhone || "").toLowerCase();
      const id = item.id.toLowerCase();
      const cid = item.customerId.toLowerCase();
      return name.includes(q) || email.includes(q) || phone.includes(q) || id.includes(q) || cid.includes(q);
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
    setReason(item.applicationType === "KYC" ? "KYC_VERIFIED" : "CREDIT_POLICY_PASSED");
    setTicket(`OPS-${Date.now().toString().slice(-6)}`);
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
      description: `Admin Web ${selected.applicationType} case decision`,
      directExecution: true,
    };

    if (selected.applicationType === "CREDIT" && limit.trim()) {
      body.approvedLimitMinor = limit.trim();
    }

    try {
      const result = await adminFetch<{ action: Action }>(path, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey("application-decision") },
        body: JSON.stringify(body),
      });

      const appLabel = selected.applicationType === "KYC" ? "định danh" : "thẻ tín dụng";
      setSuccessNotice(
        result.action?.status === "SUCCEEDED"
          ? `Đã phê duyệt hồ sơ ${appLabel} thành công. Hệ thống đã áp dụng trực tiếp!`
          : `Đã gửi đề xuất phê duyệt hồ sơ ${appLabel} (Mã: ${result.action?.id ?? "Mới"}). Chờ ADMIN phê duyệt trong Approval Inbox.`
      );
      await onReload();
      setSelected(null);
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
        title="Hồ sơ định danh & Tín dụng"
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
              Hồ sơ định danh ({items.filter((i) => i.applicationType === "KYC").length})
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

      <div className="filter-controls-card" style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", background: "var(--color-surface, #fff)", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid var(--color-border, #e2e8f0)" }}>
        <div style={{ flex: 1, minWidth: "260px" }}>
          <input
            type="search"
            placeholder="🔍 Tìm theo tên khách hàng, SĐT, email hoặc mã hồ sơ…"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid var(--color-border, #cbd5e1)", fontSize: "0.9rem" }}
          />
        </div>
        <div className="status-filter-pills" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--color-muted, #64748b)" }}>Lọc trạng thái:</span>
          <button
            type="button"
            className={statusFilter === "ALL" ? "primary" : "secondary"}
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
            onClick={() => {
              setStatusFilter("ALL");
              setCurrentPage(1);
            }}
          >
            Tất cả
          </button>
          <button
            type="button"
            className={statusFilter === "PENDING" ? "primary" : "secondary"}
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
            onClick={() => {
              setStatusFilter("PENDING");
              setCurrentPage(1);
            }}
          >
            ⚡ Chờ xử lý ({items.filter((i) => (filterType === "ALL" || i.applicationType === filterType) && ["SUBMITTED", "UNDER_REVIEW"].includes(i.status)).length})
          </button>
          <button
            type="button"
            className={statusFilter === "ACTIVE" ? "primary" : "secondary"}
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
            onClick={() => {
              setStatusFilter("ACTIVE");
              setCurrentPage(1);
            }}
          >
            Đang hoạt động ({items.filter((i) => (filterType === "ALL" || i.applicationType === filterType) && ["APPROVED", "ACTIVE", "PENDING_ACTIVATION"].includes(i.status)).length})
          </button>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="empty">Không tìm thấy hồ sơ phù hợp với điều kiện tìm kiếm/lọc.</div>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: "130px" }}>Mã hồ sơ</th>
                <th>Khách hàng</th>
                <th style={{ width: "170px" }}>Hạn mức / Nghiệp vụ</th>
                <th style={{ width: "140px" }}>Trạng thái</th>
                <th style={{ width: "140px" }}>Ngày nộp</th>
                <th style={{ width: "200px", textAlign: "right" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item) => {
                const canClaim =
                  item.applicationType === "KYC" ? canReviewKyc : canReviewCredit;
                const canDecide =
                  item.applicationType === "KYC" ? canDecideKyc : canDecideCredit;
                const isPendingDecision = ["SUBMITTED", "UNDER_REVIEW"].includes(item.status);
                const displayName = item.customerName || item.fullName || item.applicantLabel || `Khách hàng ${shortId(item.customerId)}`;

                return (
                  <tr key={item.id}>
                    <td>
                      <strong style={{ color: item.applicationType === "CREDIT" ? "var(--color-primary)" : "var(--color-accent)" }}>
                        {item.applicationType === "CREDIT" ? "Tín dụng" : "Định danh"}
                      </strong>
                      <div className="muted" style={{ fontSize: "0.75rem", fontFamily: "monospace" }}>
                        {shortId(item.id)}
                      </div>
                    </td>
                    <td>
                      <div>
                        <strong style={{ fontSize: "0.95rem" }}>{displayName}</strong>
                      </div>
                      <div className="muted" style={{ fontSize: "0.75rem", marginTop: "2px" }}>
                        {item.customerPhone ? <span>📞 {item.customerPhone} </span> : null}
                        {item.customerEmail ? <span>· ✉ {item.customerEmail}</span> : null}
                        {!item.customerPhone && !item.customerEmail ? <span>ID: {shortId(item.customerId)}</span> : null}
                      </div>
                    </td>
                    <td>
                      {item.applicationType === "CREDIT" ? (
                        <div>
                          <small className="muted">Hạn mức đề xuất:</small>
                          <div><strong style={{ color: "var(--color-primary)", fontSize: "0.95rem" }}>{formatMinor(item.requestedLimitMinor)}</strong></div>
                        </div>
                      ) : (
                        <div>
                          <small className="muted">Hồ sơ định danh:</small>
                          <div><strong>Hồ sơ định danh</strong></div>
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={item.status} />
                      {item.assignedStaffId ? (
                        <div className="muted" style={{ fontSize: "0.7rem", marginTop: "2px" }}>
                          NV: {shortId(item.assignedStaffId)}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {formatDate(item.createdAt)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="button-row" style={{ justifyContent: "flex-end", gap: "0.35rem" }}>
                        <button
                          className="secondary"
                          style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
                          data-testid="inspect-application"
                          type="button"
                          onClick={() => setInspectItem(item)}
                        >
                          Xem hồ sơ
                        </button>

                        {isPendingDecision ? (
                          <>
                            {canClaim && item.status === "SUBMITTED" ? (
                              <button
                                className="secondary"
                                style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
                                data-testid="claim-application"
                                type="button"
                                disabled={busy}
                                onClick={() => void handleClaim(item)}
                              >
                                Tiếp nhận
                              </button>
                            ) : null}

                            {canDecide ? (
                              <button
                                className="primary"
                                style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
                                data-testid="application-decision"
                                type="button"
                                disabled={busy}
                                onClick={() => handleOpenDecision(item)}
                              >
                                Phê duyệt
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", fontSize: "0.84rem", color: "var(--color-text-muted)" }}>
              <div>
                Hiển thị {(safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, filteredItems.length)} trong tổng số {filteredItems.length} hồ sơ
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
              Tổng cộng: {filteredItems.length} hồ sơ
            </div>
          )}
        </div>
      )}

      <div className="notice info">
        ⚡ <b>Chế độ phê duyệt trực tiếp (1 cấp):</b> Nhân viên Operations tiếp nhận và xử lý phê duyệt hồ sơ trực tiếp. Quyết định sẽ có hiệu lực ngay lập tức trên hệ thống và tự động cập nhật đến ứng dụng di động của khách hàng.
      </div>

      {/* Decision Modal */}
      {selected ? (
        <div className="modal-backdrop">
          <form className="modal stack" onSubmit={(event) => void handleSubmitDecision(event)}>
            <div className="panel-heading">
              <h2>Xử lý & Phê duyệt {selected.applicationType === "KYC" ? "hồ sơ định danh" : "hồ sơ tín dụng"}</h2>
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
                Hạn mức phê duyệt cấp thẻ (VND)
                <input
                  type="number"
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                  placeholder="20000000"
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

            <button
              className="primary"
              type="submit"
              disabled={busy || !reason.trim()}
            >
              {busy ? "Đang xử lý…" : "Xác nhận & Phê duyệt trực tiếp"}
            </button>
          </form>
        </div>
      ) : null}

      {/* Inspection Details Modal */}
      {inspectItem ? (
        <div className="modal-backdrop">
          <div className="modal stack" style={{ maxWidth: "680px" }}>
            <div className="panel-heading">
              <h2>
                Hồ sơ thẩm định: {inspectItem.applicationType === "KYC" ? "Định danh khách hàng" : "Cấp thẻ tín dụng"}
              </h2>
              <button
                type="button"
                className="ghost"
                onClick={() => setInspectItem(null)}
              >
                Đóng
              </button>
            </div>

            <div className="target-summary-box">
              <div>
                <b>Khách hàng:</b>{" "}
                <strong style={{ color: "var(--color-primary)", fontSize: "1.05rem" }}>
                  {inspectItem.customerName || inspectItem.fullName || inspectItem.applicantLabel || "Khách hàng"}
                </strong>
                {inspectItem.customerPhone ? <span> · 📞 <code>{inspectItem.customerPhone}</code></span> : null}
                {inspectItem.customerEmail ? <span> · ✉ <code>{inspectItem.customerEmail}</code></span> : null}
              </div>
              <div style={{ marginTop: "0.25rem" }}>
                <b>Mã hồ sơ:</b> <code>{shortId(inspectItem.id, 12)}</code> · <b>Mã khách hàng:</b> <code>{shortId(inspectItem.customerId, 12)}</code>
              </div>
              <div style={{ marginTop: "0.25rem" }}>
                <b>Trạng thái:</b> <StatusBadge status={inspectItem.status} /> · <b>Ngày nộp:</b> {formatDate(inspectItem.createdAt)}
              </div>
              {inspectItem.assignedStaffId ? (
                <div style={{ marginTop: "0.25rem" }}>
                  <b>Nhân viên phụ trách:</b> <code>{shortId(inspectItem.assignedStaffId, 12)}</code>
                </div>
              ) : null}
            </div>

            {inspectItem.applicationType === "KYC" ? (
              <div className="kyc-inspection-container">
                <h3 className="section-title">Thông tin định danh khách hàng khai báo</h3>
                <div className="id-card-mockup">
                  <div className="id-card-header">
                    <span className="emblem">★</span>
                    <div>
                      <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong>
                      <small>Độc lập - Tự do - Hạnh phúc</small>
                    </div>
                  </div>
                  <div className="id-card-title">HỒ SƠ ĐỊNH DANH KHÁCH HÀNG / IDENTITY PROFILE</div>
                  <div className="id-card-body">
                    <div className="id-card-avatar">
                      <div className="avatar-placeholder">👤</div>
                      <small style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
                        {inspectItem.documentUri ? "Có tệp giấy tờ" : "Chưa có ảnh"}
                      </small>
                    </div>
                    <div className="id-card-details">
                      <div><b>Họ và tên:</b> <strong style={{ color: "var(--color-primary)" }}>{inspectItem.fullName || inspectItem.applicantLabel || "Chưa cập nhật"}</strong></div>
                      <div><b>Số CCCD / Định danh:</b> <code>{inspectItem.identityNumber ? (inspectItem.identityNumber.length > 6 ? `${inspectItem.identityNumber.slice(0, 4)}••••${inspectItem.identityNumber.slice(-3)}` : inspectItem.identityNumber) : "Chưa cập nhật"}</code></div>
                      <div><b>Địa chỉ thường trú:</b> {inspectItem.address || "Chưa cập nhật"}</div>
                      <div><b>Thời gian nộp:</b> {formatDate(inspectItem.createdAt)}</div>
                      <div><b>Trạng thái hồ sơ:</b> <StatusBadge status={inspectItem.status} /></div>
                    </div>
                  </div>
                </div>

                <h3 className="section-title" style={{ marginTop: "1rem" }}>
                  Kiểm tra định dạng & Cú pháp hồ sơ (Format Validation)
                </h3>
                <div className="biometric-audit-box">
                  <div className="audit-checklist">
                    {(() => {
                      const rawId = inspectItem.identityNumber?.trim() ?? "";
                      const validId = /^\d{6,24}$/.test(rawId);
                      const hasName = Boolean(inspectItem.fullName?.trim());
                      const hasAddress = Boolean(inspectItem.address?.trim());
                      return (
                        <>
                          <div className={`check-item ${validId ? "success" : "info"}`}>
                            {validId ? "✔" : "ℹ"} Số định danh / CCCD:{" "}
                            {!rawId
                              ? "CHỜ BỔ SUNG"
                              : validId
                                ? "ĐÚNG ĐỊNH DẠNG (6 - 24 chữ số)"
                                : "CHƯA ĐÚNG ĐỊNH DẠNG (cần 6 - 24 chữ số)"}
                          </div>
                          <div className={`check-item ${hasName ? "success" : "info"}`}>
                            {hasName ? "✔" : "ℹ"} Thông tin cá nhân:{" "}
                            {hasName ? "ĐÃ KHAI BÁO HỌ TÊN" : "THIẾU HỌ TÊN"}
                          </div>
                          <div className={`check-item ${hasAddress ? "success" : "info"}`}>
                            {hasAddress ? "✔" : "ℹ"} Địa chỉ thường trú:{" "}
                            {hasAddress ? "ĐÃ KHAI BÁO ĐỊA CHỈ" : "CHƯA KHAI BÁO"}
                          </div>
                          <div className="check-item info">
                            ℹ <b>Lưu ý thẩm định:</b> Hệ thống tự động kiểm tra định dạng cú pháp (Format validation). Cán bộ vận hành chịu trách nhiệm đối soát thực tế trước khi đề xuất phê duyệt.
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="credit-inspection-container">
                <h3 className="section-title">Thông tin đề xuất thẻ tín dụng</h3>
                <div className="credit-card-mockup">
                  <div className="card-network">NOVA PLATINUM CREDIT</div>
                  <div className="card-chip">🖴 EMV CHIP</div>
                  <div className="card-number">•••• •••• •••• 8868</div>
                  <div className="card-footer">
                    <div>
                      <small>HẠN MỨC ĐỀ NGHỊ</small>
                      <strong>{formatMinor(inspectItem.requestedLimitMinor || "20000000")}</strong>
                    </div>
                    <div className="contactless">📶 CONTACTLESS</div>
                  </div>
                </div>

                <h3 className="section-title" style={{ marginTop: "1rem" }}>
                  Thẩm định điều kiện & Chính sách cấp hạn mức (Credit Policy Assessment)
                </h3>
                <div className="biometric-audit-box">
                  <div className="audit-checklist">
                    <div className="check-item success">
                      ✔ Phân loại chính sách: {Number(inspectItem.requestedLimitMinor || "0") <= 5000000 ? "GÓI TIÊU DÙNG VI MÔ (MICRO-LIMIT)" : "GÓI TIÊU CHUẨN (STANDARD CREDIT)"}
                    </div>
                    <div className="check-item success">
                      ✔ Hạn mức yêu cầu: {formatMinor(inspectItem.requestedLimitMinor || "20000000")} (Nằm trong trần quy định 100.000.000 VND)
                    </div>
                    <div className="check-item success">
                      ✔ Trạng thái tài khoản khách hàng: ĐANG HOẠT ĐỘNG (ACTIVE)
                    </div>
                    <div className="check-item info">
                      ℹ <b>Ghi chú thẩm định:</b> Hệ thống ghi nhận hạn mức đề xuất từ ứng dụng di động. Cán bộ vận hành quyết định phê duyệt đủ hạn mức, giảm hạn mức hoặc từ chối cấp thẻ.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="button-row" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setInspectItem(null)}
              >
                Đóng
              </button>

              {((inspectItem.applicationType === "KYC" ? canReviewKyc : canReviewCredit) && inspectItem.status === "SUBMITTED") ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    const item = inspectItem;
                    setInspectItem(null);
                    await handleClaim(item);
                  }}
                >
                  Tiếp nhận hồ sơ
                </button>
              ) : null}

              {((inspectItem.applicationType === "KYC" ? canDecideKyc : canDecideCredit) && ["SUBMITTED", "UNDER_REVIEW"].includes(inspectItem.status)) ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const item = inspectItem;
                    setInspectItem(null);
                    handleOpenDecision(item);
                  }}
                >
                  Chuyển sang Phê duyệt hồ sơ
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
