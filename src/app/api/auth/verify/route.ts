import { z } from "zod";
import { json, readJson, route } from "@/lib/server/http";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/server/session";
import { verifySiwe } from "@/lib/server/siwe";
import { ensureUser, getMe } from "@/lib/server/users";

export const dynamic = "force-dynamic";

const body = z.object({
  message: z.string().min(50).max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export const POST = route(async (req) => {
  const { message, signature } = body.parse(await readJson(req));
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const address = await verifySiwe(message, signature as `0x${string}`, host);
  await ensureUser(address);
  const token = await createSessionToken(address);
  const res = json({ address, user: await getMe(address) });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
