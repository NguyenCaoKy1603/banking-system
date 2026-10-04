import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminFetch, formatMinor, isIndeterminateError, type ApiError } from "../../api";
import { Heading } from "../../components/common/Heading";
import { Modal } from "../../components/common/Modal";
import { Notice } from "../../components/common/Notice";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { Account, Customer } from "../../types";
import {
  AccountLoadManager,
  type AccountLoaderState,
} from "./accountLoader";
import {
  backToEditStep,
  createActionIntent,
  discardIntent,
  enterReviewStep,
  getSessionPendingIntent,
  getSessionPendingIntents,
  isSessionScopeActive,
  isValidActionResponse,
  normalizePayload,
  resolveIntentFailure,
  resolveIntentSuccess,
  setSessionPendingIntent,
  startIntentSubmit,
  subscribeSessionPendingIntents,
  updateIntentPayload,
  type ActionIntent,
  type SessionScope,
} from "./actionIntent.ts";

interface CustomersProps {
  onRefresh?: () => void;
}

type AccountActionKind = "BLOCK" | "UNBLOCK" | "FUND" | "REVERSAL";
type CustomerActionKind = "LOCK" | "UNLOCK";

export function Customers({ onRefresh }: CustomersProps) {
  const { staff, hasPermission, sessionScope } = useStaff();

  // Search state (kept in memory, never in URL or storage)
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Account loading state managed with generation and customer matching guards
  const accountLoader = useRef(new AccountLoadManager()).current;
  const [loaderState, setLoaderState] = useState<AccountLoaderState>(accountLoader.getState());

  useEffect(() => {
    return accountLoader.subscribe((next) => {
      setLoaderState({ ...next });
    });
  }, [accountLoader]);

  const { selectedCustomer, accounts, loading: accountsLoading, error: accountsError } = loaderState;

  // General notices
  const [generalError, setGeneralError] = useState<ApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // In-memory Intent Store: scoped to active session, survives modal closing and tab switching
  const [pendingIntents, setPendingIntents] = useState<Map<string, ActionIntent>>(() =>
    getSessionPendingIntents(sessionScope)
  );

  useEffect(() => {
    setPendingIntents(getSessionPendingIntents(sessionScope));
    return subscribeSessionPendingIntents((next) => {
      setPendingIntents(next);
    });
  }, [sessionScope]);

  useEffect(() => {
    // When session changes or terminates, clear transient views
    setQuery("");
    setSearched(false);
    setCustomers([]);
    setGeneralError(null);
    setSuccessMessage(null);
    setActiveAccountIntent(null);
    setAccountTarget(null);
    setActiveCustomerIntent(null);
    setCustomerTarget(null);
    accountLoader.clear();
  }, [sessionScope?.generation, sessionScope?.staffId, accountLoader]);

  // Account modal state
  const [activeAccountIntent, setActiveAccountIntent] = useState<ActionIntent | null>(null);
  const [accountTarget, setAccountTarget] = useState<{
    account: Account;
    kind: AccountActionKind;
  } | null>(null);

  // Raw account form input states
  const [amount, setAmount] = useState("");
  const [sourceTransactionId, setSourceTransactionId] = useState("");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [description, setDescription] = useState("");

  // Customer modal state
  const [activeCustomerIntent, setActiveCustomerIntent] = useState<ActionIntent | null>(null);
  const [customerTarget, setCustomerTarget] = useState<{
    customer: Customer;
    kind: CustomerActionKind;
  } | null>(null);
  const [customerReason, setCustomerReason] = useState("");
  const [customerTicket, setCustomerTicket] = useState("");
  const [customerDescription, setCustomerDescription] = useState("");

  // Permissions
  const canLockCustomer = hasPermission("customer.access-lock.request");
  const canUnlockCustomer = hasPermission("customer.access-unlock.request");
  const canBlockAccount = hasPermission("account.block.request");
  const canUnblockAccount = hasPermission("account.unblock.request");
  const canFundAccount = hasPermission("simulation-funding.request");
  const canReverseFunding = hasPermission("simulation-funding.reverse.request");

  const search = async (e?: FormEvent, preserveNotice = false) => {
    if (e) e.preventDefault();
    setSearchLoading(true);
    setGeneralError(null);
    if (!preserveNotice) {
      setSuccessMessage(null);
    }
    setSearched(true);
    accountLoader.clear();

    const capturedScope = sessionScope;
    try {
      const result = await adminFetch<{ items: Customer[] }>(
        `/admin/customers?q=${encodeURIComponent(query.trim())}`
      );
      if (!isSessionScopeActive(capturedScope)) return;
      setCustomers(result.items);
    } catch (caught) {
      if (!isSessionScopeActive(capturedScope)) return;
      setGeneralError(caught as ApiError);
      setCustomers([]);
    } finally {
      if (isSessionScopeActive(capturedScope)) {
        setSearchLoading(false);
      }
    }
  };

  const openCustomer = async (cust: Customer) => {
    setGeneralError(null);
    setSuccessMessage(null);
    await accountLoader.loadCustomerAccounts(cust, true);
  };

  const reloadCurrentCustomerAccounts = async () => {
    if (!selectedCustomer) return;
    await accountLoader.loadCustomerAccounts(selectedCustomer, false);
  };

  // --- Account Modal Logic ---

  const handleOpenAccountModal = (account: Account, kind: AccountActionKind) => {
    setSuccessMessage(null);
    const intentKey = `ACCOUNT:${account.id}`;
    const existingIntent = getSessionPendingIntent(intentKey, sessionScope);

    if (existingIntent && existingIntent.status === "INDETERMINATE") {
      // Restore existing indeterminate intent snapshot and stable key!
      setActiveAccountIntent(existingIntent);
      setAccountTarget({ account, kind: existingIntent.kind as AccountActionKind });
      const p = existingIntent.payload as Record<string, string>;
      setAmount(p.amountMinor ?? "");
      setSourceTransactionId(p.sourceTransactionId ?? "");
      setReason(p.reasonCode ?? "");
      setTicket(p.ticketReference ?? "");
      setDescription(p.description ?? "");
      return;
    }

    const path =
      kind === "FUND"
        ? `/admin/accounts/${account.id}/funding-requests`
        : kind === "REVERSAL"
        ? `/admin/accounts/${account.id}/funding-reversal-requests`
        : `/admin/accounts/${account.id}/${kind === "BLOCK" ? "block" : "unblock"}-requests`;

    const initialPayload: Record<string, string> = {
      reasonCode: "",
      ticketReference: "",
      description: "",
    };
    if (kind === "FUND" || kind === "REVERSAL") {
      initialPayload.amountMinor = "";
      initialPayload.currency = "VND";
    }
    if (kind === "REVERSAL") {
      initialPayload.sourceTransactionId = "";
    }

    const newIntent = createActionIntent({
      targetType: "ACCOUNT",
      targetId: account.id,
      targetLabel: `${account.displayName} (${account.maskedNumber})`,
      kind,
      path,
      payload: initialPayload,
      prefix: `account-${kind.toLowerCase()}`,
      staffId: staff?.id,
      sessionScope,
    });

    setActiveAccountIntent(newIntent);
    setAccountTarget({ account, kind });
    setAmount("");
    setSourceTransactionId("");
    setReason("");
    setTicket("");
    setDescription("");
  };

  const handleCloseAccountModal = () => {
    if (activeAccountIntent?.status === "SUBMITTING") return;

    if (activeAccountIntent && activeAccountIntent.status === "INDETERMINATE" && accountTarget) {
      // Save intent to in-memory store so it survives closing and can be resumed
      const intentKey = `ACCOUNT:${accountTarget.account.id}`;
      setSessionPendingIntent(intentKey, activeAccountIntent, sessionScope);
    }

    setAccountTarget(null);
    setActiveAccountIntent(null);
  };

  const handleAccountFieldChange = (field: string, val: string) => {
    if (!activeAccountIntent || !accountTarget) return;

    if (field === "amount") setAmount(val);
    if (field === "sourceTransactionId") setSourceTransactionId(val);
    if (field === "reason") setReason(val);
    if (field === "ticket") setTicket(val);
    if (field === "description") setDescription(val);

    const updatedRaw: Record<string, unknown> = {
      ...activeAccountIntent.payload,
      reasonCode: field === "reason" ? val : reason,
      ticketReference: field === "ticket" ? val : ticket,
      description: field === "description" ? val : description,
    };
    if (accountTarget.kind === "FUND" || accountTarget.kind === "REVERSAL") {
      updatedRaw.amountMinor = field === "amount" ? val : amount;
      updatedRaw.currency = "VND";
    }
    if (accountTarget.kind === "REVERSAL") {
      updatedRaw.sourceTransactionId =
        field === "sourceTransactionId" ? val : sourceTransactionId;
    }

    const updatedIntent = updateIntentPayload(
      activeAccountIntent,
      updatedRaw,
      `account-${accountTarget.kind.toLowerCase()}`
    );
    setActiveAccountIntent(updatedIntent);
  };

  const handleDiscardAccountIndeterminate = () => {
    if (!activeAccountIntent || !accountTarget) return;
    const discarded = discardIntent(
      activeAccountIntent,
      `account-${accountTarget.kind.toLowerCase()}`
    );
    const intentKey = `ACCOUNT:${accountTarget.account.id}`;
    setSessionPendingIntent(intentKey, null, sessionScope, activeAccountIntent.id);
    setActiveAccountIntent(discarded);
  };

  const submitAccountAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeAccountIntent || !accountTarget || !reason.trim() || !ticket.trim()) return;

    // Review step gating: require review before submission unless already reviewing or indeterminate retry
    if (activeAccountIntent.status === "DRAFT") {
      const snapshot: Record<string, unknown> = {
        reasonCode: reason.trim(),
        ticketReference: ticket.trim(),
        description: description.trim() || `Admin Web account ${accountTarget.kind.toLowerCase()}`,
      };
      if (accountTarget.kind === "FUND" || accountTarget.kind === "REVERSAL") {
        snapshot.amountMinor = amount.trim();
        snapshot.currency = "VND";
      }
      if (accountTarget.kind === "REVERSAL") {
        snapshot.sourceTransactionId = sourceTransactionId.trim();
      }

      const reviewedIntent = enterReviewStep(activeAccountIntent, snapshot);
      setActiveAccountIntent(reviewedIntent);
      return;
    }

    // Submit intent
    const submittingIntent = startIntentSubmit(activeAccountIntent);
    setActiveAccountIntent(submittingIntent);

    const capturedScope = sessionScope;
    const capturedIntentId = submittingIntent.id;
    const capturedAccount = accountTarget.account;
    const capturedKind = accountTarget.kind;
    const intentKey = `ACCOUNT:${capturedAccount.id}`;
    const payloadToSend = normalizePayload(submittingIntent.payload);

    try {
      const result = await adminFetch<{ action?: { id: string }; actionId?: string }>(submittingIntent.path, {
        method: "POST",
        headers: { "Idempotency-Key": submittingIntent.idempotencyKey },
        body: JSON.stringify(payloadToSend),
      });

      // SESSION GUARD: Prevent late callbacks from modifying new or terminated sessions
      if (!isSessionScopeActive(capturedScope)) {
        return;
      }

      if (!isValidActionResponse(result)) {
        throw {
          status: 502,
          code: "INVALID_RESPONSE",
          message: "Máy chủ trả về phản hồi không hợp lệ hoặc thiếu mã yêu cầu (action ID). Vui lòng đối soát trong Approval Inbox trước khi thử lại.",
          isNetworkOrTimeout: true,
        } as ApiError;
      }

      // Succeeded: clear intent from memory with expectedIntentId, show success message, close modal
      const succeededIntent = resolveIntentSuccess(submittingIntent, result);
      setSessionPendingIntent(intentKey, null, capturedScope, capturedIntentId);

      setActiveAccountIntent((prev) => (prev?.id === capturedIntentId ? null : prev));
      setAccountTarget((prev) => (prev?.account.id === capturedAccount.id ? null : prev));

      const resolvedActionId =
        "action" in result && result.action
          ? result.action.id
          : "actionId" in result
          ? result.actionId
          : "";
      setSuccessMessage(
        `Đã tạo yêu cầu ${capturedKind} thành công (Mã: ${resolvedActionId}). Yêu cầu đã chuyển vào Approval Inbox.`
      );

      // Reload accounts from server; report reload error separately without masking command success
      try {
        await reloadCurrentCustomerAccounts();
      } catch (reloadErr) {
        if (isSessionScopeActive(capturedScope)) {
          setGeneralError(reloadErr as ApiError);
        }
      }
      if (onRefresh && isSessionScopeActive(capturedScope)) onRefresh();
    } catch (caught) {
      // SESSION GUARD: Late error callback must not resurrect stale intent
      if (!isSessionScopeActive(capturedScope)) {
        return;
      }

      const apiErr = caught as ApiError;
      const failedIntent = resolveIntentFailure(submittingIntent, apiErr);
      setActiveAccountIntent((prev) => (prev?.id === capturedIntentId ? failedIntent : prev));

      // Keep indeterminate intent in memory store so closing modal doesn't lose it
      if (failedIntent.status === "INDETERMINATE") {
        setSessionPendingIntent(intentKey, failedIntent, capturedScope);
      }
    }
  };

  // --- Customer Lock/Unlock Modal Logic ---

  const handleOpenCustomerModal = (customer: Customer, kind: CustomerActionKind) => {
    setSuccessMessage(null);
    const intentKey = `CUSTOMER:${customer.id}`;
    const existingIntent = getSessionPendingIntent(intentKey, sessionScope);

    if (existingIntent && existingIntent.status === "INDETERMINATE") {
      setActiveCustomerIntent(existingIntent);
      setCustomerTarget({ customer, kind: existingIntent.kind as CustomerActionKind });
      const p = existingIntent.payload as Record<string, string>;
      setCustomerReason(p.reasonCode ?? "");
      setCustomerTicket(p.ticketReference ?? "");
      setCustomerDescription(p.description ?? "");
      return;
    }

    const path =
      kind === "LOCK"
        ? `/admin/customers/${customer.id}/access-lock-requests`
        : `/admin/customers/${customer.id}/access-unlock-requests`;

    const initialPayload = {
      reasonCode: "CUSTOMER_ACCESS_REVIEW",
      ticketReference: "ADMIN-CUSTOMER",
      description: `Customer access ${kind.toLowerCase()} request`,
    };

    const newIntent = createActionIntent({
      targetType: "CUSTOMER",
      targetId: customer.id,
      targetLabel: customer.fullName,
      kind,
      path,
      payload: initialPayload,
      prefix: `customer-${kind.toLowerCase()}`,
      staffId: staff?.id,
      sessionScope,
    });

    setActiveCustomerIntent(newIntent);
    setCustomerTarget({ customer, kind });
    setCustomerReason(initialPayload.reasonCode);
    setCustomerTicket(initialPayload.ticketReference);
    setCustomerDescription(initialPayload.description);
  };

  const handleCloseCustomerModal = () => {
    if (activeCustomerIntent?.status === "SUBMITTING") return;

    if (activeCustomerIntent && activeCustomerIntent.status === "INDETERMINATE" && customerTarget) {
      const intentKey = `CUSTOMER:${customerTarget.customer.id}`;
      setSessionPendingIntent(intentKey, activeCustomerIntent, sessionScope);
    }

    setCustomerTarget(null);
    setActiveCustomerIntent(null);
  };

  const handleCustomerFieldChange = (field: string, val: string) => {
    if (!activeCustomerIntent || !customerTarget) return;

    if (field === "reason") setCustomerReason(val);
    if (field === "ticket") setCustomerTicket(val);
    if (field === "description") setCustomerDescription(val);

    const updatedRaw = {
      reasonCode: field === "reason" ? val : customerReason,
      ticketReference: field === "ticket" ? val : customerTicket,
      description: field === "description" ? val : customerDescription,
    };

    const updated = updateIntentPayload(
      activeCustomerIntent,
      updatedRaw,
      `customer-${customerTarget.kind.toLowerCase()}`
    );
    setActiveCustomerIntent(updated);
  };

  const submitCustomerAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeCustomerIntent || !customerTarget || !customerReason.trim() || !customerTicket.trim()) return;

    // Review step gating
    if (activeCustomerIntent.status === "DRAFT") {
      const snapshot = {
        reasonCode: customerReason.trim(),
        ticketReference: customerTicket.trim(),
        description: customerDescription.trim(),
      };
      const reviewed = enterReviewStep(activeCustomerIntent, snapshot);
      setActiveCustomerIntent(reviewed);
      return;
    }

    const submittingIntent = startIntentSubmit(activeCustomerIntent);
    setActiveCustomerIntent(submittingIntent);

    const capturedScope = sessionScope;
    const capturedIntentId = submittingIntent.id;
    const capturedCustomer = customerTarget.customer;
    const capturedKind = customerTarget.kind;
    const intentKey = `CUSTOMER:${capturedCustomer.id}`;
    const payloadToSend = normalizePayload(submittingIntent.payload);

    try {
      const result = await adminFetch<{ action?: { id: string }; actionId?: string }>(submittingIntent.path, {
        method: "POST",
        headers: { "Idempotency-Key": submittingIntent.idempotencyKey },
        body: JSON.stringify(payloadToSend),
      });

      // SESSION GUARD: Prevent late callbacks from modifying new or terminated sessions
      if (!isSessionScopeActive(capturedScope)) {
        return;
      }

      if (!isValidActionResponse(result)) {
        throw {
          status: 502,
          code: "INVALID_RESPONSE",
          message: "Máy chủ trả về phản hồi không hợp lệ hoặc thiếu mã yêu cầu (action ID). Vui lòng đối soát trong Approval Inbox trước khi thử lại.",
          isNetworkOrTimeout: true,
        } as ApiError;
      }

      const succeeded = resolveIntentSuccess(submittingIntent, result);
      setSessionPendingIntent(intentKey, null, capturedScope, capturedIntentId);

      setActiveCustomerIntent((prev) => (prev?.id === capturedIntentId ? null : prev));
      setCustomerTarget((prev) => (prev?.customer.id === capturedCustomer.id ? null : prev));

      const resolvedActionId =
        "action" in result && result.action
          ? result.action.id
          : "actionId" in result
          ? result.actionId
          : "";
      setSuccessMessage(
        `Đã tạo yêu cầu ${capturedKind === "LOCK" ? "khóa" : "mở khóa"} truy cập khách hàng thành công (Mã: ${resolvedActionId}).`
      );

      try {
        await search(undefined, true);
      } catch {
        /* search reload failed */
      }
      if (onRefresh && isSessionScopeActive(capturedScope)) onRefresh();
    } catch (caught) {
      // SESSION GUARD: Late error callback must not resurrect stale intent
      if (!isSessionScopeActive(capturedScope)) {
        return;
      }

      const apiErr = caught as ApiError;
      const failed = resolveIntentFailure(submittingIntent, apiErr);
      setActiveCustomerIntent((prev) => (prev?.id === capturedIntentId ? failed : prev));

      if (failed.status === "INDETERMINATE") {
        setSessionPendingIntent(intentKey, failed, capturedScope);
      }
    }
  };

  const handleDiscardCustomerIndeterminate = () => {
    if (!activeCustomerIntent || !customerTarget) return;
    const discarded = discardIntent(
      activeCustomerIntent,
      `customer-${customerTarget.kind.toLowerCase()}`
    );
    const intentKey = `CUSTOMER:${customerTarget.customer.id}`;
    setSessionPendingIntent(intentKey, null, sessionScope, activeCustomerIntent.id);
    setActiveCustomerIntent(discarded);
  };

  const accountBusy = activeAccountIntent?.status === "SUBMITTING";
  const customerBusy = activeCustomerIntent?.status === "SUBMITTING";
  const isAccountReviewing =
    activeAccountIntent?.status === "REVIEWING" || activeAccountIntent?.status === "INDETERMINATE";
  const isAccountIndeterminate = activeAccountIntent?.status === "INDETERMINATE";
  const isCustomerReviewing =
    activeCustomerIntent?.status === "REVIEWING" || activeCustomerIntent?.status === "INDETERMINATE";
  const isCustomerIndeterminate = activeCustomerIntent?.status === "INDETERMINATE";

  return (
    <section className="customers-page">
      <Heading eyebrow="CUSTOMER READ" title="Khách hàng & tài khoản" />

      <Notice error={generalError || accountsError} retry={() => void reloadCurrentCustomerAccounts()} />
      {successMessage ? (
        <Notice type="success" onDismiss={() => setSuccessMessage(null)}>
          {successMessage}
        </Notice>
      ) : null}

      {/* Banner for in-memory indeterminate intents waiting for reconciliation */}
      {pendingIntents.size > 0 ? (
        <div className="notice warning" data-testid="pending-intents-banner">
          <b>LƯU Ý ĐỐI SOÁT:</b> Đang có {pendingIntents.size} thao tác ghi chưa xác định kết quả trong phiên.
          <ul>
            {Array.from(pendingIntents.values()).map((intent) => (
              <li key={intent.id}>
                {intent.targetType} {intent.targetLabel} ({intent.kind}) — Khóa:{" "}
                <code>{intent.idempotencyKey}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form className="search-row" onSubmit={(e) => void search(e)}>
        <input
          data-testid="customer-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Email, số điện thoại hoặc tên khách hàng"
          disabled={searchLoading}
        />
        <button className="primary" type="submit" disabled={searchLoading}>
          {searchLoading ? "Đang tìm…" : "Tìm kiếm"}
        </button>
      </form>

      {!searched ? (
        <div className="empty">Nhập tiêu chí để tìm dữ liệu đã che.</div>
      ) : customers.length === 0 ? (
        <div className="empty">Không tìm thấy khách hàng phù hợp trong dữ liệu thử nghiệm.</div>
      ) : (
        <div className="customer-grid">
          {customers.map((customer) => (
            <article className="customer-card" key={customer.id}>
              <div className="customer-card-header">
                <h2>{customer.fullName}</h2>
                <StatusBadge status={customer.accessStatus} />
              </div>
              <p className="customer-email">{customer.email}</p>
              <p className="muted">
                {customer.phoneNumber} · access {customer.accessStatus}
              </p>
              <div className="button-row">
                {canLockCustomer && customer.accessStatus === "ACTIVE" ? (
                  <button
                    className="secondary"
                    data-testid="customer-lock-request"
                    type="button"
                    onClick={() => handleOpenCustomerModal(customer, "LOCK")}
                  >
                    Yêu cầu khóa đăng nhập
                  </button>
                ) : null}
                {canUnlockCustomer && customer.accessStatus === "LOCKED" ? (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => handleOpenCustomerModal(customer, "UNLOCK")}
                  >
                    Yêu cầu mở khóa
                  </button>
                ) : null}
                <button
                  className={selectedCustomer?.id === customer.id ? "primary" : "secondary"}
                  type="button"
                  onClick={() => void openCustomer(customer)}
                >
                  Xem tài khoản
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedCustomer ? (
        <section className="panel customer-accounts-panel">
          <div className="panel-heading">
            <div>
              <h2>Danh sách tài khoản: {selectedCustomer.fullName}</h2>
              <span className="muted">
                {selectedCustomer.email} · {selectedCustomer.phoneNumber}
              </span>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                data-testid="reload-accounts"
                disabled={accountsLoading}
                onClick={() => void reloadCurrentCustomerAccounts()}
              >
                {accountsLoading ? "Đang tải…" : "Tải lại danh sách"}
              </button>
            </div>
          </div>

          {accountsLoading ? (
            <div className="notice info" data-testid="accounts-loading">
              Đang tải danh sách tài khoản của khách hàng…
            </div>
          ) : accounts.length === 0 ? (
            <div className="empty">Khách hàng này chưa có tài khoản thanh toán nào.</div>
          ) : (
            <div className="account-grid">
              {accounts.map((account) => (
                <article className="account-card" key={account.id}>
                  <div className="account-header">
                    <strong>{account.displayName}</strong>
                    <StatusBadge status={account.status} />
                  </div>
                  <p className="account-number">{account.maskedNumber}</p>
                  <div className="account-balance">
                    <strong>{formatMinor(account.availableMinor)}</strong>
                    <small>Số dư khả dụng · Version {account.version}</small>
                  </div>

                  <div className="button-row">
                    {canBlockAccount && account.status === "ACTIVE" ? (
                      <button
                        className="secondary"
                        data-testid="account-block-request"
                        type="button"
                        onClick={() => handleOpenAccountModal(account, "BLOCK")}
                      >
                        Yêu cầu khóa tài khoản
                      </button>
                    ) : null}

                    {canUnblockAccount && account.status === "BLOCKED" ? (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => handleOpenAccountModal(account, "UNBLOCK")}
                      >
                        Yêu cầu mở khóa
                      </button>
                    ) : null}

                    {canFundAccount ? (
                      <button
                        className="primary"
                        data-testid="funding-request"
                        type="button"
                        onClick={() => handleOpenAccountModal(account, "FUND")}
                      >
                        Yêu cầu cấp tiền
                      </button>
                    ) : null}

                    {canReverseFunding ? (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => handleOpenAccountModal(account, "REVERSAL")}
                      >
                        Hoàn tác funding
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Account Action Modal (Fund, Reverse, Block, Unblock) */}
      {accountTarget && activeAccountIntent ? (
        <div className="modal-backdrop">
          <form className="modal stack" onSubmit={(event) => void submitAccountAction(event)}>
            <div className="panel-heading">
              <h2>
                Yêu cầu {accountTarget.kind === "FUND"
                  ? "cấp tiền (Simulation Funding)"
                  : accountTarget.kind === "REVERSAL"
                  ? "hoàn tác cấp tiền"
                  : accountTarget.kind === "BLOCK"
                  ? "khóa tài khoản"
                  : "mở khóa tài khoản"}
              </h2>
              <button
                type="button"
                className="ghost"
                disabled={accountBusy}
                onClick={handleCloseAccountModal}
              >
                Đóng
              </button>
            </div>

            <div className="target-summary-box">
              <div>
                <b>Tài khoản:</b> {accountTarget.account.displayName} ({accountTarget.account.maskedNumber})
              </div>
              <div>
                <b>Trạng thái hiện tại:</b> {accountTarget.account.status} · <b>Phiên bản:</b> Version {accountTarget.account.version}
              </div>
            </div>

            <Notice error={activeAccountIntent.error} />

            {/* Indeterminate Warning Notice */}
            {isAccountIndeterminate ? (
              <div className="notice warning" data-testid="indeterminate-notice">
                <b>KẾT QUẢ CHƯA XÁC ĐỊNH (Timeout hoặc sự cố mạng):</b>
                <p>
                  Yêu cầu có thể đã được máy chủ tiếp nhận nhưng kết quả chưa kịp trả về trình duyệt.
                  Vui lòng kiểm tra Approval Inbox trước khi gửi lại.
                </p>
                <p>
                  Nếu gửi lại với cùng thông tin này, hệ thống sẽ <b>giữ nguyên Khóa xử lý (Idempotency Key: {activeAccountIntent.idempotencyKey})</b> để máy chủ nhận biết và ngăn ngừa tạo yêu cầu trùng lặp.
                </p>
                <div style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleDiscardAccountIndeterminate}
                  >
                    Đã đối soát xong: Hủy ý định & Tạo thao tác mới
                  </button>
                </div>
              </div>
            ) : null}

            {accountTarget.kind === "FUND" || accountTarget.kind === "REVERSAL" ? (
              <label>
                Số tiền (minor VND, 1 VND = 1 minor)
                <input
                  data-testid="funding-amount"
                  inputMode="numeric"
                  value={amount}
                  onChange={(event) => handleAccountFieldChange("amount", event.target.value)}
                  placeholder="Ví dụ: 2500"
                  required
                  disabled={accountBusy || isAccountReviewing}
                />
              </label>
            ) : null}

            {accountTarget.kind === "REVERSAL" ? (
              <label>
                Transaction nguồn
                <input
                  value={sourceTransactionId}
                  onChange={(event) => handleAccountFieldChange("sourceTransactionId", event.target.value)}
                  placeholder="Mã transaction cần hoàn tác"
                  required
                  disabled={accountBusy || isAccountReviewing}
                />
              </label>
            ) : null}

            <label>
              Reason code
              <input
                data-testid="action-reason"
                value={reason}
                onChange={(event) => handleAccountFieldChange("reason", event.target.value)}
                placeholder="OPERATIONS_REVIEW"
                required
                disabled={accountBusy || isAccountReviewing}
              />
            </label>

            <label>
              Ticket reference
              <input
                value={ticket}
                onChange={(event) => handleAccountFieldChange("ticket", event.target.value)}
                placeholder="BROWSER-001 hoặc JIRA-1234"
                required
                disabled={accountBusy || isAccountReviewing}
              />
            </label>

            <label>
              Mô tả chi tiết
              <textarea
                value={description}
                onChange={(event) => handleAccountFieldChange("description", event.target.value)}
                placeholder="Nêu lý do thực hiện thao tác"
                disabled={accountBusy || isAccountReviewing}
              />
            </label>

            {/* Review confirmation box */}
            {isAccountReviewing ? (
              <div className="review-box" data-testid="review-box">
                <h4>Xác nhận nội dung trước khi gửi yêu cầu</h4>
                <ul>
                  <li><b>Hành động:</b> {accountTarget.kind}</li>
                  <li><b>Tài khoản:</b> {accountTarget.account.maskedNumber} (Ver: {accountTarget.account.version})</li>
                  <li><b>Khách hàng:</b> {selectedCustomer?.fullName}</li>
                  {amount ? <li><b>Số tiền:</b> {formatMinor(amount)}</li> : null}
                  {sourceTransactionId ? <li><b>Transaction nguồn:</b> {sourceTransactionId}</li> : null}
                  <li><b>Lý do:</b> {reason}</li>
                  <li><b>Ticket:</b> {ticket}</li>
                  <li><b>Khóa Idempotency:</b> <code className="mono">{activeAccountIntent.idempotencyKey}</code></li>
                </ul>
                <p className="warning">
                  Server sẽ kiểm tra quyền, hạn mức, version và idempotency; Admin Web không sửa số dư trực tiếp.
                </p>
              </div>
            ) : null}

            <div className="button-row">
              {isAccountReviewing ? (
                <>
                  {!isAccountIndeterminate ? (
                    <button
                      className="secondary"
                      type="button"
                      disabled={accountBusy}
                      onClick={() => {
                        const back = backToEditStep(activeAccountIntent);
                        setActiveAccountIntent(back);
                      }}
                    >
                      Quay lại chỉnh sửa
                    </button>
                  ) : null}
                  <button
                    className="primary"
                    type="submit"
                    data-testid="submit-account-action"
                    disabled={accountBusy || !reason.trim() || !ticket.trim()}
                  >
                    {accountBusy
                      ? "Đang gửi…"
                      : isAccountIndeterminate
                      ? "Gửi lại (Giữ nguyên khóa xử lý)"
                      : "Tạo yêu cầu xử lý"}
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  type="submit"
                  data-testid="review-account-action"
                  disabled={accountBusy || !reason.trim() || !ticket.trim()}
                >
                  Xem lại yêu cầu
                </button>
              )}
            </div>
            <p className="warning">
              Server sẽ kiểm tra quyền, hạn mức, version và idempotency; Admin Web không sửa số dư trực tiếp.
            </p>
          </form>
        </div>
      ) : null}

      {/* Customer Lock/Unlock Modal */}
      {customerTarget && activeCustomerIntent ? (
        <Modal
          title={`Yêu cầu ${customerTarget.kind === "LOCK" ? "khóa" : "mở khóa"} truy cập khách hàng`}
          isOpen={Boolean(customerTarget)}
          onClose={handleCloseCustomerModal}
        >
          <form className="stack" onSubmit={(e) => void submitCustomerAction(e)}>
            <div className="target-summary-box">
              <div><b>Khách hàng:</b> {customerTarget.customer.fullName}</div>
              <div><b>Email:</b> {customerTarget.customer.email}</div>
            </div>

            <Notice error={activeCustomerIntent.error} />

            {/* Indeterminate Notice for Customer Lock/Unlock */}
            {isCustomerIndeterminate ? (
              <div className="notice warning" data-testid="indeterminate-customer-notice">
                <b>KẾT QUẢ CHƯA XÁC ĐỊNH (Timeout hoặc sự cố mạng):</b>
                <p>
                  Yêu cầu có thể đã được máy chủ tiếp nhận nhưng kết quả chưa kịp trả về.
                  Khóa xử lý (Idempotency Key: {activeCustomerIntent.idempotencyKey}) được giữ nguyên để chống trùng lặp.
                </p>
                <div style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleDiscardCustomerIndeterminate}
                  >
                    Đã đối soát xong: Hủy ý định & Tạo thao tác mới
                  </button>
                </div>
              </div>
            ) : null}

            <label>
              Reason code
              <input
                value={customerReason}
                onChange={(e) => handleCustomerFieldChange("reason", e.target.value)}
                required
                disabled={customerBusy || isCustomerReviewing}
              />
            </label>

            <label>
              Ticket reference
              <input
                value={customerTicket}
                onChange={(e) => handleCustomerFieldChange("ticket", e.target.value)}
                required
                disabled={customerBusy || isCustomerReviewing}
              />
            </label>

            <label>
              Mô tả
              <textarea
                value={customerDescription}
                onChange={(e) => handleCustomerFieldChange("description", e.target.value)}
                disabled={customerBusy || isCustomerReviewing}
              />
            </label>

            {isCustomerReviewing ? (
              <div className="review-box" data-testid="customer-review-box">
                <h4>Xác nhận nội dung trước khi gửi yêu cầu</h4>
                <ul>
                  <li><b>Khách hàng:</b> {customerTarget.customer.fullName}</li>
                  <li><b>Hành động:</b> {customerTarget.kind === "LOCK" ? "Khóa tài khoản đăng nhập" : "Mở khóa tài khoản"}</li>
                  <li><b>Lý do:</b> {customerReason}</li>
                  <li><b>Ticket:</b> {customerTicket}</li>
                  <li><b>Khóa Idempotency:</b> <code className="mono">{activeCustomerIntent.idempotencyKey}</code></li>
                </ul>
              </div>
            ) : null}

            <div className="button-row">
              {isCustomerReviewing ? (
                <>
                  {!isCustomerIndeterminate ? (
                    <button
                      className="secondary"
                      type="button"
                      disabled={customerBusy}
                      onClick={() => {
                        const back = backToEditStep(activeCustomerIntent);
                        setActiveCustomerIntent(back);
                      }}
                    >
                      Quay lại chỉnh sửa
                    </button>
                  ) : null}
                  <button
                    className="primary"
                    type="submit"
                    data-testid="submit-customer-action"
                    disabled={customerBusy || !customerReason.trim()}
                  >
                    {customerBusy
                      ? "Đang gửi…"
                      : isCustomerIndeterminate
                      ? "Gửi lại (Giữ nguyên khóa xử lý)"
                      : "Tạo yêu cầu xử lý"}
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  type="submit"
                  data-testid="review-customer-action"
                  disabled={customerBusy || !customerReason.trim()}
                >
                  Xem lại yêu cầu
                </button>
              )}
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
