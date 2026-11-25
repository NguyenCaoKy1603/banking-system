import { formatMinor } from "../../api";
import { Heading } from "../../components/common/Heading";
import { useStaff } from "../../context/StaffContext";
import type { Action, LedgerReconciliation, NavTab } from "../../types";

interface OverviewProps {
  actions: Action[];
  summary: Record<string, number>;
  reconciliation?: LedgerReconciliation | null;
  onNavigate: (tab: NavTab) => void;
}

export function Overview({ actions, summary, reconciliation, onNavigate }: OverviewProps) {
  const { roleList, canReadApprovals, hasPermission } = useStaff();
  const isBalanced = reconciliation?.status === "BALANCED";

  return (
    <div className="overview-page">
      <Heading eyebrow="DASHBOARD" title="Điểm kiểm soát" />

      <div className="metric-grid">
        <article className="metric-card">
          <span>Hệ thống Core</span>
          <strong>ONLINE</strong>
          <small>PostgreSQL 16 Healthy</small>
        </article>

        <article className="metric-card" data-testid="ledger-reconciliation-card">
          <span>Đối soát Sổ cái (Core Ledger Health)</span>
          <strong
            style={{ color: reconciliation ? (isBalanced ? "#15803d" : "#b91c1c") : undefined }}
            className={reconciliation && !isBalanced ? "danger-text" : ""}
          >
            {reconciliation ? reconciliation.status : "CHƯA KIỂM TRA"}
          </strong>
          <small>
            {reconciliation
              ? `Journal lệch: ${reconciliation.unbalancedJournalCount} · Chênh lệch: ${formatMinor(reconciliation.discrepancyMinor)} (Tài khoản: ${formatMinor(reconciliation.paymentAccountsTotalMinor)} / Sổ cái: ${formatMinor(reconciliation.ledgerPaymentAccountsNetMinor)})`
              : "Cần quyền outbox.read để xem đối soát sổ cái"}
          </small>
        </article>

        <article className="metric-card">
          <span>Outbox pending</span>
          <strong>{summary.PENDING ?? 0}</strong>
          <small>Worker claim bình thường</small>
        </article>

        <article className="metric-card">
          <span>Outbox dead</span>
          <strong className={(summary.DEAD ?? 0) > 0 ? "danger-text" : ""}>
            {summary.DEAD ?? 0}
          </strong>
          <small>Sự kiện lỗi cần kiểm tra</small>
        </article>

        <article className="metric-card">
          <span>Staff session</span>
          <strong>ACTIVE</strong>
          <small>{roleList || "Phiên hoạt động"}</small>
        </article>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>Lối tắt nghiệp vụ theo quyền</h2>
        </div>
        <div className="quick-actions">
          {hasPermission("customer.read.masked") ? (
            <button
              type="button"
              className="secondary quick-button"
              onClick={() => onNavigate("customers")}
            >
              Mở dữ liệu tài khoản
            </button>
          ) : null}
          {canReadApprovals ? (
            <button
              type="button"
              className="secondary quick-button"
              onClick={() => onNavigate("policy")}
            >
              Cấu hình Chính sách & Biểu phí
            </button>
          ) : null}
          {canReadApprovals ? (
            <button
              type="button"
              className="primary quick-button"
              onClick={() => onNavigate("audit")}
            >
              Xem nhật ký kiểm toán (Audit)
            </button>
          ) : null}
          {hasPermission("kyc.read") ? (
            <button
              type="button"
              className="secondary quick-button"
              onClick={() => onNavigate("kyc")}
            >
              Thẩm định hồ sơ
            </button>
          ) : null}
          {hasPermission("transfer.pending.read") ? (
            <button
              type="button"
              className="secondary quick-button"
              onClick={() => onNavigate("transfers")}
            >
              Kiểm tra lệnh chuyển tiền
            </button>
          ) : null}
          {hasPermission("outbox.read") ? (
            <button
              type="button"
              className="secondary quick-button"
              onClick={() => onNavigate("operations")}
            >
              Vận hành tiến trình nền
            </button>
          ) : null}
          {hasPermission("staff.read") ? (
            <button
              type="button"
              className="secondary quick-button"
              onClick={() => onNavigate("staff")}
            >
              Quản trị nhân sự nội bộ
            </button>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Nguyên tắc vận hành</h2>
          <span className="status-dot">● Sandbox</span>
        </div>
        <ul className="guard-list">
          <li>Server là nguồn sự thật duy nhất cho quyền, trạng thái và số dư tài khoản.</li>
          <li>Tuyệt đối không có thao tác đặt trạng thái giao dịch thành công bằng tay từ UI.</li>
          <li>Thông tin định danh khách hàng (PII) và số tài khoản được che mặc định; mọi lượt xem đều ghi nhận kiểm toán (audit log).</li>
          <li>ADMIN có thể tự phê duyệt yêu cầu đủ quyền sau khi xác thực Step-up MFA.</li>
        </ul>
      </section>
    </div>
  );
}
