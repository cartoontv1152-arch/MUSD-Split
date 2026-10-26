import { NextResponse } from "next/server";
import { CHAIN_ID } from "@/config/chains";
import { MUSD, SETTLEMENT_CONTRACT, musdAbi } from "@/config/contracts";
import { publicClient } from "@/lib/server/chain";

export const dynamic = "force-dynamic";

/** Live, real numbers for the landing page & status badge (cached 15s at the edge). */
export async function GET() {
  try {
    const pc = publicClient();
    const [blockNumber, totalSupply, gasPrice, block] = await Promise.all([
      pc.getBlockNumber(),
      pc.readContract({ address: MUSD.address, abi: musdAbi, functionName: "totalSupply" }),
      pc.getGasPrice(),
      pc.getBlock(),
    ]);
    return NextResponse.json(
      {
        ok: true,
        chainId: CHAIN_ID,
        blockNumber: blockNumber.toString(),
        blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
        musdTotalSupply: totalSupply.toString(),
        gasPriceWei: gasPrice.toString(),
        musd: MUSD.address,
        settlementContract: SETTLEMENT_CONTRACT.address,
      },
      { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=30" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.split("\n")[0] }, { status: 503 });
  }
}
