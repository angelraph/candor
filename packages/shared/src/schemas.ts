import { z } from "zod";

/**
 * Shared contract between apps/api and apps/web for the Candor pipeline:
 *   NL intent -> Action -> Quote/Simulation + RiskVerdict -> ConfirmCard -> LedgerEntry
 *
 * Kept deliberately small and explicit — every field here is something the
 * confirm card actually shows the user or the ReasoningLedger actually anchors.
 */

export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 20-byte address");

export const HexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]*$/, "must be 0x-prefixed hex");

export const Bytes32Schema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x-prefixed 32-byte hash");

// ---------------------------------------------------------------------------
// Actions — the structured output of intent parsing (fast-path or Claude).
// ---------------------------------------------------------------------------

export const ActionTypeSchema = z.enum(["swap", "vault_deposit"]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const SwapParamsSchema = z.object({
  fromToken: AddressSchema,
  toToken: AddressSchema,
  amountWei: z.string().regex(/^\d+$/, "amount must be a base-10 wei string"),
  slippageBps: z.number().int().min(0).max(10_000).default(50),
});
export type SwapParams = z.infer<typeof SwapParamsSchema>;

export const VaultDepositParamsSchema = z.object({
  vaultAddress: AddressSchema,
  assetToken: AddressSchema,
  amountWei: z.string().regex(/^\d+$/, "amount must be a base-10 wei string"),
});
export type VaultDepositParams = z.infer<typeof VaultDepositParamsSchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("swap"),
    params: SwapParamsSchema,
  }),
  z.object({
    type: z.literal("vault_deposit"),
    params: VaultDepositParamsSchema,
  }),
]);
export type Action = z.infer<typeof ActionSchema>;

// ---------------------------------------------------------------------------
// Quote / simulation — deterministic facts computed server-side, never
// invented by a model. These are the numbers the risk engine judges against.
// ---------------------------------------------------------------------------

export const QuoteSchema = z.object({
  expectedOutWei: z.string(),
  minReceivedWei: z.string(),
  priceImpactBps: z.number(),
  liquidityDepthUsd: z.number().nonnegative(),
  route: z.array(z.string()),
  gasEstimateWei: z.string(),
  // True when OKX_DEX_API_KEY wasn't configured and this is a synthetic
  // quote — surfaced end-to-end (not just logged server-side) so the
  // confirm card can show it honestly rather than presenting mock numbers
  // as if they were live market data.
  mock: z.boolean().default(false),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const VaultStateSchema = z.object({
  aprBps: z.number().int().nonnegative(),
  totalAssetsWei: z.string(),
  capWei: z.string().nullable(),
  utilizationBps: z.number().int().min(0).max(10_000),
});
export type VaultState = z.infer<typeof VaultStateSchema>;

// ---------------------------------------------------------------------------
// Risk verdict — the core Candor primitive. Computed once per intent,
// anchored on-chain via ReasoningLedger regardless of which verdict it is.
// ---------------------------------------------------------------------------

export const VerdictTypeSchema = z.enum([
  "EXECUTE",
  "EXECUTE_SMALLER",
  "WAIT",
  "REJECT",
]);
export type VerdictType = z.infer<typeof VerdictTypeSchema>;

export const RiskFeaturesSchema = z.object({
  priceImpactBps: z.number(),
  liquidityDepthUsd: z.number().nonnegative(),
  requestedSizeUsd: z.number().nonnegative(),
  sizeToLiquidityBps: z.number().nonnegative(),
  poolUtilizationBps: z.number().int().min(0).max(10_000).optional(),
  volatilityBps: z.number().nonnegative().optional(),
});
export type RiskFeatures = z.infer<typeof RiskFeaturesSchema>;

export const RiskVerdictSchema = z.object({
  verdict: VerdictTypeSchema,
  riskScore: z.number().int().min(0).max(100),
  rationale: z.string().min(1).max(500),
  suggestedAmountWei: z.string().nullable(),
  source: z.enum(["rule", "llm"]),
  features: RiskFeaturesSchema,
});
export type RiskVerdict = z.infer<typeof RiskVerdictSchema>;

// ---------------------------------------------------------------------------
// Intent request/response — the /api/intent contract.
// ---------------------------------------------------------------------------

export const IntentRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  userAddress: AddressSchema,
  chainId: z.number().int(),
});
export type IntentRequest = z.infer<typeof IntentRequestSchema>;

export const LatencyBreakdownSchema = z.object({
  classifyMs: z.number().nonnegative(),
  quoteMs: z.number().nonnegative(),
  simulateMs: z.number().nonnegative(),
  verdictMs: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
});
export type LatencyBreakdown = z.infer<typeof LatencyBreakdownSchema>;

export const ConfirmCardSchema = z.object({
  action: ActionSchema,
  quote: QuoteSchema.nullable(),
  vaultState: VaultStateSchema.nullable(),
  verdict: RiskVerdictSchema,
  latency: LatencyBreakdownSchema,
  intentHash: Bytes32Schema,
  evidenceHash: Bytes32Schema,
  preparedAt: z.number().int(),
  expiresAt: z.number().int(),
  // Which chain this card was prepared against (X Layer mainnet or
  // testnet) — the frontend checks the wallet is still on this chain
  // before finalizing, since switching mid-flow would sign a testnet tx
  // against a mainnet-prepared card or vice versa.
  chainId: z.number().int(),
  // Opaque signed token carrying this card's server-side state (prepared tx,
  // who it's for) — there's no backend session store on serverless, so the
  // browser must echo this back on /finalize instead of the server looking
  // it up by intentHash. See apps/web/lib/server/pipeline/confirm-token.ts.
  token: z.string(),
});
export type ConfirmCard = z.infer<typeof ConfirmCardSchema>;

// ---------------------------------------------------------------------------
// Reasoning ledger — mirrors ReasoningLedger.sol's recordVerdict() call and
// what the Track Record page reads back out.
// ---------------------------------------------------------------------------

export const LedgerEntrySchema = z.object({
  intentHash: Bytes32Schema,
  evidenceHash: Bytes32Schema,
  verdict: VerdictTypeSchema,
  riskScore: z.number().int().min(0).max(100),
  overrode: z.boolean(),
  userAddress: AddressSchema,
  timestamp: z.number().int(),
  txHash: HexSchema,
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const LedgerStatsSchema = z.object({
  totalVerdicts: z.number().int().nonnegative(),
  executeCount: z.number().int().nonnegative(),
  executeSmallerCount: z.number().int().nonnegative(),
  waitCount: z.number().int().nonnegative(),
  rejectCount: z.number().int().nonnegative(),
  overrodeCount: z.number().int().nonnegative(),
});
export type LedgerStats = z.infer<typeof LedgerStatsSchema>;
