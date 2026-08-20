/** Wagmi/viem errors carry long, developer-oriented multi-line messages
 *  (full call data, ABI dumps, docs links). Translate the common, expected
 *  cases into something a user should actually read; fall back to a
 *  truncated version of whatever we got rather than a wall of text. */
export function describeTxError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return "You rejected the signature request, so nothing was sent.";
  }
  if (lower.includes("insufficient funds")) {
    return "Your balance doesn't cover this transaction plus gas.";
  }
  if (lower.includes("insufficient allowance") || lower.includes("erc20insufficientallowance")) {
    return "The token approval didn't go through in time. Try again.";
  }
  if (lower.includes("nonce")) {
    return "There's a conflicting pending transaction. Let it finish (or clear it) before trying again.";
  }
  if (lower.includes("gas required exceeds") || lower.includes("out of gas")) {
    return "Ran out of gas. That usually means the underlying call would have failed anyway.";
  }

  // First line only, capped — viem errors often follow with call data/ABI
  // dumps and doc links that aren't useful to show inline.
  const firstLine = message.split("\n")[0];
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}
