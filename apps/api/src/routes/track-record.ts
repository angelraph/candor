import type { FastifyInstance } from "fastify";
import { readLedgerStats } from "../integrations/ledger.js";

export async function trackRecordRoutes(app: FastifyInstance) {
  app.get("/api/track-record", async (_request, reply) => {
    const stats = await readLedgerStats();
    return reply.send(stats);
  });
}
