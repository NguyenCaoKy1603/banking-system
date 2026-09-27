import { useState, type FormEvent } from "react";
import { adminFetch, idempotencyKey, type ApiError } from "../../api";
import { DataTable } from "../../components/common/DataTable";
import { Heading } from "../../components/common/Heading";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { AdminRole, Staff } from "../../types";

interface StaffViewProps {
  items: Staff[];
  onReload: () => Promise<void>;
  loading: boolean;
}

export function StaffView({ items, onReload, loading }: StaffViewProps) {
  const { hasPermission } = useStaff();

  // Invite state
  const [email, setEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AdminRole>("SUPPORT");
  const [reason, setReason] = useState("");

  // Role change modal state
  const [roleTarget, setRoleTarget] = useState<Staff | null>(null);
  const [roleCode, setRoleCode] = useState<AdminRole>("SUPPORT");
  const [roleOperation, setRoleOperation] = useState<"GRANT" | "REVOKE">("GRANT");
  const [roleReason, setRoleReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [modalError, setModalError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const canManage =
    hasPermission("staff.invite.request") ||
    hasPermission("staff.role-change.request") ||
    hasPermission("staff.disable.request");

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (!email || !employeeCode || !displayName || !reason) return;

    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ action: { id: string } }>(
        "/admin/staff/invite-requests",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("staff-invite") },
          body: JSON.stringify({
            email: email.trim(),
            employeeCode: employeeCode.trim(),
            displayName: displayName.trim(),
            role,
            reasonCode: reason.trim(),
            ticketReference: "ADMIN-STAFF",
            description: "Admin Web staff invite",
          }),
        }
      );

      setSuccessNotice(
        `Đã tạo yêu cầu mời nhân viên ${displayName} (${email}) thành công (Mã: ${
          result.action?.id ?? "Mới"
        }). Chờ Control phê duyệt.`
      );
      setEmail("");
      setEmployeeCode("");
      setDisplayName("");
      setReason("");
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenRoleChange = (target: Staff) => {
    setRoleTarget(target);
    setRoleCode("SUPPORT");
    setRoleOperation("GRANT");
    setRoleReason("");
    setModalError(null);
  };

  const handleSubmitRoleChange = async (event: FormEvent) => {
    event.preventDefault();
    if (!roleTarget || !roleReason.trim()) return;

    setBusy(true);
    setModalError(null);
    try {
      const result = await adminFetch<{ action: { id: string } }>(
        `/admin/staff/${roleTarget.id}/role-change-requests`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("staff-role-change") },
          body: JSON.stringify({
            roleCode,
            operation: roleOperation,
            environmentScope: "preview",
            reasonCode: roleReason.trim(),
            ticketReference: "ADMIN-STAFF",
            description: "Admin Web role change",
          }),
        }
      );

      const targetName = roleTarget.displayName;
      setRoleTarget(null);
      setSuccessNotice(
        `Đã tạo yêu cầu đổi vai trò (${roleOperation} ${roleCode}) cho ${targetName} thành công (Mã: ${
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

  const handleDisableRequest = async (target: Staff) => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ action: { id: string } }>(
        `/admin/staff/${target.id}/disable-requests`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("staff-disable") },
          body: JSON.stringify({
            reasonCode: "STAFF_DISABLE_REVIEW",
            ticketReference: "ADMIN-STAFF",
            description: "Admin Web disable request",
          }),
        }
      );

      setSuccessNotice(
        `Đã tạo yêu cầu vô hiệu hóa nhân viên ${target.displayName} (Mã: ${
          result.action?.id ?? "Mới"
        }). Chờ Control phê duyệt.`
      );
      await onReload();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="staff-page">
      <Heading
        eyebrow="IDENTITY & RBAC"
        title="Staff và roles"
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

      <Notice error={error} retry={() => void onReload()} />
      {successNotice ? (
        <Notice type="success" onDismiss={() => setSuccessNotice(null)}>
          {successNotice}
        </Notice>
      ) : null}

      {canManage ? (
        <form className="panel stack" onSubmit={(event) => void handleInvite(event)}>
          <div className="panel-heading">
            <h2>Tạo yêu cầu mời nhân viên mới (Invite request)</h2>
          </div>
          <div className="form-grid">
            <label>
              Email nhân viên
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="staff@banking.reference"
                required
                disabled={busy}
              />
            </label>

            <label>
              Mã nhân viên (Employee code)
              <input
                value={employeeCode}
                onChange={(event) => setEmployeeCode(event.target.value)}
                placeholder="EMP-001"
                required
                disabled={busy}
              />
            </label>

            <label>
              Tên hiển thị (Display name)
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Nguyen Van A"
                required
                disabled={busy}
              />
            </label>

            <label>
              Vai trò (Role)
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as AdminRole)}
                disabled={busy}
              >
                <option value="SUPPORT">SUPPORT (Hỗ trợ khách hàng)</option>
                <option value="OPERATIONS">OPERATIONS (Vận hành tác nghiệp)</option>
                <option value="CONTROL">CONTROL (Kiểm soát / Phê duyệt)</option>
                <option value="ADMIN">ADMIN (Quản trị hệ thống)</option>
              </select>
            </label>

            <label className="full-width">
              Lý do mời nhân viên (Reason code)
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="NEW_STAFF_ONBOARDING"
                required
                disabled={busy}
              />
            </label>
          </div>

          <button className="primary" type="submit" disabled={busy || !email || !employeeCode}>
            {busy ? "Đang gửi…" : "Tạo invite request"}
          </button>
          <p className="warning">
            Invite token không hiển thị trực tiếp trong UI; liên kết kích hoạt sẽ được chuyển qua kênh phân phối bảo mật đã cấu hình.
          </p>
        </form>
      ) : null}

      {items.length === 0 ? (
        <div className="empty">Chưa có staff fixture trong dữ liệu thử nghiệm.</div>
      ) : (
        <DataTable>
          {items.map((item) => (
            <tr key={item.id}>
              <th>
                {item.displayName} · {item.employeeCode}
              </th>
              <td>
                <div className="staff-row-details">
                  <StatusBadge status={item.status} />
                  <span className="muted">
                    · {item.email} · Vai trò: {item.roles.map((r) => r.role).join(", ")} · MFA required
                  </span>

                  {canManage && item.status === "ACTIVE" ? (
                    <span className="button-row">
                      <button
                        className="secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => handleOpenRoleChange(item)}
                      >
                        Đổi role
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDisableRequest(item)}
                      >
                        Disable request
                      </button>
                    </span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {/* Role Change Modal */}
      {roleTarget ? (
        <div className="modal-backdrop">
          <form className="modal stack" onSubmit={(event) => void handleSubmitRoleChange(event)}>
            <div className="panel-heading">
              <h2>Role change request</h2>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => setRoleTarget(null)}
              >
                Đóng
              </button>
            </div>

            <div className="target-summary-box">
              <div>
                <b>Nhân viên:</b> {roleTarget.displayName} ({roleTarget.email})
              </div>
              <div>
                <b>Vai trò hiện tại:</b> {roleTarget.roles.map((r) => r.role).join(", ")}
              </div>
            </div>

            <Notice error={modalError} />

            <label>
              Vai trò (Role)
              <select
                value={roleCode}
                onChange={(event) => setRoleCode(event.target.value as AdminRole)}
                disabled={busy}
              >
                <option value="SUPPORT">SUPPORT</option>
                <option value="OPERATIONS">OPERATIONS</option>
                <option value="CONTROL">CONTROL</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>

            <label>
              Thao tác (Operation)
              <select
                value={roleOperation}
                onChange={(event) => setRoleOperation(event.target.value as "GRANT" | "REVOKE")}
                disabled={busy}
              >
                <option value="GRANT">GRANT (Cấp thêm vai trò)</option>
                <option value="REVOKE">REVOKE (Thu hồi vai trò)</option>
              </select>
            </label>

            <label>
              Reason code
              <input
                data-testid="staff-role-reason"
                value={roleReason}
                onChange={(event) => setRoleReason(event.target.value)}
                placeholder="STAFF_ROLE_UPDATE"
                required
                disabled={busy}
              />
            </label>

            <button
              className="primary"
              type="submit"
              disabled={busy || !roleReason.trim()}
            >
              {busy ? "Đang gửi…" : "Gửi yêu cầu đổi role"}
            </button>
          </form>
        </div>
      ) : null}

      <div className="notice info">
        Thay đổi role hoặc disable chỉ là request four-eyes; ADMIN không thể tự ý bypass bước phê duyệt của Control, và phiên làm việc cũ của nhân viên sẽ tự động bị vô hiệu hóa khi authorization_version thay đổi.
      </div>
    </section>
  );
}
