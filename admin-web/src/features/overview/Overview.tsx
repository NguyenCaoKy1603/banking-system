import { Heading } from "../../components/common/Heading";
import { useStaff } from "../../context/StaffContext";
import type { Action, NavTab } from "../../types";

interface OverviewProps {
  actions: Action[];
  summary: Record<string, number>;
  onNavigate: (tab: NavTab) => void;
}

export function Overview({ actions, summary, onNavigate }: OverviewProps) {
  const { roleList, canReadApprovals, hasPermission } = useStaff();

  return (
    <div className="overview-page">
      <Heading eyebrow="DASHBOARD" title="Điểm kiểm soát" />

      <div className="metric-grid">
        <article className="metric-card">
          <span>Approval chờ</span>
          <strong>{canReadApprovals ? actions.length : "—"}</strong>
          <small>{canReadApprovals ? "Maker–checker hàng đợi" : "Chỉ Control/Admin"}</small>
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
              className="primary quick-button"
              onClick={() => onNavigate("approvals")}
            >
              Hàng đợi duyệt ({actions.length})
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
          <li>Quy trình Four-Eyes bắt buộc: Người tạo yêu cầu (Maker) không thể tự phê duyệt yêu cầu của mình.</li>
        </ul>
      </section>
    </div>
  );
}
