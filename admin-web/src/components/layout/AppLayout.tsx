import { useEffect, useState, type ReactNode } from "react";
import { useStaff } from "../../context/StaffContext";
import type { NavTab } from "../../types";

interface AppLayoutProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  approvalCount: number;
  children: ReactNode;
}

interface NavItem {
  key: NavTab;
  label: string;
  badge?: number;
  visible: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export function AppLayout({
  currentTab,
  onSelectTab,
  approvalCount,
  children,
}: AppLayoutProps) {
  const { staff, roleList, logout, canReadApprovals, hasPermission } = useStaff();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const groups: NavGroup[] = [
    {
      title: "1. Tổng quan",
      items: [
        {
          key: "overview",
          label: "Tổng quan",
          visible: true,
        },
      ],
    },
    {
      title: "2. Nghiệp vụ",
      items: [
        {
          key: "customers",
          label: "Khách hàng",
          visible: hasPermission("customer.read.masked") || hasPermission("account.read"),
        },
        {
          key: "kyc",
          label: "Hồ sơ định danh",
          visible: hasPermission("kyc.read"),
        },
        {
          key: "credit",
          label: "Hồ sơ tín dụng",
          visible: hasPermission("credit-application.read"),
        },
        {
          key: "transfers",
          label: "Giao dịch chuyển tiền",
          visible: hasPermission("transfer.pending.read"),
        },
      ],
    },
    {
      title: "3. Phê duyệt",
      items: [
        {
          key: "approvals",
          label: "Approval Inbox",
          badge: approvalCount,
          visible: false,
        },
      ],
    },
    {
      title: "4. Vận hành",
      items: [
        {
          key: "operations",
          label: "Outbox / Jobs",
          visible: hasPermission("outbox.read") || hasPermission("job.read"),
        },
      ],
    },
    {
      title: "5. Quản trị",
      items: [
        {
          key: "policy",
          label: "Chính sách & Biểu phí",
          visible: canReadApprovals,
        },
        {
          key: "staff",
          label: "Nhân sự / Phân quyền (Staff / Roles)",
          visible: hasPermission("staff.read"),
        },
        {
          key: "audit",
          label: "Nhật ký kiểm toán (Audit Explorer)",
          visible: canReadApprovals,
        },
      ],
    },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <p className="eyebrow">BANKING REFERENCE · ADMIN</p>
          <div className="staff-info">
            <strong>{staff?.displayName ?? "Nhân viên"}</strong>
            <span className="role-pill">{roleList || "STAFF"}</span>
          </div>
        </div>
        <div className="top-actions">
          <span className={online ? "online" : "offline"} title="Trạng thái mạng của trình duyệt">
            {online ? "● Trực tuyến" : "○ Mất kết nối"}
          </span>
          <button className="ghost" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" aria-label="Điều hướng chính">
          <nav className="sidebar-nav">
            {groups.map((group) => {
              const visibleItems = group.items.filter((item) => item.visible);
              if (visibleItems.length === 0) return null;

              return (
                <div key={group.title} className="sidebar-group">
                  <div className="sidebar-group-title">{group.title}</div>
                  {visibleItems.map((item) => (
                    <button
                      key={item.key}
                      className={currentTab === item.key ? "nav active" : "nav"}
                      onClick={() => onSelectTab(item.key)}
                    >
                      <span className="nav-label">{item.label}</span>
                      {item.badge && item.badge > 0 ? (
                        <span className="badge-count" title={`${item.badge} yêu cầu chờ duyệt`}>
                          {item.badge}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>

          <div className="sidebar-note">
            <strong>Nguyên tắc bảo mật</strong>
            <div>Deny-by-default</div>
            <div>Phê duyệt theo quyền và MFA</div>
            <div>Audit append-only</div>
            <div>PII được che mặc định</div>
          </div>
        </aside>

        <main className="content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
