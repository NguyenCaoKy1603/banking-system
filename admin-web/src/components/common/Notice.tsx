import type { ReactNode } from "react";
import { getErrorMessage, type ApiError } from "../../api";

type NoticeType = "error" | "info" | "success" | "warning";

interface NoticeProps {
  type?: NoticeType;
  title?: string;
  children?: ReactNode;
  error?: ApiError | null;
  retry?: () => void;
  context?: "activation" | "auth";
  onDismiss?: () => void;
}

export function Notice({
  type = "info",
  title,
  children,
  error,
  retry,
  context,
  onDismiss,
}: NoticeProps) {
  if (error) {
    const message = getErrorMessage(error, context);
    return (
      <div className="notice error" role="alert">
        <div className="notice-body">
          {title ? <strong>{title}: </strong> : null}
          <span>{message}</span>
          {error.fieldErrors ? (
            <ul className="field-error-list">
              {Object.entries(error.fieldErrors).map(([field, err]) => (
                <li key={field}>
                  <b>{field}</b>: {err}
                </li>
              ))}
            </ul>
          ) : null}
          {error.traceId ? (
            <small className="notice-trace">Trace ID: {error.traceId}</small>
          ) : null}
        </div>
        <div className="notice-actions">
          {retry ? (
            <button type="button" className="link-button" onClick={retry}>
              Thử lại
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="ghost dismiss-button" onClick={onDismiss} aria-label="Đóng">
              ✕
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!children) return null;

  return (
    <div className={`notice ${type}`} role="status">
      <div className="notice-body">
        {title ? <strong>{title}: </strong> : null}
        <span>{children}</span>
      </div>
      <div className="notice-actions">
        {retry ? (
          <button type="button" className="link-button" onClick={retry}>
            Thử lại
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="ghost dismiss-button" onClick={onDismiss} aria-label="Đóng">
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}
