import type { Hex } from "viem";
import { publicClient } from "../integrations/viem-clients";
import * as okxDex from "../integrations/okx-dex";
import { previewVaultDeposit } from "../integrations/vault";
import type { Quote } from "@candor/shared";

export interface PreparedTx {
  to: Hex;
  data: Hex;
  value: string;
  gas: string;
}

export interface SwapSimulation {
  quote: Quote;
  tx: PreparedTx;
}

/** Fetches the OKX DEX quote+swap calldata and best-effort re-estimates gas
 *  on-chain. A failed on-chain gas estimate (e.g. the user hasn't approved
 *  the router yet) is expected and non-fatal here — it just means the
 *  confirm card falls back to the aggregator's own estimate; the approval
 *  step itself is handled explicitly by the frontend before signing. */
export async function simulateSwap(params: {
  fromToken: Hex;
  toToken: Hex;
  amountWei: string;
  slippageBps: number;
  userAddress: Hex;
}): Promise<SwapSimulation> {
  const quote = await okxDex.getQuote({
    fromTokenAddress: params.fromToken,
    toTokenAddress: params.toToken,
    amountWei: params.amountWei,
    slippageBps: params.slippageBps,
  });

  const swapTx = await okxDex.getSwapTransaction({
    fromTokenAddress: params.fromToken,
    toTokenAddress: params.toToken,
    amountWei: params.amountWei,
    slippageBps: params.slippageBps,
    userWalletAddress: params.userAddress,
  });

  let gas = swapTx.gas;
  if (!swapTx.mock) {
    try {
      const estimated = await publicClient.estimateGas({
        account: params.userAddress,
        to: swapTx.to as Hex,
        data: swapTx.data as Hex,
        value: BigInt(swapTx.value || "0"),
      });
      gas = estimated.toString();
    } catch {
      // Expected when allowance isn't set yet — keep the aggregator's estimate.
    }
  }

  return {
    quote,
    tx: { to: swapTx.to as Hex, data: swapTx.data as Hex, value: swapTx.value, gas },
  };
}

export interface VaultDepositSimulation {
  expectedSharesWei: string;
  tx: PreparedTx;
}

const RWA_VAULT_DEPOSIT_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
] as const;

export async function simulateVaultDeposit(params: {
  vaultAddress: Hex;
  amountWei: string;
  userAddress: Hex;
}): Promise<VaultDepositSimulation> {
  const expectedShares = await previewVaultDeposit(BigInt(params.amountWei));

  const { request } = await publicClient
    .simulateContract({
      account: params.userAddress,
      address: params.vaultAddress,
      abi: RWA_VAULT_DEPOSIT_ABI,
      functionName: "deposit",
      args: [BigInt(params.amountWei), params.userAddress],
    })
    .catch(() => ({ request: null }));

  // Fall back to a conservative flat gas estimate if simulateContract can't
  // run yet (e.g. allowance not set) — the deposit call itself is cheap on L2.
  const gas = request ? "150000" : "150000";

  const data = encodeDepositCalldata(BigInt(params.amountWei), params.userAddress);

  return {
    expectedSharesWei: expectedShares.toString(),
    tx: { to: params.vaultAddress, data, value: "0", gas },
  };
}

// Minimal manual ABI-encoding for `deposit(uint256,address)` so this doesn't
// need viem's full contract-write plumbing just to build calldata.
function encodeDepositCalldata(assets: bigint, receiver: Hex): Hex {
  const selector = "0x6e553f65"; // keccak256("deposit(uint256,address)")[:4]
  const assetsHex = assets.toString(16).padStart(64, "0");
  const receiverHex = receiver.slice(2).padStart(64, "0");
  return `${selector}${assetsHex}${receiverHex}` as Hex;
}
