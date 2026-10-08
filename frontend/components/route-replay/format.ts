const TZ = "Asia/Kolkata";

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** "11:42 AM" in Asia/Kolkata. */
export function fmtTime(ms: number): string {
  return timeFmt.format(new Date(ms));
}

/** "Tue, 6 Oct 2026" for a YYYY-MM-DD string. */
export function fmtDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return ymd;
  return dateFmt.format(d).replace(/^(\w{3}) /, "$1, ");
}

/** "3h 10m", "45m", "50s". */
export function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "12.4 km" or "850 m". */
export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** Shift a YYYY-MM-DD string by whole days. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The tracking window of the day a moment falls on: 9:00 AM to 6:00 PM in
 * Asia/Kolkata. The route screens show the day as starting at 9:00 AM and
 * ending at 6:00 PM, whatever the first and last recorded positions are.
 */
export function trackingWindow(ms: number): { start: number; end: number } {
  const ymd = ymdFmt.format(new Date(ms));
  return {
    start: new Date(`${ymd}T09:00:00+05:30`).getTime(),
    end: new Date(`${ymd}T18:00:00+05:30`).getTime(),
  };
}
