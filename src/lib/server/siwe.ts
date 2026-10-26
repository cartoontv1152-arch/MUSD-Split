import "server-only";
import { getAddress, recoverMessageAddress, type Hex } from "viem";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { CHAIN_ID } from "@/config/chains";
import { publicClient } from "./chain";
import { q, q1 } from "./db";
import { ApiError } from "./http";

const NONCE_TTL_MINUTES = 10;

export async function issueNonce(): Promise<string> {
  const nonce = generateSiweNonce();
  await q(`DELETE FROM split.auth_nonces WHERE expires_at < now() - interval '1 day'`);
  await q(
    `INSERT INTO split.auth_nonces (nonce, expires_at) VALUES ($1, now() + make_interval(mins => $2))`,
    [nonce, NONCE_TTL_MINUTES],
  );
  return nonce;
}

const fail = (msg: string, code = "SIWE_INVALID") => new ApiError(401, code, msg);

/**
 * Verify an EIP-4361 message + signature. Checks: domain == request host, URI on the same host,
 * chain id = Mezo testnet, issuedAt not in the future / not stale, expiration, single-use
 * server nonce (consumed atomically), then the signature (EOA via ecrecover; smart accounts
 * via ERC-1271/6492 through the RPC).
 */
export async function verifySiwe(message: string, signature: Hex, host: string): Promise<string> {
  if (typeof message !== "string" || message.length > 2000) throw fail("Malformed sign-in message");
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.nonce || !parsed.domain || !parsed.uri) throw fail("Malformed sign-in message");
  if (parsed.domain !== host) throw fail(`This sign-in message was made for ${parsed.domain}, not ${host}`, "SIWE_DOMAIN");
  try {
    if (new URL(parsed.uri).host !== host) throw new Error();
  } catch {
    throw fail("Sign-in URI doesn't match this site", "SIWE_URI");
  }
  if (parsed.chainId !== CHAIN_ID) throw fail("Sign-in must be for Mezo testnet (chain 31611)", "SIWE_CHAIN");
  if (parsed.version !== "1") throw fail("Unsupported sign-in message version");
  const now = Date.now();
  if (parsed.issuedAt) {
    const t = parsed.issuedAt.getTime();
    if (t > now + 5 * 60_000) throw fail("Sign-in message is from the future — check your clock");
    if (t < now - NONCE_TTL_MINUTES * 60_000) throw fail("Sign-in message expired, try again", "SIWE_EXPIRED");
  }
  if (parsed.expirationTime && parsed.expirationTime.getTime() < now) throw fail("Sign-in message expired, try again", "SIWE_EXPIRED");
  if (parsed.notBefore && parsed.notBefore.getTime() > now + 60_000) throw fail("Sign-in message isn't valid yet");

  // signature first (cheap, no state change), then burn the nonce
  const address = getAddress(parsed.address);
  let valid = false;
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    valid = recovered === address;
  } catch {
    valid = false;
  }
  if (!valid) {
    try {
      valid = await publicClient().verifyMessage({ address, message, signature });
    } catch {
      valid = false;
    }
  }
  if (!valid) throw fail("Signature doesn't match the wallet address", "SIWE_SIGNATURE");

  const used = await q1(
    `UPDATE split.auth_nonces SET used_at = now() WHERE nonce = $1 AND used_at IS NULL AND expires_at > now() RETURNING nonce`,
    [parsed.nonce],
  );
  if (!used) throw fail("This sign-in request was already used or expired. Try again.", "SIWE_NONCE");
  return address.toLowerCase();
}
