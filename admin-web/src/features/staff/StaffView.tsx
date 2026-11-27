import { useState, useEffect, useMemo, type FormEvent } from "react";
import { adminFetch, idempotencyKey, isIndeterminateError, type ApiError } from "../../api";
import { Heading } from "../../components/common/Heading";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { Action, Staff } from "../../types";

interface StaffViewProps {
  items: Staff[];
  onReload: () => Promise<void>;
  loading: boolean;
}

function removeVietnameseTones(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function generateStaffEmail(displayName: string, employeeCode: string): string {
  if (!displayName.trim()) return "";
  const clean = removeVietnameseTones(displayName.trim().toLowerCase())
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";

  const firstName = parts[parts.length - 1];
  const lastName = parts.length > 1 ? parts[0] : "";
  const codeSuffix = employeeCode.toLowerCase().replace(/[^a-z0-9]/g, "");

  const prefix = lastName ? `${firstName}.${lastName}.${codeSuffix}` : `${firstName}.${codeSuffix}`;
  return `${prefix}@bank.vn`;
}

function getNextEmployeeCode(items: Staff[]): string {
  let max = 0;
  for (const item of items) {
    const match = item.employeeCode?.match(/^EMP-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return `EMP-${String(max + 1).padStart(3, "0")}`;
}

const isFixtureStaff = (item: Staff) =>
  /fixture|restart lock|fraud note/i.test(item.displayName) ||
  /^[QWERNFSR]-\w+/.test(item.employeeCode);

export function StaffView({ items, onReload, loading }: StaffViewProps) {
  const { hasPermission, stepUpFreshUntil, setStepUpFreshUntil } = useStaff();

  // Direct Operations-account setup state
  const [email, setEmail] = useState("");
  const [isEmailCustomized, setIsEmailCustomized] = useState(false);
  const [employeeCode, setEmployeeCode] = useState(() => getNextEmployeeCode(items));
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [mfaSetup, setMfaSetup] = useState<{ manualSetupKey: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [createAccountKey, setCreateAccountKey] = useState(() => idempotencyKey("staff-operations-create"));
  const [createAccountIndeterminate, setCreateAccountIndeterminate] = useState(false);
  const [createAccountError, setCreateAccountError] = useState<string | null>(null);

  // Staff list filtering & pagination state
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Direct staff-disable confirmation + step-up MFA modal state (for ADMIN)
  const [disableTarget, setDisableTarget] = useState<Staff | null>(null);
  const [disableReason, setDisableReason] = useState("Admin Web direct disable");
  const [disableStepUpCode, setDisableStepUpCode] = useState("");
  const [disableModalError, setDisableModalError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!employeeCode || employeeCode === "EMP-001") {
      const next = getNextEmployeeCode(items);
      if (next !== employeeCode) {
        setEmployeeCode(next);
        if (!isEmailCustomized && displayName.trim()) {
          setEmail(generateStaffEmail(displayName, next));
        }
      }
    }
  }, [items, displayName, isEmailCustomized, employeeCode]);

  const realStaff = useMemo(() => {
    return items.filter((item) => !isFixtureStaff(item));
  }, [items]);

  const filteredStaff = useMemo(() => {
    if (!searchQuery.trim()) return realStaff;
    const q = searchQuery.trim().toLowerCase();
    return realStaff.filter(
      (item) =>
        item.displayName.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.employeeCode.toLowerCase().includes(q)
    );
  }, [realStaff, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageItems = filteredStaff.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
      setIsEmailCustomized(false);
      setDisplayName("");
      setPassword("");
      setPasswordConfirmation("");
      setMfaSetup(null);
      setMfaCode("");
      setCreateAccountKey(idempotencyKey("staff-operations-create"));
      setCreateAccountIndeterminate(false);
      setEmployeeCode(getNextEmployeeCode([...items, result.staff]));
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

  // Contract reference: /admin/staff/${id}/role-change-requests
  // (Hệ thống áp dụng kiến trúc 1 Root Admin duy nhất + các tài khoản Operations)

  const canDirectDisable = hasPermission("staff.disable.approve");
  const isStepUpFresh = Date.now() < stepUpFreshUntil;

  const closeDisableModal = () => {
    if (busy) return;
    setDisableTarget(null);
    setDisableReason("Admin Web direct disable");
    setDisableStepUpCode("");
    setDisableModalError(null);
  };

  const handleDisableRequest = async (target: Staff) => {
    if (canDirectDisable) {
      setDisableTarget(target);
      setDisableReason("Admin Web direct disable");
      setDisableStepUpCode("");
      setDisableModalError(null);
      return;
    }

    if (!window.confirm(`Bạn có chắc chắn muốn gửi yêu cầu khóa tài khoản của ${target.displayName} (${target.employeeCode})?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ action: Action }>(
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
        result.action?.status === "SUCCEEDED"
          ? `Đã vô hiệu hóa tài khoản nhân viên ${target.displayName} (${target.employeeCode}) thành công.`
          : `Đã tạo yêu cầu vô hiệu hóa nhân viên ${target.displayName} (Mã: ${
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

  const handleConfirmDirectDisable = async (event: FormEvent) => {
    event.preventDefault();
    if (!disableTarget) return;
    const fresh = Date.now() < stepUpFreshUntil;
    if (!fresh && !/^\d{6}$/.test(disableStepUpCode.trim())) {
      return;
    }

    setBusy(true);
    setDisableModalError(null);
    setError(null);
    try {
      if (!fresh) {
        await adminFetch("/admin/auth/step-up", {
          method: "POST",
          body: JSON.stringify({ code: disableStepUpCode.trim() }),
        });
        setStepUpFreshUntil(Date.now() + 5 * 60 * 1000);
      }

      const result = await adminFetch<{ action: Action }>(
        `/admin/staff/${disableTarget.id}/disable-requests`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("staff-disable") },
          body: JSON.stringify({
            reasonCode: "STAFF_DISABLE_REVIEW",
            ticketReference: "ADMIN-STAFF",
            description: disableReason.trim() || "Admin Web direct disable",
          }),
        }
      );

      const targetName = disableTarget.displayName;
      const targetCode = disableTarget.employeeCode;
      setDisableTarget(null);
      setDisableStepUpCode("");
      setDisableReason("Admin Web direct disable");

      setSuccessNotice(
        result.action?.status === "SUCCEEDED"
          ? `Đã vô hiệu hóa tài khoản nhân viên ${targetName} (${targetCode}) thành công.`
          : `Đã tạo yêu cầu vô hiệu hóa nhân viên ${targetName} (Mã: ${
              result.action?.id ?? "Mới"
            }). Chờ phê duyệt trong Approval Inbox.`
      );
      await onReload();
    } catch (caught) {
      setDisableModalError(caught as ApiError);
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
              Tên hiển thị (Họ và tên nhân viên) *
              <input
                value={displayName}
                onChange={(event) => {
                  const newName = event.target.value;
                  setDisplayName(newName);
                  if (!isEmailCustomized) {
                    setEmail(generateStaffEmail(newName, employeeCode));
                  }
                  if (!createAccountIndeterminate) setCreateAccountKey(idempotencyKey("staff-operations-create"));
                }}
                placeholder="Ví dụ: Nguyễn Cao Kỳ"
                minLength={2}
                maxLength={120}
                required
                disabled={busy || createAccountIndeterminate}
              />
            </label>

            <label>
              Mã nhân viên (Hệ thống tự cấp)
              <input
                value={employeeCode}
                readOnly
                style={{
                  background: "#f1f5f9",
                  color: "var(--color-primary)",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  cursor: "not-allowed",
                }}
                title="Mã nhân viên được hệ thống tự động cấp theo thứ tự tăng dần (không thể sửa)"
              />
            </label>

            <label style={{ gridColumn: "1 / -1" }}>
              Tài khoản đăng nhập (Định danh chuẩn nội bộ @bank.vn) *
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
                <input
                  value={email}
                  onChange={(event) => {
                    setIsEmailCustomized(true);
                    setEmail(event.target.value);
                    if (!createAccountIndeterminate) {
                      setMfaSetup(null);
                      setMfaCode("");
                      setCreateAccountKey(idempotencyKey("staff-operations-create"));
                    }
                  }}
                  type="email"
                  placeholder="ky.nguyen.emp001@bank.vn"
                  required
                  disabled={busy || createAccountIndeterminate}
                  style={{
                    flex: 1,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    color: "var(--color-primary)",
                    background: isEmailCustomized ? "var(--color-bg)" : "#f8fafc",
                  }}
                />
                {displayName.trim() && (
                  <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: "0.8rem", padding: "6px 12px", whiteSpace: "nowrap" }}
                    onClick={() => {
                      setIsEmailCustomized(false);
                      const stdEmail = generateStaffEmail(displayName, employeeCode);
                      setEmail(stdEmail);
                      if (!createAccountIndeterminate) {
                        setMfaSetup(null);
                        setMfaCode("");
                        setCreateAccountKey(idempotencyKey("staff-operations-create"));
                      }
                    }}
                    title="Tự động tạo lại theo cú pháp chuẩn của ngân hàng"
                  >
                    🔄 Chuẩn hóa lại
                  </button>
                )}
              </div>
              <small style={{ color: "var(--color-text-muted)", marginTop: "4px", display: "block" }}>
                Định danh chuẩn ngân hàng: <code>[tên].[họ].[mã_số]@bank.vn</code>. Hệ thống tự động sinh theo Họ tên và Mã NV để chống giả mạo và không dùng email cá nhân bên ngoài.
              </small>
            </label>

            <label>
              Mật khẩu ban đầu (tối thiểu 12 ký tự) *
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
              Nhập lại mật khẩu *
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

      <div style={{ marginTop: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>Danh sách nhân sự</span>
              <span style={{ fontSize: "0.8rem", padding: "2px 8px", background: "var(--color-secondary-bg)", color: "var(--color-primary)", borderRadius: "12px", fontWeight: 700 }}>
                {realStaff.length} nhân sự
              </span>
            </h2>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.82rem" }}>
              Quản lý danh tính, phân quyền vai trò và tình trạng xác thực 2 lớp (MFA) của nhân sự.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <input
              type="text"
              placeholder="🔍 Tìm nhân sự (Tên, Email, Mã NV)…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              style={{ padding: "6px 12px", fontSize: "0.82rem", borderRadius: "8px", border: "1px solid var(--color-border)", minWidth: "260px" }}
            />
          </div>
        </div>

        {filteredStaff.length === 0 ? (
          <div className="empty">
            {realStaff.length === 0
              ? "Chưa có nhân sự nào trong hệ thống."
              : "Không tìm thấy nhân viên nào phù hợp với bộ lọc tìm kiếm."}
          </div>
        ) : (
          <>
            <div className="audit-table-wrapper">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th style={{ width: "140px" }}>Mã NV</th>
                    <th>Nhân viên</th>
                    <th style={{ width: "150px" }}>Vai trò (Role)</th>
                    <th style={{ width: "120px" }}>Trạng thái</th>
                    <th style={{ width: "180px" }}>Xác thực 2 lớp (MFA)</th>
                    {canManage ? <th style={{ width: "180px", textAlign: "right" }}>Thao tác</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => {
                    return (
                      <tr key={item.id}>
                        <td>
                          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--color-primary)", fontSize: "0.85rem" }}>
                            {item.employeeCode}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <div style={{ fontWeight: 600, color: "var(--color-text-main)" }}>
                              {item.displayName}
                            </div>
                            <div style={{ fontSize: "0.76rem", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                              {item.email}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                            {Array.from(new Set(item.roles.map((r) => r.role))).map((role) => (
                              <span
                                key={role}
                                className={`audit-actor-badge ${role.toLowerCase()}`}
                                style={{ fontSize: "0.72rem" }}
                              >
                                {role}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={item.status} />
                        </td>
                        <td>
                          <span style={{ fontSize: "0.8rem", color: item.mfaEnrolled ? "var(--color-success)" : "var(--color-text-muted)", fontWeight: 500 }}>
                            {item.mfaEnrolled ? "● Đã kích hoạt" : "○ Chưa cấu hình"}
                          </span>
                        </td>
                        {canManage ? (
                          <td style={{ textAlign: "right" }}>
                            {item.roles.some((r) => r.role === "ADMIN") ? (
                              <span className="muted" style={{ fontSize: "0.78rem" }} title="Tài khoản quản trị tối cao">
                                Root Admin
                              </span>
                            ) : item.status === "ACTIVE" ? (
                              <button
                                className="secondary"
                                type="button"
                                style={{ padding: "4px 8px", fontSize: "0.78rem", color: "var(--color-danger)" }}
                                disabled={busy}
                                onClick={() => void handleDisableRequest(item)}
                              >
                                Khóa
                              </button>
                            ) : (
                              <span className="muted" style={{ fontSize: "0.78rem" }}>—</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", fontSize: "0.84rem", color: "var(--color-text-muted)" }}>
                <div>
                  Hiển thị {(safePage - 1) * PAGE_SIZE + 1} - {Math.min(safePage * PAGE_SIZE, filteredStaff.length)} trong tổng số {filteredStaff.length} nhân sự
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
              <div style={{ textAlign: "right", fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "6px" }}>
                Tổng cộng: {filteredStaff.length} nhân sự
              </div>
            )}
          </>
        )}
      </div>

      <div className="notice info">
        Tài khoản Operations tạo tại đây hoạt động ngay. Với quyền Admin, khi bấm Khóa và xác thực mã TOTP Step-up, hệ thống sẽ vô hiệu hóa nhân sự trực tiếp ngay lập tức (hoặc tạo yêu cầu trong Approval Inbox nếu tắt thực thi trực tiếp).
      </div>

      {disableTarget ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="disable-staff-title" style={{ maxWidth: "520px" }}>
            <div className="panel-heading" style={{ marginBottom: "14px" }}>
              <div>
                <div style={{ fontSize: "0.78rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                  IDENTITY & RBAC · STAFF_DISABLE
                </div>
                <h2 id="disable-staff-title" style={{ margin: "4px 0 0 0", fontSize: "1.2rem", color: "#0f172a" }}>
                  🚫 Khóa tài khoản nhân sự
                </h2>
              </div>
              <button type="button" className="ghost" disabled={busy} onClick={closeDisableModal}>
                Đóng
              </button>
            </div>

            <Notice error={disableModalError} />

            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px", marginBottom: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>
                {disableTarget.displayName} ({disableTarget.employeeCode})
              </div>
              <div style={{ fontSize: "0.82rem", color: "#64748b", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                {disableTarget.email}
              </div>
            </div>

            <form className="stack" onSubmit={(event) => void handleConfirmDirectDisable(event)}>
              <label>
                Lý do khóa tài khoản
                <input
                  value={disableReason}
                  onChange={(event) => setDisableReason(event.target.value)}
                  placeholder="Ví dụ: Nhân sự nghỉ việc / thu hồi quyền"
                  maxLength={240}
                  disabled={busy}
                />
              </label>

              {!isStepUpFresh ? (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "12px" }}>
                  <label style={{ margin: 0 }}>
                    <span style={{ fontWeight: 700, color: "#1e40af", display: "block", marginBottom: "6px" }}>
                      🔑 Mã TOTP Step-up (6 số từ Authenticator):
                    </span>
                    <input
                      data-testid="staff-disable-step-up"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      autoComplete="one-time-code"
                      value={disableStepUpCode}
                      onChange={(event) => setDisableStepUpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="123456"
                      required
                      disabled={busy}
                      autoFocus
                      style={{ fontSize: "1.25rem", letterSpacing: "0.25em", textAlign: "center", fontWeight: 700, background: "#fff" }}
                    />
                  </label>
                </div>
              ) : (
                <div className="notice info" style={{ margin: 0 }}>
                  Phiên Step-up MFA của bạn còn hiệu lực — bấm xác nhận để khóa ngay lập tức.
                </div>
              )}

              <div className="button-row" style={{ marginTop: "8px" }}>
                <button
                  type="submit"
                  className="primary"
                  style={{ background: "var(--color-danger)", borderColor: "var(--color-danger)" }}
                  disabled={busy || (!isStepUpFresh && !/^\d{6}$/.test(disableStepUpCode.trim()))}
                >
                  {busy ? "Đang khóa…" : "Xác nhận khóa ngay"}
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={closeDisableModal}>
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
