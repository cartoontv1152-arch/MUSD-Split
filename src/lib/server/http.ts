import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AmountError, LedgerError, SplitError } from "@/lib/engine";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = (msg = "Sign in with your wallet to continue") => new ApiError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You don't have access to this") => new ApiError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Not found") => new ApiError(404, "NOT_FOUND", msg);
export const badRequest = (msg: string, code = "BAD_REQUEST", details?: unknown) => new ApiError(400, code, msg, details);
export const conflict = (msg: string, code = "CONFLICT", details?: unknown) => new ApiError(409, code, msg, details);

/** JSON with bigint support (bigints become decimal strings). */
export function json(data: unknown, init?: ResponseInit): NextResponse {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const msg = first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input";
    return json({ error: { code: "VALIDATION", message: msg, details: e.issues } }, { status: 400 });
  }
  if (e instanceof SplitError || e instanceof AmountError || e instanceof LedgerError) {
    return json({ error: { code: (e as SplitError).code ?? "INVALID", message: e.message } }, { status: 400 });
  }
  console.error("[api] unhandled", e instanceof Error ? `${e.name}: ${e.message}` : e);
  return json({ error: { code: "INTERNAL", message: "Something went wrong on our side. Try again." } }, { status: 500 });
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence for cookie-authenticated mutations: if the browser sent an Origin header,
 * it must match the host we're serving. (Non-browser clients without Origin are allowed;
 * SameSite=Lax cookies already block cross-site form posts.)
 */
function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw forbidden("Cross-site request blocked");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw forbidden("Cross-site request blocked");
  }
}

type Ctx<P> = { params: Promise<P> };

export function route<P = Record<string, string>>(
  handler: (req: NextRequest, ctx: { params: P }) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await handler(req, { params });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw badRequest("Expected a JSON body", "BAD_CONTENT_TYPE");
  try {
    return await req.json();
  } catch {
    throw badRequest("Malformed JSON body");
  }
}
