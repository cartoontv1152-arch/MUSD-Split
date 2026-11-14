/** Minimal API client for scripts: SIWE login with a local testnet key, then cookie-authenticated JSON calls. */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Hex, PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { mezoTestnet } from "../../src/config/chains";

export class ApiUser {
  cookie = "";
  constructor(
    public base: string,
    public name: string,
    public account: PrivateKeyAccount,
  ) {}
  get address() {
    return this.account.address.toLowerCase();
  }
  async req<T = Record<string, unknown>>(method: string, p: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(this.base + p, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), origin: this.base },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const m = /musd_split_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "");
    if (m) this.cookie = `musd_split_session=${m[1]}`;
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, data: data as T };
  }
  async login() {
    const { data } = await this.req<{ nonce: string }>("GET", "/api/auth/nonce");
    const url = new URL(this.base);
    const message = createSiweMessage({
      domain: url.host,
      address: this.account.address,
      statement: "Sign in to MUSD Split.",
      uri: url.origin,
      version: "1",
      chainId: mezoTestnet.id,
      nonce: data.nonce,
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 600_000),
    });
    const signature = await this.account.signMessage({ message });
    const r = await this.req("POST", "/api/auth/verify", { message, signature });
    if (r.status !== 200) throw new Error(`${this.name} login failed: ${JSON.stringify(r.data)}`);
  }
}

export function keyFromEnvFile(file: string): Hex {
  const raw = readFileSync(file, "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith("PRIVATE_KEY="));
  if (!line) throw new Error(`PRIVATE_KEY line not found in ${path.basename(file)}`);
  let k = line.trim().slice("PRIVATE_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!k.startsWith("0x")) k = `0x${k}`;
  return k as Hex;
}

export function testWallet(role: string, file = path.resolve(__dirname, "../../.env.e2e-wallets.json")): PrivateKeyAccount {
  const rows = (JSON.parse(readFileSync(file, "utf8")) as { split: Array<{ role: string; privateKey: Hex }> }).split;
  const row = rows.find((r) => r.role === role);
  if (!row) throw new Error(`no test wallet "${role}"`);
  return privateKeyToAccount(row.privateKey);
}
