import type { Hex } from "viem";
import { config } from "../config";
import { agentWalletClient, publicClient } from "./viem-clients";
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
 * Anchors a verdict to ReasoningLedger and returns the broadcast tx hash (or
 * `null` if the ledger isn't configured — mock mode). Deliberately awaits
 * only the broadcast, not the on-chain receipt: getting a tx hash back from
 * the RPC is a single fast round-trip, whereas waiting for confirmation is
 * exactly the kind of "keep doing work after the response" pattern a
 * serverless function can't safely do (there's no guarantee the process
 * survives once the handler returns). The browser already holds a live
 * `publicClient` from wagmi for polling the user's own swap/deposit tx, so it
 * polls this hash the same way instead of the backend tracking status itself.
 */
export async function anchorVerdict(params: {
  intentHash: Hex;
  evidenceHash: Hex;
  verdict: VerdictType;
  riskScore: number;
  overrode: boolean;
  userAddress: Hex;
}): Promise<Hex | null> {
  if (!agentWalletClient || !config.contracts.reasoningLedger) {
    console.warn(`[ledger] mock mode — would anchor verdict for ${params.intentHash}`, params);
    return null;
  }

  return agentWalletClient.writeContract({
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
}
