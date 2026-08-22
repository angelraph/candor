import { X_LAYER_MAINNET, X_LAYER_TESTNET } from "@candor/shared";

const EXPLORERS: Record<number, string> = {
  [X_LAYER_MAINNET.id]: X_LAYER_MAINNET.blockExplorer,
  [X_LAYER_TESTNET.id]: X_LAYER_TESTNET.blockExplorer,
};

/** OKLink tx URL for whichever X Layer chain a hash belongs to — `null` for
 *  an unrecognized chain rather than guessing a URL that might 404. */
export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = EXPLORERS[chainId];
  return base ? `${base}/tx/${txHash}` : null;
}
