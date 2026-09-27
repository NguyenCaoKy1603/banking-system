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
      const result = await adminFetch<{ challengeId: string }>("/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setChallengeId(result.challengeId);
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
      if (ensureLoggedOut) {
        await ensureLoggedOut();
      }
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
          Phiên nhân viên độc lập với ứng dụng khách hàng. Xác thực đa yếu tố (MFA TOTP) là bắt buộc.
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
              {busy ? "Đang kiểm tra…" : "Tiếp tục với MFA"}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleVerify(e)} className="stack">
            <div className="notice info">
              Thử thách đăng nhập đã được khởi tạo. Nhập mã OTP 6 chữ số từ ứng dụng Authenticator của bạn.
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
