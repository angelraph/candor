import { NextResponse } from "next/server";
import { IntentRequestSchema } from "@candor/shared";
import { processIntent } from "@/lib/server/pipeline/intent-pipeline";
import { handlePipelineError } from "@/lib/server/pipeline/route-errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = IntentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const confirmCard = await processIntent(parsed.data);
    return NextResponse.json(confirmCard);
  } catch (err) {
    return handlePipelineError(err);
  }
}
