import { useEffect, useState } from "react";
import { adminFetch, formatDate, formatMinor, type ApiError } from "../../api";
import { Heading } from "../../components/common/Heading";
import { Notice } from "../../components/common/Notice";
import { useStaff } from "../../context/StaffContext";
import type { AdminControlPolicy, LedgerReconciliation } from "../../types";

interface PolicyViewProps {
  policy: AdminControlPolicy | null;
  reconciliation: LedgerReconciliation | null;
  onReload: () => Promise<void>;
  loading: boolean;
}

export function PolicyView({ policy, reconciliation, onReload, loading }: PolicyViewProps) {
  const { canReadApprovals, stepUpFreshUntil, setStepUpFreshUntil } = useStaff();
  const [globalKillSwitch, setGlobalKillSwitch] = useState(false);
  const [transfersEnabled, setTransfersEnabled] = useState(true);
  const [maxTransferAmountMinor, setMaxTransferAmountMinor] = useState("50000000");
  const [dailyTransferLimitMinor, setDailyTransferLimitMinor] = useState("50000000");
  const [transferFeeMinor, setTransferFeeMinor] = useState("1000");
  const [savingsEnabled, setSavingsEnabled] = useState(true);
  const [creditEnabled, setCreditEnabled] = useState(true);
  const [reasonCode, setReasonCode] = useState("ADMIN_POLICY_ADJUSTMENT");
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpCode, setStepUpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!policy) return;
    setGlobalKillSwitch(policy.globalKillSwitch);
    setTransfersEnabled(policy.transfersEnabled);
    setMaxTransferAmountMinor(policy.maxTransferAmountMinor);
    setDailyTransferLimitMinor(policy.dailyTransferLimitMinor);
    setTransferFeeMinor(policy.transferFeeMinor);
    setSavingsEnabled(policy.savingsEnabled);
    setCreditEnabled(policy.creditEnabled);
  }, [policy]);

  if (!canReadApprovals) {
    return (
      <section className="policy-page">
        <Heading eyebrow="GOVERNANCE" title="Chính sách & Biểu phí" />
        <div className="notice info">Chỉ vai trò ADMIN mới được phép xem và thay đổi cấu hình chính sách hệ thống.</div>
      </section>
    );
  }

  const handleSave = async () => {
    const fresh = Date.now() < stepUpFreshUntil;
    if (!fresh && !stepUpCode.trim()) {
      setStepUpOpen(true);
      return;
    }

    setBusy(true);
    setError(null);
    setSuccessNotice(null);
    try {
      if (!fresh) {
        await adminFetch("/admin/auth/step-up", {
          method: "POST",
          body: JSON.stringify({ code: stepUpCode.trim() }),
        });
        setStepUpFreshUntil(Date.now() + 5 * 60 * 1000);
      }

      const result = await adminFetch<{ policy: AdminControlPolicy }>("/admin/control-policy", {
        method: "PATCH",
        body: JSON.stringify({
          globalKillSwitch,
          transfersEnabled,
          maxTransferAmountMinor: maxTransferAmountMinor.trim(),
          dailyTransferLimitMinor: dailyTransferLimitMinor.trim(),
          transferFeeMinor: transferFeeMinor.trim(),
          savingsEnabled,
          creditEnabled,
          reasonCode: reasonCode.trim() || "ADMIN_POLICY_ADJUSTMENT",
        }),
      });
      setStepUpOpen(false);
      setStepUpCode("");
      setSuccessNotice(
        `Đã cập nhật chính sách vận hành (phiên bản v${result.policy.configVersion}). Nhật ký kiểm toán CONTROL_POLICY_UPDATED đã được ghi nhận.`,
      );
      await onReload();
    } catch (caught) {
      const apiErr = caught as ApiError;
      if (apiErr.code === "STAFF_MFA_REQUIRED") {
        setStepUpOpen(true);
      }
      setError(apiErr);
    } finally {
      setBusy(false);
    }
  };

  const isBalanced = reconciliation?.status === "BALANCED";

  return (
    <section className="policy-page">
      <Heading
        eyebrow="GOVERNANCE & LEDGER"
        title="Chính sách vận hành & Đối soát Sổ cái"
        actions={
          <button type="button" className="secondary" disabled={loading || busy} onClick={() => void onReload()}>
            {loading ? "Đang tải…" : "Làm mới dữ liệu"}
          </button>
        }
      />

      <Notice error={error} retry={() => void onReload()} />
      {successNotice ? (
        <Notice type="success" onDismiss={() => setSuccessNotice(null)}>
          {successNotice}
        </Notice>
      ) : null}

      <section className="panel" data-testid="ledger-reconciliation-panel">
        <div className="panel-heading">
          <h2>Đối soát Sổ cái kép (Trial Balance Reconciliation)</h2>
          <strong style={{ color: reconciliation ? (isBalanced ? "#15803d" : "#b91c1c") : undefined }}>
            {reconciliation ? reconciliation.status : "Đang tải…"}
          </strong>
        </div>
        {reconciliation ? (
          <div className="metric-grid">
            <article className="metric-card">
              <span>Journal bị lệch (Nợ ≠ Có)</span>
              <strong className={reconciliation.unbalancedJournalCount > 0 ? "danger-text" : ""}>
                {reconciliation.unbalancedJournalCount} / {reconciliation.totalJournalsChecked}
              </strong>
              <small>Kiểm tra lúc {formatDate(reconciliation.checkedAt)}</small>
            </article>
            <article className="metric-card">
              <span>Tổng số dư Payment Accounts</span>
              <strong>{formatMinor(reconciliation.paymentAccountsTotalMinor)}</strong>
              <small>SUM(current_minor)</small>
            </article>
            <article className="metric-card">
              <span>Tổng ròng Sổ cái (payment-account:*)</span>
              <strong>{formatMinor(reconciliation.ledgerPaymentAccountsNetMinor)}</strong>
              <small>SUM(CREDIT) − SUM(DEBIT)</small>
            </article>
            <article className="metric-card">
              <span>Độ lệch đối soát</span>
              <strong className={reconciliation.discrepancyMinor !== "0" ? "danger-text" : ""}>
                {formatMinor(reconciliation.discrepancyMinor)}
              </strong>
              <small>{isBalanced ? "Sổ cái cân bằng 100%" : "Phát hiện sai lệch cần điều tra"}</small>
            </article>
          </div>
        ) : null}
      </section>

      <section className="panel" data-testid="control-policy-panel">
        <div className="panel-heading">
          <h2>Cấu hình Chính sách & Biểu phí</h2>
          <span>Phiên bản v{policy?.configVersion ?? "—"}</span>
        </div>

        <div className="form-grid" style={{ display: "grid", gap: "12px", maxWidth: "680px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={globalKillSwitch}
              onChange={(event) => setGlobalKillSwitch(event.target.checked)}
            />
            <strong>Global Kill-Switch</strong> (Tạm ngưng toàn bộ giao dịch tài chính khẩn cấp)
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={transfersEnabled}
              onChange={(event) => setTransfersEnabled(event.target.checked)}
            />
            Bật chuyển tiền (`transfers_enabled`)
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={savingsEnabled}
              onChange={(event) => setSavingsEnabled(event.target.checked)}
            />
            Bật gửi tiết kiệm (`savings_enabled`)
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={creditEnabled}
              onChange={(event) => setCreditEnabled(event.target.checked)}
            />
            Bật đăng ký tín dụng (`credit_enabled`)
          </label>

          <label>
            Hạn mức mỗi giao dịch chuyển tiền (VND minor)
            <input
              type="text"
              value={maxTransferAmountMinor}
              onChange={(event) => setMaxTransferAmountMinor(event.target.value)}
            />
          </label>

          <label>
            Tổng hạn mức chuyển tiền trong ngày (VND minor)
            <input
              type="text"
              value={dailyTransferLimitMinor}
              onChange={(event) => setDailyTransferLimitMinor(event.target.value)}
            />
          </label>

          <label>
            Phí chuyển tiền mặc định (VND minor)
            <input
              type="text"
              value={transferFeeMinor}
              onChange={(event) => setTransferFeeMinor(event.target.value)}
            />
          </label>

          <label>
            Mã lý do thay đổi (Audit Reason Code)
            <input
              type="text"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
            />
          </label>

          {stepUpOpen ? (
            <div data-testid="step-up-mfa" style={{ padding: "12px", border: "1px solid #cbd5e1", borderRadius: "8px" }}>
              <label>
                Mã TOTP xác thực Step-up MFA (6 chữ số)
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Nhập mã TOTP 6 chữ số"
                  value={stepUpCode}
                  onChange={(event) => setStepUpCode(event.target.value)}
                />
              </label>
            </div>
          ) : null}

          <div>
            <button type="button" className="primary" disabled={busy} onClick={() => void handleSave()}>
              {busy ? "Đang lưu chính sách…" : stepUpOpen ? "Xác nhận Step-up & Lưu chính sách" : "Lưu cấu hình chính sách"}
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
