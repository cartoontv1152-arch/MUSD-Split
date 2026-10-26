import "server-only";
import { badRequest } from "./http";

/** Sniff the real file type from magic bytes — never trust the client's Content-Type. */
export function sniffMime(buf: Uint8Array): string | null {
  const b = buf;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return "image/webp";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  return null;
}

export async function readUpload(form: FormData, field: string, opts: { maxBytes: number; allowed: readonly string[] }) {
  const f = form.get(field);
  if (!f || typeof f === "string") throw badRequest("Attach a file", "NO_FILE");
  if (f.size === 0) throw badRequest("The file is empty", "EMPTY_FILE");
  if (f.size > opts.maxBytes) throw badRequest(`File is too large (max ${Math.round(opts.maxBytes / 1024)} KB)`, "FILE_TOO_LARGE");
  const buf = new Uint8Array(await f.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime || !opts.allowed.includes(mime)) throw badRequest("Unsupported file type (use PNG, JPEG, WebP or PDF)", "BAD_FILE_TYPE");
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", buf)).toString("hex");
  const name = (f as File).name?.slice(0, 120) || null;
  return { buf, mime, size: buf.length, sha256: hash, name };
}
