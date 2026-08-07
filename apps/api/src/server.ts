import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { intentRoutes } from "./routes/intent.js";
import { trackRecordRoutes } from "./routes/track-record.js";

const app = Fastify({
  logger: {
    level: config.isProd ? "info" : "debug",
    transport: config.isProd ? undefined : { target: "pino-pretty", options: { colorize: true } },
  },
});

await app.register(cors, { origin: true });
await app.register(healthRoutes);
await app.register(intentRoutes);
await app.register(trackRecordRoutes);

app.setErrorHandler((err: Error, _request, reply) => {
  app.log.error(err);
  reply.status(500).send({ error: "internal_error", message: err.message });
});

const address = await app.listen({ port: config.port, host: "0.0.0.0" });

app.log.info(`Candor API listening at ${address}`);
app.log.info(
  `Mode: chain=${config.chainId} contracts=${config.contractsConfigured ? "configured" : "MOCK"} ` +
    `okxDex=${config.okxDexConfigured ? "live" : "MOCK"} anthropic=${config.anthropicConfigured ? "live" : "unavailable"}`
);
