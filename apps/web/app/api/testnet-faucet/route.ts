import { NextResponse } from "next/server";
import { z } from "zod";
import { AddressSchema } from "@candor/shared";
import { requestTestnetFaucet, FaucetNotAvailableError } from "@/lib/server/integrations/testnet-faucet";

export const dynamic = "force-dynamic";

const FaucetRequestSchema = z.object({ address: AddressSchema });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = FaucetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const txHash = await requestTestnetFaucet(parsed.data.address as `0x${string}`);
    return NextResponse.json({ txHash });
  } catch (err) {
    if (err instanceof FaucetNotAvailableError) {
      return NextResponse.json({ error: "faucet_not_available", message: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("testnet faucet error", err);
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}
