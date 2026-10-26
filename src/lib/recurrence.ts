/**
 * Recurring-expense schedule math (pure, UTC date strings YYYY-MM-DD).
 * Monthly schedules keep their anchor day and clamp to the month's last day
 * (e.g. anchored on the 31st -> Feb 28/29, Mar 31, Apr 30 ...).
 */

export type Cadence = "weekly" | "monthly";

function parse(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(d: string, n: number): string {
  const { y, m, day } = parse(d);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function nextOccurrence(current: string, cadence: Cadence, interval = 1, anchorDay?: number | null): string {
  if (interval < 1) throw new Error("interval must be >= 1");
  if (cadence === "weekly") return addDays(current, 7 * interval);
  const { y, m, day } = parse(current);
  const anchor = anchorDay ?? day;
  const total = y * 12 + (m - 1) + interval;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(anchor, daysInMonth(ny, nm)));
}

/** All run dates <= today starting at `next` (capped), and the following next date. */
export function dueRuns(
  next: string,
  today: string,
  cadence: Cadence,
  interval = 1,
  anchorDay?: number | null,
  endOn?: string | null,
  cap = 3,
): { runs: string[]; next: string; finished: boolean } {
  const runs: string[] = [];
  let cur = next;
  while (cur <= today && runs.length < cap) {
    if (endOn && cur > endOn) break;
    runs.push(cur);
    cur = nextOccurrence(cur, cadence, interval, anchorDay);
  }
  const finished = !!endOn && cur > endOn;
  return { runs, next: cur, finished };
}

export function todayUTC(now = new Date()): string {
  return fmt(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

export function daysBetween(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.day) - Date.UTC(pa.y, pa.m - 1, pa.day)) / 86_400_000);
}
