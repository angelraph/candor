import type { Hex } from "viem";
import { config } from "../config.js";
import { agentWalletClient, publicClient } from "./viem-clients.js";
import type { LedgerStats, VerdictType } from "@candor/shared";

/** Minimal ABI — just the functions Candor's backend actually calls/reads. */
const REASONING_LEDGER_ABI = [
  {
    type: "function",
    name: "recordVerdict",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "verdict", type: "uint8" },
      { name: "riskScore", type: "uint8" },
      { name: "overrode", type: "bool" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "entryId", type: "uint256" }],
  },
  {
    type: "function",
    name: "hasEntry",
    stateMutability: "view",
    inputs: [{ name: "intentHash", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getStats",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "totalVerdicts", type: "uint256" },
      { name: "execute_", type: "uint256" },
      { name: "executeSmaller_", type: "uint256" },
      { name: "wait_", type: "uint256" },
      { name: "reject_", type: "uint256" },
      { name: "overrode_", type: "uint256" },
    ],
  },
] as const;

const VERDICT_ENUM: Record<VerdictType, number> = {
  EXECUTE: 0,
  EXECUTE_SMALLER: 1,
  WAIT: 2,
  REJECT: 3,
};

export type LedgerAnchorStatus = "unconfigured" | "pending" | "confirmed" | "failed";

export interface AnchorRecord {
  status: LedgerAnchorStatus;
  txHash: Hex | null;
  error: string | null;
}

/** In-memory tracker keyed by intentHash — fine for a single hackathon instance;
 *  swap for Redis if this ever needs to survive a restart or run multi-instance. */
const anchorStatusByIntentHash = new Map<string, AnchorRecord>();

export function getLedgerStatus(intentHash: string): AnchorRecord {
  return anchorStatusByIntentHash.get(intentHash) ?? { status: "unconfigured", txHash: null, error: null };
}

const EMPTY_STATS: LedgerStats = {
  totalVerdicts: 0,
  executeCount: 0,
  executeSmallerCount: 0,
  waitCount: 0,
  rejectCount: 0,
  overrodeCount: 0,
};

/** Cheap aggregate read for the Track Record page — no indexer needed. */
export async function readLedgerStats(): Promise<LedgerStats> {
  if (!config.contracts.reasoningLedger) return EMPTY_STATS;

  const [totalVerdicts, executeCount, executeSmallerCount, waitCount, rejectCount, overrodeCount] =
    await publicClient.readContract({
      address: config.contracts.reasoningLedger as Hex,
      abi: REASONING_LEDGER_ABI,
      functionName: "getStats",
    });

  return {
    totalVerdicts: Number(totalVerdicts),
    executeCount: Number(executeCount),
    executeSmallerCount: Number(executeSmallerCount),
    waitCount: Number(waitCount),
    rejectCount: Number(rejectCount),
    overrodeCount: Number(overrodeCount),
  };
}

/**
 * Fire-and-forget anchor of a verdict to ReasoningLedger. Does NOT block the
 * caller on L2 confirmation — the confirm-card/finalize response returns
 * immediately, and the frontend polls `getLedgerStatus` (via the
 * /api/intent/:intentHash/ledger-status route) to show "anchored ✅" once
 * mined. Falls back to a logged no-op if the ledger isn't configured yet
 * (dev/mock mode before contracts are deployed and env is wired up).
 */
export function anchorVerdict(params: {
  intentHash: Hex;
  evidenceHash: Hex;
  verdict: VerdictType;
  riskScore: number;
  overrode: boolean;
  userAddress: Hex;
}): void {
  if (!agentWalletClient || !config.contracts.reasoningLedger) {
    anchorStatusByIntentHash.set(params.intentHash, {
      status: "unconfigured",
      txHash: null,
      error: "ReasoningLedger not configured (missing address or agent signer key) — running in mock mode",
    });
    console.warn(`[ledger] mock mode — would anchor verdict for ${params.intentHash}`, params);
    return;
  }

  anchorStatusByIntentHash.set(params.intentHash, { status: "pending", txHash: null, error: null });

  void (async () => {
    try {
      const txHash = await agentWalletClient.writeContract({
        address: config.contracts.reasoningLedger as Hex,
        abi: REASONING_LEDGER_ABI,
        functionName: "recordVerdict",
        args: [
          params.intentHash,
          params.evidenceHash,
          VERDICT_ENUM[params.verdict],
          params.riskScore,
          params.overrode,
          params.userAddress,
        ],
      });
      anchorStatusByIntentHash.set(params.intentHash, { status: "pending", txHash, error: null });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      anchorStatusByIntentHash.set(params.intentHash, {
        status: receipt.status === "success" ? "confirmed" : "failed",
        txHash,
        error: receipt.status === "success" ? null : "transaction reverted",
      });
    } catch (err) {
      anchorStatusByIntentHash.set(params.intentHash, {
        status: "failed",
        txHash: null,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`[ledger] failed to anchor verdict for ${params.intentHash}:`, err);
    }
  })();
}
