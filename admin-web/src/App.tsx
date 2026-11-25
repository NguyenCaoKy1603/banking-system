import { useCallback, useEffect, useState } from "react";
import { adminFetch, type ApiError } from "./api";
import { Notice } from "./components/common/Notice";
import { AppLayout } from "./components/layout/AppLayout";
import { StaffProvider, useStaff } from "./context/StaffContext";
import { Applications } from "./features/applications/Applications";
import { Approvals } from "./features/approvals/Approvals";
import { AuditView } from "./features/audit/AuditView";
import { Activation } from "./features/auth/Activation";
import { Login } from "./features/auth/Login";
import { Customers } from "./features/customers/Customers";
import { Operations } from "./features/operations/Operations";
import { Overview } from "./features/overview/Overview";
import { PolicyView } from "./features/policy/PolicyView";
import { StaffView } from "./features/staff/StaffView";
import { Transfers } from "./features/transfers/Transfers";
import { useRouter } from "./router";
import type {
  Action,
  AdminControlPolicy,
  Application,
  AuditEvent,
  Job,
  LedgerReconciliation,
  NavTab,
  OutboxEvent,
  Staff,
  TransactionAnomaly,
  Transfer,
} from "./types";

function AppShell() {
  const { staff, canReadApprovals, logout } = useStaff();
  const { tab, navigate } = useRouter();

  // State for data fetched across views
  const [actions, setActions] = useState<Action[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [applications, setApplications] = useState<Application[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [anomalies, setAnomalies] = useState<TransactionAnomaly[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [outboxEvents, setOutboxEvents] = useState<OutboxEvent[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [controlPolicy, setControlPolicy] = useState<AdminControlPolicy | null>(null);
  const [reconciliation, setReconciliation] = useState<LedgerReconciliation | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(
    async (target: NavTab = tab) => {
      setLoading(true);
      setError(null);
      try {
        if (target === "overview" || target === "approvals") {
          const approvalPromise = canReadApprovals ? adminFetch<{ items: Action[] }>("/admin/approvals") : Promise.resolve({ items: [] as Action[] });
          const reconciliationPromise = target === "overview"
            ? adminFetch<{ reconciliation: LedgerReconciliation }>("/admin/operations/ledger-reconciliation").catch(() => ({ reconciliation: null }))
            : Promise.resolve({ reconciliation: null });
          const [approvalResult, summaryResult, reconciliationResult] = await Promise.all([
            approvalPromise,
            adminFetch<{ summary: Record<string, number> }>("/admin/operations/outbox/summary"),
            reconciliationPromise,
          ]);
          setActions(approvalResult.items);
          setSummary(summaryResult.summary);
          if (target === "overview") {
            setReconciliation(reconciliationResult.reconciliation);
          }
        }

        if (target === "policy") {
          const [policyResult, reconciliationResult] = await Promise.all([
            canReadApprovals ? adminFetch<{ policy: AdminControlPolicy }>("/admin/control-policy") : Promise.resolve({ policy: null }),
            adminFetch<{ reconciliation: LedgerReconciliation }>("/admin/operations/ledger-reconciliation"),
          ]);
          setControlPolicy(policyResult.policy);
          setReconciliation(reconciliationResult.reconciliation);
        }

        if (target === "operations") {
          const [summaryResult, jobResult, outboxResult] = await Promise.all([
            adminFetch<{ summary: Record<string, number> }>("/admin/operations/outbox/summary"),
            adminFetch<{ items: Job[] }>("/admin/operations/jobs"),
            adminFetch<{ items: OutboxEvent[] }>("/admin/operations/outbox/events"),
          ]);
          setSummary(summaryResult.summary);
          setJobs(jobResult.items);
          setOutboxEvents(outboxResult.items);
        }

        if (target === "kyc" || target === "credit") {
          const result = await adminFetch<{ items: Application[] }>("/admin/applications");
          setApplications(result.items);
        }

        if (target === "transfers") {
          const [transferResult, anomalyResult] = await Promise.all([
            adminFetch<{ items: Transfer[] }>("/admin/transfers"),
            adminFetch<{ items: TransactionAnomaly[] }>("/admin/anomalies"),
          ]);
          setTransfers(transferResult.items);
          setAnomalies(anomalyResult.items);
        }

        if (target === "staff") {
          const result = await adminFetch<{ items: Staff[] }>("/admin/staff");
          setStaffList(result.items);
        }

        if (target === "audit") {
          if (canReadApprovals) {
            const result = await adminFetch<{ items: AuditEvent[] }>("/admin/audit-events?limit=300");
            setAuditEvents(result.items);
          } else {
            setAuditEvents([]);
          }
        }
      } catch (caught) {
        setError(caught as ApiError);
      } finally {
        setLoading(false);
      }
    },
    [canReadApprovals, tab]
  );

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const loadTransfersWithStatus = async (status: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const result = await adminFetch<{ items: Transfer[] }>(`/admin/transfers${query}`);
      setTransfers(result.items);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout
      currentTab={tab}
      onSelectTab={navigate}
      approvalCount={actions.length}
    >
      <Notice error={error} retry={() => void load(tab)} />
      {loading ? <div className="notice info">Đang tải dữ liệu server…</div> : null}

      {tab === "overview" ? (
        <Overview
          actions={actions}
          summary={summary}
          reconciliation={reconciliation}
          onNavigate={navigate}
        />
      ) : null}

      {tab === "policy" ? (
        <PolicyView
          policy={controlPolicy}
          reconciliation={reconciliation}
          onReload={() => load("policy")}
          loading={loading}
        />
      ) : null}

      {tab === "customers" ? (
        <Customers onRefresh={() => void load("overview")} />
      ) : null}

      {tab === "approvals" ? (
        <Approvals
          actions={actions}
          onReload={() => load("approvals")}
          loading={loading}
        />
      ) : null}

      {tab === "kyc" || tab === "credit" ? (
        <Applications
          items={applications}
          onReload={() => load(tab)}
          loading={loading}
          tabType={tab === "credit" ? "CREDIT" : "KYC"}
        />
      ) : null}

      {tab === "transfers" ? (
        <Transfers
          items={transfers}
          anomalies={anomalies}
          onReload={() => load("transfers")}
          onFilterChange={loadTransfersWithStatus}
          loading={loading}
        />
      ) : null}

      {tab === "operations" ? (
        <Operations
          summary={summary}
          jobs={jobs}
          events={outboxEvents}
          onReload={() => load("operations")}
          loading={loading}
        />
      ) : null}

      {tab === "staff" ? (
        <StaffView
          items={staffList}
          onReload={() => load("staff")}
          loading={loading}
        />
      ) : null}

      {tab === "audit" ? (
        <AuditView
          items={auditEvents}
          onReload={() => load("audit")}
          loading={loading}
        />
      ) : null}
    </AppLayout>
  );
}

function AuthenticatedApp() {
  const { staff, loading, error, setStaffSession } = useStaff();

  if (loading) {
    return (
      <main className="auth-shell">
        <div className="loading">Đang kiểm tra phiên staff…</div>
      </main>
    );
  }

  if (!staff) {
    return (
      <>
        <Login onLoggedIn={setStaffSession} />
        {error ? (
          <div className="floating-error">
            <Notice error={error} />
          </div>
        ) : null}
      </>
    );
  }

  return <AppShell />;
}

export function App() {
  return window.location.pathname === "/admin/activate" ? (
    <Activation />
  ) : (
    <StaffProvider>
      <AuthenticatedApp />
    </StaffProvider>
  );
}
export default App;
