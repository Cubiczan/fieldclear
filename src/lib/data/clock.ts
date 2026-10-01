export const SHOP_TZ = "America/New_York";

export function shopDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatShopTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatShopDay(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

/** Calendar tomorrow in the shop's timezone, anchored at midday so the label cannot slip. */
export function shopTomorrow(now = new Date()): Date {
  const [year, month, day] = shopDateKey(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, 16, 0, 0));
}

export function tomorrowLabel(now = new Date()): string {
  return formatShopDay(shopTomorrow(now));
}
