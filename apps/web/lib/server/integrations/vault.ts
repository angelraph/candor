import type { Hex } from "viem";
import { getChainConfig } from "../config";
import { getPublicClient } from "./viem-clients";
import type { VaultState } from "@candor/shared";

const RWA_VAULT_ABI = [
  { type: "function", name: "aprBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "utilizationBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "previewDeposit",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

export class VaultNotConfiguredError extends Error {
  constructor() {
    super("RWA_VAULT_ADDRESS is not configured for this chain");
    this.name = "VaultNotConfiguredError";
  }
}

function vaultAddress(chainId: number): Hex {
  const address = getChainConfig(chainId).contracts.rwaVault;
  if (!address) throw new VaultNotConfiguredError();
  return address as Hex;
}

/** Reads current on-chain vault state — used both by the risk engine (pool
 *  utilization is a real risk feature) and by the AI-RWA ranking step. */
export async function readVaultState(chainId: number): Promise<VaultState> {
  const address = vaultAddress(chainId);
  const client = getPublicClient(chainId);

  const [aprBps, totalAssets, cap, utilizationBps] = await Promise.all([
    client.readContract({ address, abi: RWA_VAULT_ABI, functionName: "aprBps" }),
    client.readContract({ address, abi: RWA_VAULT_ABI, functionName: "totalAssets" }),
    client.readContract({ address, abi: RWA_VAULT_ABI, functionName: "cap" }),
    client.readContract({ address, abi: RWA_VAULT_ABI, functionName: "utilizationBps" }),
  ]);

  return {
    aprBps: Number(aprBps),
    totalAssetsWei: totalAssets.toString(),
    capWei: cap === 0n ? null : cap.toString(),
    utilizationBps: Number(utilizationBps),
  };
}

export async function previewVaultDeposit(chainId: number, amountWei: bigint): Promise<bigint> {
  const address = vaultAddress(chainId);
  return getPublicClient(chainId).readContract({
    address,
    abi: RWA_VAULT_ABI,
    functionName: "previewDeposit",
    args: [amountWei],
  });
}

export async function isVaultPaused(chainId: number): Promise<boolean> {
  const address = vaultAddress(chainId);
  return getPublicClient(chainId).readContract({ address, abi: RWA_VAULT_ABI, functionName: "paused" });
}
