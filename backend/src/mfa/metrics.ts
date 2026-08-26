export const MFA_METRIC_NAMES = [
  "auth_challenges_created_total",
  "auth_challenges_verified_total",
  "auth_challenges_failed_total",
  "auth_challenges_replayed_total",
  "auth_challenges_rate_limited_total",
  "auth_delivery_success_total",
  "auth_delivery_failure_total",
  "mfa_credentials_enrolled_total",
  "mfa_credentials_revoked_total",
  "mfa_recovery_started_total",
  "mfa_recovery_completed_total",
  "auth_suspicious_events_total",
] as const;

export type MfaMetricName = (typeof MFA_METRIC_NAMES)[number];

/** In-process counters with no customer, email, IP or challenge labels. */
export class MfaMetrics {
  private readonly counters = new Map<MfaMetricName, number>();

  increment(name: MfaMetricName, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  snapshot(): Record<MfaMetricName, number> {
    return Object.fromEntries(
      MFA_METRIC_NAMES.map((name) => [name, this.counters.get(name) ?? 0]),
    ) as Record<MfaMetricName, number>;
  }

  prometheus(): string {
    return `${MFA_METRIC_NAMES
      .map((name) => `${name} ${this.counters.get(name) ?? 0}`)
      .join("\n")}\n`;
  }
}
