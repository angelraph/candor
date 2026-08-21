import { NextResponse } from "next/server";
import { X_LAYER_MAINNET, X_LAYER_TESTNET } from "@candor/shared";
import { config } from "@/lib/server/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    chains: {
      [X_LAYER_MAINNET.id]: { contractsConfigured: config.chains[X_LAYER_MAINNET.id].contractsConfigured },
      [X_LAYER_TESTNET.id]: { contractsConfigured: config.chains[X_LAYER_TESTNET.id].contractsConfigured },
    },
    agentSignerConfigured: config.agentSignerConfigured,
    okxDexConfigured: config.okxDexConfigured,
    llmConfigured: config.llmConfigured,
  });
}
