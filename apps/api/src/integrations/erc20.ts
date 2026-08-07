import type { Hex } from "viem";
import { publicClient } from "./viem-clients.js";

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
