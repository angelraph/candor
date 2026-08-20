import { NextResponse } from "next/server";
import { readLedgerStats } from "@/lib/server/integrations/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await readLedgerStats();
  return NextResponse.json(stats);
}
