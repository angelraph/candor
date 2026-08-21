import { NextResponse } from "next/server";
import { UnsupportedIntentError, UnsupportedChainError } from "./intent-pipeline";
import { VaultNotConfiguredError } from "../integrations/vault";
import { LlmNotConfiguredError } from "./agent-llm";
import { OkxDexUnreachableError } from "../integrations/okx-dex";

/** Shared pipeline-error -> HTTP response mapping for the intent routes.
 *  Lives outside route.ts because Next.js App Router only allows HTTP-verb
 *  exports (plus a small set of route config options) from a route file —
 *  anything else fails the build's route export validation. */
export function handlePipelineError(err: unknown): NextResponse {
  if (err instanceof UnsupportedChainError) {
    return NextResponse.json({ error: "unsupported_chain", message: err.message }, { status: 400 });
  }
  if (err instanceof UnsupportedIntentError) {
    return NextResponse.json({ error: "unsupported_intent", message: err.message }, { status: 422 });
  }
  if (err instanceof VaultNotConfiguredError) {
    return NextResponse.json({ error: "vault_not_configured", message: err.message }, { status: 503 });
  }
  if (err instanceof LlmNotConfiguredError) {
    return NextResponse.json({ error: "llm_not_configured", message: err.message }, { status: 503 });
  }
  if (err instanceof OkxDexUnreachableError) {
    return NextResponse.json({ error: "okx_dex_unreachable", message: err.message }, { status: 503 });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("unhandled pipeline error", err);
  return NextResponse.json({ error: "internal_error", message }, { status: 500 });
}
