export function formatVndMinor(amountMinor: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(amountMinor)) {
    return "—";
  }

  return `${amountMinor.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ₫`;
}
