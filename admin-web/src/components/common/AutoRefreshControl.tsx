import { useEffect, useState } from "react";

interface AutoRefreshControlProps {
  onRefresh: () => Promise<void>;
  intervalMs?: number;
  defaultEnabled?: boolean;
  disabled?: boolean;
}

export function AutoRefreshControl({
  onRefresh,
  intervalMs = 15000,
  defaultEnabled = false,
  disabled = false,
}: AutoRefreshControlProps) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [lastRefreshed, setLastRefreshed] = useState<string>(() =>
    new Date().toLocaleTimeString("vi-VN", { hour12: false })
  );

  useEffect(() => {
    if (!enabled || disabled) return;

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void onRefresh()
        .then(() => {
          setLastRefreshed(new Date().toLocaleTimeString("vi-VN", { hour12: false }));
        })
        .catch(() => {});
    }, intervalMs);

    return () => clearInterval(interval);
  }, [enabled, disabled, onRefresh, intervalMs]);

  return (
    <div className="auto-refresh-control" title={`Tự động làm mới mỗi ${intervalMs / 1000} giây`}>
      <label className="auto-refresh-label">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>Tự động ({intervalMs / 1000}s)</span>
      </label>
      {enabled ? (
        <span className="live-indicator" title={`Lần cập nhật gần nhất: ${lastRefreshed}`}>
          <span className="live-dot">●</span> {lastRefreshed}
        </span>
      ) : null}
    </div>
  );
}
