import { NextResponse } from "next/server";
import { isSupportedChainId, X_LAYER_MAINNET } from "@candor/shared";
import { readLedgerStats } from "@/lib/server/integrations/ledger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const chainIdParam = new URL(request.url).searchParams.get("chainId");
  const chainId = chainIdParam ? Number(chainIdParam) : X_LAYER_MAINNET.id;

  if (!Number.isInteger(chainId) || !isSupportedChainId(chainId)) {
    return NextResponse.json({ error: "unsupported_chain", message: `Chain ${chainIdParam} is not supported` }, { status: 400 });
  }

  const stats = await readLedgerStats(chainId);
  return NextResponse.json(stats);
}
