import { NextResponse } from "next/server";
import { z } from "zod";
import { finalizeIntent, ConfirmCardExpiredError } from "@/lib/server/pipeline/intent-pipeline";
import { handlePipelineError } from "@/lib/server/pipeline/route-errors";

export const dynamic = "force-dynamic";

const FinalizeBodySchema = z.object({
  decision: z.enum(["confirm", "override", "dismiss"]),
  token: z.string().min(1),
});

export async function POST(request: Request, { params }: { params: { intentHash: string } }) {
  const body = await request.json().catch(() => null);
  const parsed = FinalizeBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await finalizeIntent(params.intentHash, parsed.data.decision, parsed.data.token);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ConfirmCardExpiredError) {
      return NextResponse.json({ error: "confirm_card_expired", message: err.message }, { status: 410 });
    }
    return handlePipelineError(err);
  }
}
