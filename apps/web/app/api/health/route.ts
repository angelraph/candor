import { NextResponse } from "next/server";
import { config } from "@/lib/server/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    chainId: config.chainId,
    contractsConfigured: config.contractsConfigured,
    agentSignerConfigured: config.agentSignerConfigured,
    okxDexConfigured: config.okxDexConfigured,
    llmConfigured: config.llmConfigured,
  });
}
