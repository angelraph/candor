import { keccak256, toHex, type Hex } from "viem";
import type { Action, RiskVerdict } from "@candor/shared";

/** Deterministic JSON.stringify — sorts object keys recursively so the same
 * logical value always hashes the same way regardless of key insertion order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * intentHash identifies *what was asked* — user, chain, and the resolved
 * Action. Two identical requests from the same user produce the same hash,
 * which is intentional: ReasoningLedger.recordVerdict() rejects duplicates,
 * so a genuinely repeated intent can't be anchored twice. Include a nonce
 * (the request timestamp) so legitimately repeated actions aren't blocked.
 */
export function computeIntentHash(params: {
  userAddress: string;
  chainId: number;
  action: Action;
  nonce: number;
}): Hex {
  return keccak256(toHex(stableStringify(params)));
}

/**
 * evidenceHash commits to the full risk verdict — features, rationale, and
 * source (rule|llm) — without paying L2 storage for the text itself. Anyone
 * holding the original ConfirmCard/verdict JSON can recompute this and prove
 * it matches what's anchored on ReasoningLedger.
 */
export function computeEvidenceHash(verdict: RiskVerdict): Hex {
  return keccak256(
    toHex(
      stableStringify({
        verdict: verdict.verdict,
        riskScore: verdict.riskScore,
        rationale: verdict.rationale,
        source: verdict.source,
        features: verdict.features,
      })
    )
  );
}
