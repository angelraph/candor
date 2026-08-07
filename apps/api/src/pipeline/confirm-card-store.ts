import type { ConfirmCard } from "@candor/shared";
import type { PreparedTx } from "./simulate.js";

interface CachedIntent {
  confirmCard: ConfirmCard;
  tx: PreparedTx | null; // null if the verdict was REJECT and no tx was ever built
  userAddress: string;
}

/** In-memory store keyed by intentHash, TTL matching the confirm card's
 *  `expiresAt`. A single backend instance is fine for the hackathon; swap
 *  for Redis if this needs to survive restarts or run multi-instance. */
const store = new Map<string, CachedIntent>();

export function putConfirmCard(intentHash: string, entry: CachedIntent): void {
  store.set(intentHash, entry);
  const ttlMs = Math.max(0, entry.confirmCard.expiresAt - Date.now());
  setTimeout(() => store.delete(intentHash), ttlMs + 5_000).unref();
}

export function getConfirmCard(intentHash: string): CachedIntent | null {
  const entry = store.get(intentHash);
  if (!entry) return null;
  if (Date.now() > entry.confirmCard.expiresAt) {
    store.delete(intentHash);
    return null;
  }
  return entry;
}

export function consumeConfirmCard(intentHash: string): CachedIntent | null {
  const entry = getConfirmCard(intentHash);
  if (entry) store.delete(intentHash);
  return entry;
}
