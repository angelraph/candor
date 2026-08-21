import { parseUnits } from "viem";
import { resolveSymbol } from "../integrations/token-registry";

/**
 * Deterministic, in-process, no-network intent classifier — the fast path.
 * Resolves the common phrasings from the demo script in well under 50ms so
 * they never touch the LLM. Anything it doesn't confidently match returns
 * `null`, and the pipeline falls back to the LLM (the slow path) instead of
 * guessing.
 */

export type FastPathAmount = { kind: "exact"; wei: string } | { kind: "full_balance" };

export type FastPathIntent =
  | { type: "swap"; fromToken: string; toToken: string; amount: FastPathAmount; slippageBps: number }
  | { type: "vault_deposit"; assetToken: string; amount: FastPathAmount };

const FULL_BALANCE_WORDS = new Set(["idle", "all", "available", "my", "spare", "remaining"]);

const SWAP_RE =
  /\b(?:swap|convert|trade)\s+([\d]*\.?[\d]+)\s*([a-zA-Z]{2,10})\s+(?:to|for|into)\s+([a-zA-Z]{2,10})\b/i;

const DEPOSIT_RE =
  /\b(?:deposit|invest|put|allocate|park)\s+(?:(?:my|the)\s+)?([\d]*\.?[\d]+|idle|all|available|spare|remaining)\s*([a-zA-Z]{2,10})\s+(?:into|in|to)\s+(?:the\s+)?(?:best\s+)?(?:safe\s+)?(?:yield|vault|pool)\b/i;

// "put idle USDT into the best yield" — amount word comes before the token,
// same as DEPOSIT_RE, already handled by the numeric-or-word capture group above.

function parseAmountToken(raw: string): FastPathAmount | null {
  const normalized = raw.toLowerCase();
  if (FULL_BALANCE_WORDS.has(normalized)) return { kind: "full_balance" };
  if (!/^\d*\.?\d+$/.test(raw)) return null;
  return { kind: "exact", wei: raw }; // human units — resolved to wei by the caller once decimals are known
}

export async function classifyFastPath(chainId: number, message: string): Promise<FastPathIntent | null> {
  const swapMatch = message.match(SWAP_RE);
  if (swapMatch) {
    const [, amountRaw, fromSym, toSym] = swapMatch;
    const amount = parseAmountToken(amountRaw);
    const [from, to] = await Promise.all([resolveSymbol(chainId, fromSym), resolveSymbol(chainId, toSym)]);
    if (amount && amount.kind === "exact" && from && to) {
      return {
        type: "swap",
        fromToken: from.address,
        toToken: to.address,
        amount: { kind: "exact", wei: parseUnits(amountRaw, from.decimals).toString() },
        slippageBps: 50,
      };
    }
    // Unrecognized token symbol or non-numeric swap amount ("swap some ETH")
    // — don't guess, let the slow path (with its broader reasoning) handle it.
    return null;
  }

  const depositMatch = message.match(DEPOSIT_RE);
  if (depositMatch) {
    const [, amountRaw, tokenSym] = depositMatch;
    const amount = parseAmountToken(amountRaw);
    const token = await resolveSymbol(chainId, tokenSym);
    if (!amount || !token) return null;

    if (amount.kind === "full_balance") {
      return { type: "vault_deposit", assetToken: token.address, amount: { kind: "full_balance" } };
    }
    return {
      type: "vault_deposit",
      assetToken: token.address,
      amount: { kind: "exact", wei: parseUnits(amountRaw, token.decimals).toString() },
    };
  }

  return null;
}
