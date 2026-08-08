import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IntentRequestSchema } from "@candor/shared";
import {
  processIntent,
  finalizeIntent,
  ledgerStatus,
  UnsupportedIntentError,
  ConfirmCardExpiredError,
} from "../pipeline/intent-pipeline.js";
import { VaultNotConfiguredError } from "../integrations/vault.js";
import { AnthropicNotConfiguredError } from "../pipeline/agent-llm.js";
import { OkxDexUnreachableError } from "../integrations/okx-dex.js";

const FinalizeBodySchema = z.object({
  decision: z.enum(["confirm", "override", "dismiss"]),
});

export async function intentRoutes(app: FastifyInstance) {
  app.post("/api/intent", async (request, reply) => {
    const parsed = IntentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }

    try {
      const confirmCard = await processIntent(parsed.data);
      return reply.send(confirmCard);
    } catch (err) {
      return handlePipelineError(err, reply);
    }
  });

  app.post<{ Params: { intentHash: string } }>("/api/intent/:intentHash/finalize", async (request, reply) => {
    const body = FinalizeBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "invalid_request", details: body.error.flatten() });
    }

    try {
      const result = finalizeIntent(request.params.intentHash, body.data.decision);
      return reply.send(result);
    } catch (err) {
      return handlePipelineError(err, reply);
    }
  });

  app.get<{ Params: { intentHash: string } }>("/api/intent/:intentHash/ledger-status", async (request, reply) => {
    return reply.send(ledgerStatus(request.params.intentHash));
  });
}

function handlePipelineError(err: unknown, reply: import("fastify").FastifyReply) {
  if (err instanceof UnsupportedIntentError) {
    return reply.status(422).send({ error: "unsupported_intent", message: err.message });
  }
  if (err instanceof VaultNotConfiguredError) {
    return reply.status(503).send({ error: "vault_not_configured", message: err.message });
  }
  if (err instanceof AnthropicNotConfiguredError) {
    return reply.status(503).send({ error: "llm_not_configured", message: err.message });
  }
  if (err instanceof OkxDexUnreachableError) {
    return reply.status(503).send({ error: "okx_dex_unreachable", message: err.message });
  }
  if (err instanceof ConfirmCardExpiredError) {
    return reply.status(410).send({ error: "confirm_card_expired", message: err.message });
  }
  const message = err instanceof Error ? err.message : String(err);
  reply.log.error({ err }, "unhandled pipeline error");
  return reply.status(500).send({ error: "internal_error", message });
}
