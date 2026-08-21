import { z } from "zod";
import { AddressSchema, X_LAYER_MAINNET, X_LAYER_TESTNET, isSupportedChainId } from "@candor/shared";

/** Blank env values (e.g. an unset-but-present Vercel var) should be treated
 *  as absent so `.optional()` actually applies to them. */
function optionalEnv<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
}

const EnvSchema = z.object({
  // Mainnet is the only chain whose contracts/RPC are env-configured — it's
  // the one deploy that involves real funds and a real stablecoin address,
  // so those stay secrets. Testnet's contracts were deployed once, are
  // permanent, and are already public (anyone can read them off-chain or in
  // this repo's Foundry broadcast log), so they're plain constants below
  // instead of needing their own env vars.
  RPC_URL: z.string().url(),
  ASSET_TOKEN_ADDRESS: optionalEnv(AddressSchema),
  RWA_VAULT_ADDRESS: optionalEnv(AddressSchema),
  REASONING_LEDGER_ADDRESS: optionalEnv(AddressSchema),

  // Same signer is authorized on both chains' ReasoningLedger (verified
  // against the testnet deploy's broadcast log) — one key, no per-chain
  // config needed.
  AGENT_SIGNER_PRIVATE_KEY: optionalEnv(z.string().regex(/^0x[a-fA-F0-9]{64}$/)),

  OKX_DEX_API_KEY: optionalEnv(z.string()),
  OKX_DEX_API_SECRET: optionalEnv(z.string()),
  OKX_DEX_API_PASSPHRASE: optionalEnv(z.string()),
  OKX_DEX_PROJECT_ID: optionalEnv(z.string()),
  OKX_DEX_BASE_URL: z.string().url().default("https://web3.okx.com"),

  OPENAI_API_KEY: optionalEnv(z.string()),

  // Signs the confirm-card token handed back to the browser between
  // POST /api/intent and POST /api/intent/:hash/finalize. There's no
  // server-side session store on Vercel's serverless runtime (no guarantee
  // two requests hit the same instance), so the card's state travels in the
  // token itself instead of a backend Map; this secret is what keeps the
  // browser from being able to forge or edit it.
  CONFIRM_CARD_SECRET: z.string().min(32, "CONFIRM_CARD_SECRET must be at least 32 characters"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
}

const env = parsed.data;

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  contracts: {
    assetToken: string | null;
    rwaVault: string | null;
    reasoningLedger: string | null;
  };
  contractsConfigured: boolean;
}

// Deployed once via packages/contracts/script/Deploy.s.sol, recorded in
// packages/contracts/broadcast/Deploy.s.sol/1952/run-latest.json. DemoUSDT
// stands in for a real stablecoin on testnet (see token-registry.ts's USDT
// alias) so "swap 10 USDT" works the same way it does on mainnet.
const TESTNET_CONTRACTS = {
  assetToken: "0x8b5355cd5ed88f6e70ea47c9dacc8bd2015a3bf7",
  rwaVault: "0xbc1dc9d5c46a571711c48788c4ae0353b2997055",
  reasoningLedger: "0x13ba864fc340049068525edd861a1205c4fd90ac",
} as const;

const CHAINS: Record<number, ChainConfig> = {
  [X_LAYER_MAINNET.id]: {
    chainId: X_LAYER_MAINNET.id,
    rpcUrl: env.RPC_URL,
    contracts: {
      assetToken: env.ASSET_TOKEN_ADDRESS ?? null,
      rwaVault: env.RWA_VAULT_ADDRESS ?? null,
      reasoningLedger: env.REASONING_LEDGER_ADDRESS ?? null,
    },
    contractsConfigured: Boolean(env.RWA_VAULT_ADDRESS && env.REASONING_LEDGER_ADDRESS),
  },
  [X_LAYER_TESTNET.id]: {
    chainId: X_LAYER_TESTNET.id,
    rpcUrl: X_LAYER_TESTNET.rpcUrls.default.http[0],
    contracts: TESTNET_CONTRACTS,
    contractsConfigured: true,
  },
};

export class UnsupportedChainError extends Error {
  constructor(chainId: number) {
    super(`Chain ${chainId} is not supported — use X Layer mainnet (196) or testnet (1952)`);
    this.name = "UnsupportedChainError";
  }
}

export function getChainConfig(chainId: number): ChainConfig {
  const chain = CHAINS[chainId];
  if (!chain) throw new UnsupportedChainError(chainId);
  return chain;
}

/**
 * Config that doesn't vary by chain: the same LLM/OKX/agent-signer
 * credentials serve every supported chain, and each `*Configured` flag
 * drives an explicit mock/live fallback at the integration boundary — never
 * a silent one — so it's always obvious from a log line which mode a given
 * request ran in.
 */
export const config = {
  chains: CHAINS,
  isSupportedChain: isSupportedChainId,

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

  llmApiKey: env.OPENAI_API_KEY ?? null,
  llmConfigured: Boolean(env.OPENAI_API_KEY),

  confirmCardSecret: env.CONFIRM_CARD_SECRET,
} as const;

export type Config = typeof config;
