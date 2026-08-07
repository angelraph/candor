import type { Hex } from "viem";
import { config } from "../config.js";
import { publicClient } from "./viem-clients.js";
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
    super("RWA_VAULT_ADDRESS is not configured — deploy contracts and set apps/api/.env first");
    this.name = "VaultNotConfiguredError";
  }
}

/** Reads current on-chain vault state — used both by the risk engine (pool
 *  utilization is a real risk feature) and by the AI-RWA ranking step. */
export async function readVaultState(): Promise<VaultState> {
  if (!config.contracts.rwaVault) throw new VaultNotConfiguredError();
  const address = config.contracts.rwaVault as Hex;

  const [aprBps, totalAssets, cap, utilizationBps] = await Promise.all([
    publicClient.readContract({ address, abi: RWA_VAULT_ABI, functionName: "aprBps" }),
    publicClient.readContract({ address, abi: RWA_VAULT_ABI, functionName: "totalAssets" }),
    publicClient.readContract({ address, abi: RWA_VAULT_ABI, functionName: "cap" }),
    publicClient.readContract({ address, abi: RWA_VAULT_ABI, functionName: "utilizationBps" }),
  ]);

  return {
    aprBps: Number(aprBps),
    totalAssetsWei: totalAssets.toString(),
    capWei: cap === 0n ? null : cap.toString(),
    utilizationBps: Number(utilizationBps),
  };
}

export async function previewVaultDeposit(amountWei: bigint): Promise<bigint> {
  if (!config.contracts.rwaVault) throw new VaultNotConfiguredError();
  return publicClient.readContract({
    address: config.contracts.rwaVault as Hex,
    abi: RWA_VAULT_ABI,
    functionName: "previewDeposit",
    args: [amountWei],
  });
}

export async function isVaultPaused(): Promise<boolean> {
  if (!config.contracts.rwaVault) throw new VaultNotConfiguredError();
  return publicClient.readContract({
    address: config.contracts.rwaVault as Hex,
    abi: RWA_VAULT_ABI,
    functionName: "paused",
  });
}
