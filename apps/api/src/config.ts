import "dotenv/config";
import { z } from "zod";
import { AddressSchema, isSupportedChainId } from "@candor/shared";

/** dotenv leaves unset-but-present `KEY=` lines as `""`, not undefined —
 *  treat blank strings as absent so `.optional()` actually applies to them. */
function optionalEnv<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(8787),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  CHAIN_ID: z.coerce.number().int().refine(isSupportedChainId, {
    message: "CHAIN_ID must be 1952 (X Layer testnet) or 196 (X Layer mainnet)",
  }),
  RPC_URL: z.string().url(),

  ASSET_TOKEN_ADDRESS: optionalEnv(AddressSchema),
  RWA_VAULT_ADDRESS: optionalEnv(AddressSchema),
  REASONING_LEDGER_ADDRESS: optionalEnv(AddressSchema),
  AGENT_SIGNER_PRIVATE_KEY: optionalEnv(z.string().regex(/^0x[a-fA-F0-9]{64}$/)),

  OKX_DEX_API_KEY: optionalEnv(z.string()),
  OKX_DEX_API_SECRET: optionalEnv(z.string()),
  OKX_DEX_API_PASSPHRASE: optionalEnv(z.string()),
  OKX_DEX_PROJECT_ID: optionalEnv(z.string()),
  OKX_DEX_BASE_URL: z.string().url().default("https://web3.okx.com"),

  ANTHROPIC_API_KEY: optionalEnv(z.string()),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

/**
 * Central config object. Each `*Configured` flag drives an explicit mock/live
 * fallback at the integration boundary — never a silent one — so it's always
 * obvious from a log line which mode a given request ran in.
 */
export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === "production",

  chainId: env.CHAIN_ID,
  rpcUrl: env.RPC_URL,

  contracts: {
    assetToken: env.ASSET_TOKEN_ADDRESS ?? null,
    rwaVault: env.RWA_VAULT_ADDRESS ?? null,
    reasoningLedger: env.REASONING_LEDGER_ADDRESS ?? null,
  },
  contractsConfigured: Boolean(env.RWA_VAULT_ADDRESS && env.REASONING_LEDGER_ADDRESS),

  agentSignerPrivateKey: env.AGENT_SIGNER_PRIVATE_KEY ?? null,
  agentSignerConfigured: Boolean(env.AGENT_SIGNER_PRIVATE_KEY),

  okxDex: {
    baseUrl: env.OKX_DEX_BASE_URL,
    apiKey: env.OKX_DEX_API_KEY ?? null,
    apiSecret: env.OKX_DEX_API_SECRET ?? null,
    apiPassphrase: env.OKX_DEX_API_PASSPHRASE ?? null,
    projectId: env.OKX_DEX_PROJECT_ID ?? null,
  },
  okxDexConfigured: Boolean(env.OKX_DEX_API_KEY && env.OKX_DEX_API_SECRET && env.OKX_DEX_API_PASSPHRASE),

  anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
  anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY),
} as const;

export type Config = typeof config;
