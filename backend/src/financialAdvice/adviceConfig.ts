export type FinancialAdviceConfig = {
  enabled: boolean;
  maxBodyBytes: number;
};

export const DEFAULT_MAX_ADVICE_BODY_BYTES = 8_192;

export function resolveFinancialAdviceConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: Partial<FinancialAdviceConfig>,
): FinancialAdviceConfig {
  const enabled = overrides?.enabled ?? env.FINANCIAL_ADVICE_ENABLED === "1";
  const maxBodyBytes = overrides?.maxBodyBytes ?? DEFAULT_MAX_ADVICE_BODY_BYTES;
  return {
    enabled,
    maxBodyBytes,
  };
}
