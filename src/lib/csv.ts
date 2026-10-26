/**
 * RFC 4180 CSV with spreadsheet formula-injection protection: text cells that start with
 * = + - @ (or tab/CR) are prefixed with a single quote so Excel/Sheets treat them as text.
 * Numeric cells (amounts) are passed as numbers-as-strings and are not prefixed.
 */
export type Cell = string | number | bigint | boolean | null | undefined | { raw: string };

function cellToString(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "object") return c.raw; // trusted numeric string, e.g. "-30.00"
  if (typeof c === "number" || typeof c === "bigint" || typeof c === "boolean") return String(c);
  return /^[=+\-@\t\r]/.test(c) ? `'${c}` : c;
}

function escape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map((c) => escape(cellToString(c))).join(",")).join("\r\n") + "\r\n";
}
