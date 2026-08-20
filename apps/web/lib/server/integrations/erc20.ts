import type { Hex } from "viem";
import { publicClient } from "./viem-clients";

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

export async function getBalance(token: Hex, owner: Hex): Promise<bigint> {
  return publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] });
}

export async function getAllowance(token: Hex, owner: Hex, spender: Hex): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
}

/** Reads a token's symbol+decimals directly on-chain — deliberately independent
 *  of the OKX token list, so core infrastructure (e.g. the vault's own asset)
 *  never depends on a third-party aggregator being reachable. */
export async function getTokenMetadata(token: Hex): Promise<{ symbol: string; decimals: number }> {
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  return { symbol: symbol.toUpperCase(), decimals };
}
