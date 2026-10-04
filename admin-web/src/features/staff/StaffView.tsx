import { useState, type FormEvent } from "react";
import { adminFetch, idempotencyKey, isIndeterminateError, type ApiError } from "../../api";
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

  // Direct Operations-account setup state
  const [email, setEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [mfaSetup, setMfaSetup] = useState<{ manualSetupKey: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [createAccountKey, setCreateAccountKey] = useState(() => idempotencyKey("staff-operations-create"));
  const [createAccountIndeterminate, setCreateAccountIndeterminate] = useState(false);
  const [createAccountError, setCreateAccountError] = useState<string | null>(null);

  // Role change modal state
  const [roleTarget, setRoleTarget] = useState<Staff | null>(null);
  const [roleCode, setRoleCode] = useState<AdminRole>("OPERATIONS");
  const [roleOperation, setRoleOperation] = useState<"GRANT" | "REVOKE">("GRANT");
  const [roleReason, setRoleReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [modalError, setModalError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const canManage =
    hasPermission("staff.operations-account.create") ||
    hasPermission("staff.role-change.request") ||
    hasPermission("staff.disable.request");

  const handleMfaSetup = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    setCreateAccountError(null);
    try {
      const result = await adminFetch<{ mfaSetup: { manualSetupKey: string } }>(
        "/admin/staff/operations-accounts/mfa-setup",
        {
          method: "POST",
          body: JSON.stringify({ email: email.trim() }),
        }
      );
      setMfaSetup(result.mfaSetup);
      setMfaCode("");
      setCreateAccountKey(idempotencyKey("staff-operations-create"));
      setCreateAccountIndeterminate(false);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateOperationsAccount = async (event: FormEvent) => {
    event.preventDefault();
    setCreateAccountError(null);
    if (!mfaSetup) {
      setCreateAccountError("Hãy tạo khóa MFA và thêm khóa đó vào ứng dụng Authenticator trước.");
      return;
    }
    if (password !== passwordConfirmation) {
      setCreateAccountError("Mật khẩu xác nhận chưa khớp.");
      return;
    }
    if (!/^\d{6}$/.test(mfaCode)) {
      setCreateAccountError("Nhập mã Authenticator gồm 6 chữ số.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ staff: Staff; replayed: boolean }>(
        "/admin/staff/operations-accounts",
        {
          method: "POST",
          headers: { "Idempotency-Key": createAccountKey },
          body: JSON.stringify({
            email: email.trim(),
            employeeCode: employeeCode.trim(),
            displayName: displayName.trim(),
            password,
            mfaSecret: mfaSetup.manualSetupKey,
            mfaCode,
          }),
        }
      );

      setSuccessNotice(
        `Đã tạo tài khoản OPERATIONS cho ${result.staff.displayName} (${result.staff.email}); mật khẩu và MFA đã được thiết lập${result.replayed ? " ở lần gửi trước" : ""}.`
      );
      setEmail("");
      setEmployeeCode("");
      setDisplayName("");
      setPassword("");
      setPasswordConfirmation("");
      setMfaSetup(null);
      setMfaCode("");
      setCreateAccountKey(idempotencyKey("staff-operations-create"));
      setCreateAccountIndeterminate(false);
      try {
        await onReload();
      } catch (caught) {
        setError(caught as ApiError);
      }
    } catch (caught) {
      setError(caught as ApiError);
      const apiError = caught as ApiError;
      setCreateAccountIndeterminate(isIndeterminateError(caught) || apiError.code === "IDEMPOTENCY_CONFLICT");
    } finally {
      setBusy(false);
    }
  };

  const handleOpenRoleChange = (target: Staff) => {
    setRoleTarget(target);
    setRoleCode("OPERATIONS");
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
        }). Chờ ADMIN phê duyệt.`
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
        }). Chờ ADMIN phê duyệt.`
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
        <form className="panel stack" onSubmit={(event) => void handleCreateOperationsAccount(event)}>
          <div className="panel-heading">
            <h2>Tạo tài khoản Operations</h2>
          </div>
          <p className="muted">
            Tài khoản được kích hoạt ngay sau khi Admin thiết lập mật khẩu và xác minh mã Authenticator. Không cần email mời hoặc duyệt trong Approval Inbox.
          </p>
          <div className="form-grid">
            <label>
              Email đăng nhập
              <input
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (!createAccountIndeterminate) {
                    setMfaSetup(null);
                    setMfaCode("");
                    setCreateAccountKey(idempotencyKey("staff-operations-create"));
                  }
                }}
                type="email"
                placeholder="operations@example.test"
                required
                disabled={busy || createAccountIndeterminate}
              />
            </label>

            <label>
              Mã nhân viên
              <input
                value={employeeCode}
                onChange={(event) => {
                  setEmployeeCode(event.target.value);
                  if (!createAccountIndeterminate) setCreateAccountKey(idempotencyKey("staff-operations-create"));
                }}
                placeholder="EMP-001"
                minLength={2}
                maxLength={64}
                pattern="[A-Za-z0-9._-]{2,64}"
                required
                disabled={busy || createAccountIndeterminate}
              />
            </label>

            <label>
              Tên hiển thị
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  if (!createAccountIndeterminate) setCreateAccountKey(idempotencyKey("staff-operations-create"));
                }}
                placeholder="Nguyen Van A"
                minLength={2}
                maxLength={120}
                required
                disabled={busy || createAccountIndeterminate}
              />
            </label>

            <label>
              Vai trò
              <input value="OPERATIONS · Vận hành nghiệp vụ và hỗ trợ" readOnly />
            </label>

            <label>
              Mật khẩu ban đầu (tối thiểu 12 ký tự)
              <input
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (!createAccountIndeterminate) setCreateAccountKey(idempotencyKey("staff-operations-create"));
                }}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
                disabled={busy || createAccountIndeterminate}
              />
            </label>

            <label>
              Nhập lại mật khẩu
              <input
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
                disabled={busy || createAccountIndeterminate}
              />
            </label>
          </div>

          <div className="button-row">
            <button
              className="secondary"
              type="button"
              onClick={() => void handleMfaSetup()}
              disabled={busy || createAccountIndeterminate || !email.trim()}
              data-testid="generate-operations-mfa"
            >
              {busy ? "Đang chuẩn bị…" : mfaSetup ? "Tạo khóa MFA mới" : "Tạo khóa MFA"}
            </button>
          </div>

          {mfaSetup ? (
            <div className="target-summary-box" data-testid="operations-mfa-setup">
              <b>Khóa cài Authenticator</b>
              <p>Mở ứng dụng Authenticator, chọn thêm tài khoản bằng khóa thiết lập, rồi nhập khóa dưới đây.</p>
              <code>{mfaSetup.manualSetupKey}</code>
              <p className="muted">Khóa này chỉ hiển thị trong lúc tạo tài khoản. Sau khi lưu, hệ thống chỉ giữ khóa đã mã hóa.</p>
            </div>
          ) : null}

          <label>
            Mã Authenticator 6 số để xác minh thiết lập
            <input
              data-testid="operations-mfa-code"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              disabled={busy || !mfaSetup}
            />
          </label>

          {createAccountError ? <div className="notice error" role="alert">{createAccountError}</div> : null}
          {createAccountIndeterminate ? (
            <p className="warning" role="status">
              Kết quả lần gửi trước chưa xác định. Hãy giữ nguyên thông tin và khóa MFA; nhập mã Authenticator hiện tại rồi thử lại. Khóa yêu cầu được giữ nguyên để không tạo tài khoản trùng.
            </p>
          ) : null}

          <button className="primary" type="submit" disabled={busy || !mfaSetup || !email || !employeeCode || !displayName || password.length < 12 || password !== passwordConfirmation || !/^\d{6}$/.test(mfaCode)}>
            {busy ? "Đang tạo tài khoản…" : createAccountIndeterminate ? "Thử lại an toàn" : "Tạo tài khoản Operations"}
          </button>
          <p className="warning">
            Ghi lại mật khẩu ban đầu để bàn giao an toàn cho nhân viên. Admin Web không gửi mật khẩu hoặc mã MFA qua email.
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
                    · {item.email} · Vai trò: {item.roles.map((r) => r.role).join(", ")} · {item.mfaEnrolled ? "Authenticator đã cấu hình" : "Authenticator chưa cấu hình"}
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
                <option value="OPERATIONS">OPERATIONS</option>
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
        Tài khoản Operations tạo tại đây hoạt động ngay. Thay đổi role hoặc vô hiệu hóa tài khoản hiện có vẫn tạo yêu cầu trong Approval Inbox; phiên cũ sẽ bị vô hiệu hóa khi quyền thay đổi.
      </div>
    </section>
  );
}
