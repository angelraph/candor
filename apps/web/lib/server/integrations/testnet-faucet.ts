import type { Hex } from "viem";
import { X_LAYER_TESTNET } from "@candor/shared";
import { getChainConfig } from "../config";
import { getAgentWalletClient } from "./viem-clients";

const DEMO_USDT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// DemoUSDT has 6 decimals (see packages/contracts/src/mocks/DemoUSDT.sol) —
// 1000 test USDT per click is plenty to run every example prompt on the
// homepage without needing a second visit.
const FAUCET_AMOUNT_WEI = 1_000_000_000n; // 1000 * 10^6

export class FaucetNotAvailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "FaucetNotAvailableError";
  }
}

/**
 * Mints free DemoUSDT to a user's address on X Layer testnet, paid for by
 * the agent's own (already testnet-OKB-funded) wallet — the user needs zero
 * gas to receive it. Deliberately mainnet-proof: this only ever touches the
 * testnet asset token, there is no equivalent for real funds.
 */
export async function requestTestnetFaucet(userAddress: Hex): Promise<Hex> {
  const assetToken = getChainConfig(X_LAYER_TESTNET.id).contracts.assetToken;
  if (!assetToken) throw new FaucetNotAvailableError("Testnet asset token is not configured");

  const agentWalletClient = getAgentWalletClient(X_LAYER_TESTNET.id);
  if (!agentWalletClient) throw new FaucetNotAvailableError("Faucet signer is not configured");

  return agentWalletClient.writeContract({
    address: assetToken as Hex,
    abi: DEMO_USDT_ABI,
    functionName: "mint",
    args: [userAddress, FAUCET_AMOUNT_WEI],
    account: agentWalletClient.account!,
    chain: agentWalletClient.chain,
  });
}
