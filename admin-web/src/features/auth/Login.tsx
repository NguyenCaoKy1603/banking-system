import { useState, type FormEvent } from "react";
import { adminFetch, type ApiError } from "../../api";
import { Notice } from "../../components/common/Notice";
import { useStaff } from "../../context/StaffContext";
import type { Staff } from "../../types";

interface LoginProps {
  onLoggedIn: (staff: Staff, permissions?: string[]) => void;
}

export function Login({ onLoggedIn }: LoginProps) {
  const { ensureLoggedOut } = useStaff();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (ensureLoggedOut) {
        await ensureLoggedOut();
      }
      const result = await adminFetch<
        | { mfaRequired: true; challengeId: string }
        | { mfaRequired: false; staff: Staff; csrfToken: string; permissions?: string[] }
      >("/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (result.mfaRequired) {
        setChallengeId(result.challengeId);
      } else {
        try {
          const me = await adminFetch<{ staff: Staff; permissions?: string[] }>("/admin/me");
          onLoggedIn(me.staff, me.permissions ?? result.permissions);
        } catch {
          onLoggedIn(result.staff, result.permissions);
        }
      }
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ staff: Staff; csrfToken: string; permissions?: string[] }>(
        "/admin/auth/mfa/verify",
        {
          method: "POST",
          body: JSON.stringify({ challengeId, code: code.trim() }),
        }
      );
      // Fetch fresh /admin/me to obtain full resolved permissions
      try {
        const me = await adminFetch<{ staff: Staff; permissions?: string[] }>("/admin/me");
        onLoggedIn(me.staff, me.permissions ?? result.permissions);
      } catch {
        onLoggedIn(result.staff, result.permissions);
      }
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">CONTROL PLANE · VIRTUAL MONEY</p>
        <h1>Đăng nhập quản trị</h1>
        <p className="muted">
          Operations đăng nhập bằng email và mật khẩu sau khi Authenticator được xác minh lúc tạo tài khoản. Admin cần thêm mã TOTP khi đăng nhập.
        </p>

        <Notice error={error} context="auth" />

        {!challengeId ? (
          <form onSubmit={(e) => void handleLogin(e)} className="stack">
            <label>
              Email nhân viên (Staff Email)
              <input
                data-testid="staff-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="staff@banking.reference"
                required
                disabled={busy}
              />
            </label>
            <label>
              Mật khẩu (Password)
              <input
                data-testid="staff-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <button className="primary" type="submit" disabled={busy || !email || !password}>
              {busy ? "Đang kiểm tra…" : "Đăng nhập"}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleVerify(e)} className="stack">
            <div className="notice info">
              Tài khoản Admin cần xác minh thêm mã 6 chữ số từ ứng dụng Authenticator.
            </div>
            <label>
              Mã Authenticator (MFA Code)
              <input
                data-testid="staff-mfa"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                required
                disabled={busy}
                autoFocus
              />
            </label>
            <button className="primary" type="submit" disabled={busy || code.trim().length !== 6}>
              {busy ? "Đang xác thực…" : "Xác thực và vào Admin"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                setChallengeId("");
                setCode("");
                setError(null);
              }}
            >
              Quay lại đăng nhập bằng mật khẩu
            </button>
          </form>
        )}

        <p className="legal">
          Hệ thống tham chiếu phục vụ học tập &amp; nghiên cứu — không kết nối tiền thật hoặc hạ tầng ngân hàng thương mại.
        </p>
      </section>
    </main>
  );
}
