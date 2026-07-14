/** Money is stored in cents everywhere. It is never a float in the database. */
export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function moneyShort(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function dollarsToCents(dollars: string | number): number {
  const n = typeof dollars === "string" ? Number.parseFloat(dollars) : dollars;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DATE_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function shortDate(d: Date | string): string {
  return DATE.format(new Date(d));
}

export function fullDate(d: Date | string): string {
  return DATE_YEAR.format(new Date(d));
}

export function dateTime(d: Date | string): string {
  return DATE_TIME.format(new Date(d));
}

export function isoDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** "3 days ago" / "in 2 days" — how ops people actually talk about dates. */
export function relative(d: Date | string): string {
  const ms = new Date(d).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);

  if (Math.abs(ms) < 3_600_000) {
    const mins = Math.round(ms / 60_000);
    if (mins === 0) return "just now";
    return mins < 0 ? `${-mins}m ago` : `in ${mins}m`;
  }
  if (Math.abs(days) < 1) {
    const hours = Math.round(ms / 3_600_000);
    return hours < 0 ? `${-hours}h ago` : `in ${hours}h`;
  }
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days < 0 ? `${-days} days ago` : `in ${days} days`;
}

/** Is this moment in the past? Lives here so callers don't call Date.now() in render. */
export function isPast(d: Date | string): boolean {
  return new Date(d).getTime() < Date.now();
}

export function daysUntil(d: Date | string): number {
  return Math.floor((new Date(d).getTime() - Date.now()) / 86_400_000);
}

export function lane(
  originCity: string,
  originState: string,
  destCity: string,
  destState: string,
): string {
  return `${originCity}, ${originState} → ${destCity}, ${destState}`;
}

export function weight(lbs: number): string {
  return `${lbs.toLocaleString("en-US")} lb`;
}

export const EQUIPMENT_TYPES = [
  "Dry Van",
  "Reefer",
  "Flatbed",
  "Step Deck",
  "Tanker",
  "Power Only",
] as const;

export const COMMODITY_TYPES = [
  "General Freight",
  "Produce",
  "Electronics",
  "Building Materials",
  "Beverages",
  "Steel",
  "Paper Goods",
  "Hazmat",
] as const;
