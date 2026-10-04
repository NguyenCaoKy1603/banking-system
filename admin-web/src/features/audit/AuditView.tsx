import { formatDate, shortId } from "../../api";
import { DataTable } from "../../components/common/DataTable";
import { Heading } from "../../components/common/Heading";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useStaff } from "../../context/StaffContext";
import type { AuditEvent } from "../../types";

interface AuditViewProps {
  items: AuditEvent[];
  onReload: () => Promise<void>;
  loading: boolean;
}

export function AuditView({ items, onReload, loading }: AuditViewProps) {
  const { canReadApprovals } = useStaff();

  if (!canReadApprovals) {
    return (
      <section className="audit-page">
        <Heading eyebrow="IMMUTABLE EVIDENCE" title="Audit explorer" />
        <div className="notice info">
          Audit explorer chỉ dành cho ADMIN có quyền audit.read.
        </div>
      </section>
    );
  }

  return (
    <section className="audit-page">
      <Heading
        eyebrow="IMMUTABLE EVIDENCE"
        title="Audit explorer"
        actions={
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => void onReload()}
          >
            {loading ? "Đang tải…" : "Làm mới nhật ký"}
          </button>
        }
      />

      {items.length === 0 ? (
        <div className="empty">Chưa có audit event nào trong reference dataset.</div>
      ) : (
        <DataTable>
          {items.map((item) => (
            <tr key={item.id}>
              <th>
                {item.action} · {shortId(item.id)}
              </th>
              <td>
                <div className="audit-row-details">
                  <StatusBadge status={item.outcome} />
                  <span className="muted">
                    · Target: {item.targetType} {item.targetId ? shortId(item.targetId) : ""} · Actor:{" "}
                    {shortId(item.actorStaffId)} · Lý do: {item.reasonCode ?? "—"} ·{" "}
                    {formatDate(item.occurredAt)}
                  </span>
                  {item.metadata && Object.keys(item.metadata).length > 0 ? (
                    <small className="audit-metadata">
                      Metadata:{" "}
                      {JSON.stringify(
                        Object.fromEntries(
                          Object.entries(item.metadata).filter(
                            ([k]) => !/token|secret|password|key/i.test(k)
                          )
                        )
                      )}
                    </small>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <div className="notice info">
        Hệ thống kiểm toán (Audit runtime) hoạt động theo cơ chế append-only bất biến; mọi thao tác tra cứu, xem chi tiết và xuất dữ liệu nhạy cảm đều tự động sinh bản ghi audit mới. Secret, token, OTP, cookie và số tài khoản đầy đủ được lọc bỏ khỏi nhật ký.
      </div>
    </section>
  );
}
