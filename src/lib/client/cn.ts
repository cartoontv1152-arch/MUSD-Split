import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(a: string | null | undefined, lead = 6, tail = 4): string {
  if (!a) return "";
  return `${a.slice(0, lead)}…${a.slice(-tail)}`;
}

export function relativeTime(iso: string | Date, now = Date.now()): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const s = Math.round((now - t) / 1000);
  const abs = Math.abs(s);
  const fmt = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;
  let out: string;
  if (abs < 45) out = "just now";
  else if (abs < 3600) out = fmt(Math.round(abs / 60), "minute");
  else if (abs < 86400) out = fmt(Math.round(abs / 3600), "hour");
  else if (abs < 86400 * 30) out = fmt(Math.round(abs / 86400), "day");
  else return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (out === "just now") return out;
  return s >= 0 ? `${out} ago` : `in ${out}`;
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00Z") : new Date(iso);
  return d.toLocaleDateString(undefined, opts);
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
