import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    chainId: config.chainId,
    contractsConfigured: config.contractsConfigured,
    agentSignerConfigured: config.agentSignerConfigured,
    okxDexConfigured: config.okxDexConfigured,
    llmConfigured: config.llmConfigured,
  }));
}
