import { useState, type FormEvent } from "react";
import { adminFetch, type ApiError } from "../../api";
import { Notice } from "../../components/common/Notice";

export function Activation() {
  const [inviteToken] = useState(
    () => new URL(window.location.href).searchParams.get("token") ?? ""
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    staffId: string;
    mfaSetup?: { secret: string; otpauthUri: string };
  } | null>(null);

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!inviteToken) {
      setError(
        Object.assign(new Error("Liên kết kích hoạt không hợp lệ hoặc đã hết hạn."), {
          status: 401,
        }) as ApiError
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(new Error("Hai lần nhập mật khẩu không khớp.") as ApiError);
      return;
    }

    setBusy(true);
    try {
      const activated = await adminFetch<{
        staffId: string;
        mfaSetup?: { secret: string; otpauthUri: string };
      }>("/admin/auth/activate", {
        method: "POST",
        body: JSON.stringify({
          inviteToken,
          password,
          totpSecret: totpSecret.trim(),
        }),
      });

      setResult(activated);
      // Do not leave a one-time invitation token in browser history after use.
      window.history.replaceState({}, document.title, "/admin/activate");
      setPassword("");
      setConfirmPassword("");
      setTotpSecret("");
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">STAFF INVITATION · LOCAL PREVIEW</p>
        <h1>Kích hoạt tài khoản staff</h1>
        <p className="muted">
          Đặt mật khẩu và đăng ký TOTP trước khi đăng nhập. Liên kết này chỉ dùng một lần.
        </p>

        <Notice error={error} context="activation" />

        {result ? (
          <div className="stack">
            <div className="notice info">
              Kích hoạt thành công. Bạn có thể quay lại trang đăng nhập Admin Web.
            </div>
            {result.mfaSetup ? (
              <div className="panel stack">
                <strong>Lưu khóa TOTP vào Authenticator</strong>
                <p className="muted">
                  Khóa chỉ hiển thị lần này. Không chia sẻ khóa với người khác.
                </p>
                <code data-testid="mfa-setup-secret">{result.mfaSetup.secret}</code>
                <a href={result.mfaSetup.otpauthUri} className="link-button">
                  Mở liên kết otpauth
                </a>
              </div>
            ) : (
              <p className="notice info">MFA TOTP đã được lưu theo khóa bạn cung cấp.</p>
            )}
            <a className="primary button-link" href="/">
              Đến trang đăng nhập
            </a>
          </div>
        ) : inviteToken ? (
          <form onSubmit={(event) => void activate(event)} className="stack">
            <label>
              Mật khẩu mới (tối thiểu 12 ký tự)
              <input
                data-testid="activation-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label>
              Nhập lại mật khẩu
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label>
              Khóa TOTP (tùy chọn)
              <input
                data-testid="activation-totp"
                type="text"
                autoComplete="off"
                value={totpSecret}
                onChange={(event) => setTotpSecret(event.target.value)}
                placeholder="Để trống để server tạo khóa một lần"
                disabled={busy}
              />
            </label>
            <p className="muted">
              Nếu để trống, server sẽ hiển thị khóa TOTP sau khi kích hoạt để bạn nhập thủ công vào Google Authenticator hoặc Microsoft Authenticator.
            </p>
            <button className="primary" type="submit" disabled={busy || !password || !confirmPassword}>
              {busy ? "Đang kích hoạt…" : "Kích hoạt tài khoản"}
            </button>
          </form>
        ) : (
          <div className="notice error">Liên kết kích hoạt không hợp lệ hoặc đã hết hạn.</div>
        )}
      </section>
    </main>
  );
}
