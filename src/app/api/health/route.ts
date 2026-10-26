import { CHAIN_ID } from "@/config/chains";
import { publicClient } from "@/lib/server/chain";
import { q } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const started = Date.now();
  const [db, rpc] = await Promise.allSettled([
    q<{ ok: number }>(`SELECT 1 AS ok FROM split.schema_migrations LIMIT 1`),
    (async () => {
      const pc = publicClient();
      const [chainId, blockNumber] = await Promise.all([pc.getChainId(), pc.getBlockNumber()]);
      return { chainId, blockNumber };
    })(),
  ]);
  const rpcOk = rpc.status === "fulfilled" && rpc.value.chainId === CHAIN_ID;
  const body = {
    db: db.status === "fulfilled" ? "ok" : "error",
    rpc: rpcOk ? "ok" : "error",
    chainId: rpc.status === "fulfilled" ? rpc.value.chainId : null,
    expectedChainId: CHAIN_ID,
    blockNumber: rpc.status === "fulfilled" ? rpc.value.blockNumber.toString() : null,
    time: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
  return json(body, { status: body.db === "ok" && rpcOk ? 200 : 503 });
});
