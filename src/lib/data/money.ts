export function formatDollars(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function parseAmountCents(text: string): number | null {
  const dollar = text.match(
    /\$\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/,
  );
  const words = text.match(
    /\b(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s*dollars?\b/,
  );
  const match = dollar ?? words;
  if (!match) return null;
  const whole = Number(match[1].replace(/,/g, ""));
  const fraction = Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (!Number.isFinite(whole) || !Number.isFinite(fraction)) return null;
  return whole * 100 + fraction;
}
