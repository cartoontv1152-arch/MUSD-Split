import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { unauthorized } from "./http";

export const SESSION_COOKIE = "musd_split_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const ISSUER = "musd-split";

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is missing or too short");
  return new TextEncoder().encode(s);
}

export interface Session {
  address: string; // lowercase 0x-address
}

export async function createSessionToken(address: string): Promise<string> {
  return new SignJWT({ addr: address.toLowerCase() })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(address.toLowerCase())
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function readSessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, algorithms: ["HS256"] });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub || !/^0x[0-9a-f]{40}$/.test(sub)) return null;
    return { address: sub };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function getSession(req?: NextRequest): Promise<Session | null> {
  const token = req ? req.cookies.get(SESSION_COOKIE)?.value : (await cookies()).get(SESSION_COOKIE)?.value;
  return readSessionToken(token);
}

export async function requireSession(req?: NextRequest): Promise<Session> {
  const s = await getSession(req);
  if (!s) throw unauthorized();
  return s;
}
