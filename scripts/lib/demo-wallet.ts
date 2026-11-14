/**
 * A scripted browser wallet for Playwright: an EIP-1193 provider announced over EIP-6963, whose
 * signing happens in Node with a TESTNET key (never exposed to the page). Reads are forwarded to
 * the Mezo testnet RPC; transactions are signed locally and broadcast for real.
 */
import type { BrowserContext } from "playwright-core";
import { createPublicClient, createWalletClient, http, type Hex, type PrivateKeyAccount, type TypedDataDefinition } from "viem";
import { mezoTestnet } from "../../src/config/chains";

const rpc = mezoTestnet.rpcUrls.default.http[0];

const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#000"/><path d="M8 11h16v10H8z" fill="none" stroke="#fff" stroke-width="2"/><circle cx="20" cy="16" r="2" fill="#fff"/></svg>`);

/** EIP-712 JSON from eth_signTypedData_v4 -> viem's typed-data shape (uints as bigint, no EIP712Domain). */
function toViemTypedData(json: string): TypedDataDefinition {
  const td = JSON.parse(json) as { domain: Record<string, unknown>; types: Record<string, Array<{ name: string; type: string }>>; primaryType: string; message: Record<string, unknown> };
  const types = { ...td.types };
  delete types.EIP712Domain;
  const conv = (type: string, v: unknown): unknown => {
    if (type.endsWith("[]")) return (v as unknown[]).map((x) => conv(type.slice(0, -2), x));
    if (/^u?int\d*$/.test(type)) return BigInt(v as string);
    if (types[type]) return Object.fromEntries(types[type].map((f) => [f.name, conv(f.type, (v as Record<string, unknown>)[f.name])]));
    return v;
  };
  const domain = { ...td.domain } as Record<string, unknown>;
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  return { domain, types, primaryType: td.primaryType, message: conv(td.primaryType, td.message) } as unknown as TypedDataDefinition;
}

export async function injectWallet(context: BrowserContext, account: PrivateKeyAccount, opts: { name?: string; approveDelayMs?: number; onTx?: (hash: Hex) => void } = {}) {
  const pc = createPublicClient({ chain: mezoTestnet, transport: http(rpc, { retryCount: 3 }) });
  const wc = createWalletClient({ account, chain: mezoTestnet, transport: http(rpc) });
  const pause = () => new Promise((r) => setTimeout(r, opts.approveDelayMs ?? 600));

  await context.exposeFunction("__demoWalletRequest", async (method: string, paramsJson: string) => {
    const params = JSON.parse(paramsJson || "[]") as unknown[];
    if (process.env.DEMO_WALLET_DEBUG) console.log("wallet <-", method);
    try {
      let result: unknown;
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          result = [account.address];
          break;
        case "eth_chainId":
          result = `0x${mezoTestnet.id.toString(16)}`;
          break;
        case "net_version":
          result = String(mezoTestnet.id);
          break;
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          result = null;
          break;
        case "wallet_watchAsset":
          result = true;
          break;
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          result = [{ parentCapability: "eth_accounts" }];
          break;
        case "personal_sign": {
          await pause();
          result = await account.signMessage({ message: { raw: params[0] as Hex } });
          break;
        }
        case "eth_signTypedData_v4": {
          await pause();
          result = await account.signTypedData(toViemTypedData(params[1] as string));
          break;
        }
        case "eth_sendTransaction": {
          await pause();
          const tx = params[0] as { to?: Hex; data?: Hex; value?: Hex; gas?: Hex };
          const hash = await wc.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : 0n,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          });
          opts.onTx?.(hash);
          result = hash;
          break;
        }
        default:
          result = await pc.request({ method: method as never, params: params as never });
      }
      return JSON.stringify({ result });
    } catch (e) {
      const err = e as { code?: number; shortMessage?: string; message?: string };
      return JSON.stringify({ error: { code: err.code ?? -32603, message: err.shortMessage ?? err.message ?? String(e) } });
    }
  });

  const name = opts.name ?? "Demo Wallet";
  // Plain JS string on purpose: tsx/esbuild wraps compiled inner functions in a __name() helper
  // that doesn't exist inside the page, so a serialized TS function would throw silently.
  await context.addInitScript({
    content: `(() => {
  const listeners = {};
  const provider = {
    isDemoWallet: true,
    request: async ({ method, params }) => {
      const out = JSON.parse(await window.__demoWalletRequest(method, JSON.stringify(params || [])));
      if (out.error) { const err = new Error(out.error.message); err.code = out.error.code; throw err; }
      return out.result;
    },
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return provider; },
    removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); return provider; },
  };
  const info = { uuid: "6a8f1d2e-0b7c-4c1a-9d3e-5f2b7a9c1e01", name: ${JSON.stringify(name)}, icon: ${JSON.stringify(ICON)}, rdns: "org.musdsplit.demowallet" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  window.ethereum = provider;
})();`,
  });
}
