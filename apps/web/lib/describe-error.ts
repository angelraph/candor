/** Wagmi/viem errors carry long, developer-oriented multi-line messages
 *  (full call data, ABI dumps, docs links). Translate the common, expected
 *  cases into something a user should actually read; fall back to a
 *  truncated version of whatever we got rather than a wall of text. */
export function describeTxError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("user denied")) {
    return "You rejected the signature request — nothing was sent.";
  }
  if (lower.includes("insufficient funds")) {
    return "Insufficient balance to cover this transaction (including gas).";
  }
  if (lower.includes("insufficient allowance") || lower.includes("erc20insufficientallowance")) {
    return "Token approval didn't go through in time — try again.";
  }
  if (lower.includes("nonce")) {
    return "Transaction nonce conflict — if you have another pending transaction, wait for it to finish and try again.";
  }
  if (lower.includes("gas required exceeds") || lower.includes("out of gas")) {
    return "Transaction ran out of gas — this usually means the underlying call would have failed anyway.";
  }

  // First line only, capped — viem errors often follow with call data/ABI
  // dumps and doc links that aren't useful to show inline.
  const firstLine = message.split("\n")[0];
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}
