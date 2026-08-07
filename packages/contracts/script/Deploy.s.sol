// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RwaVault} from "../src/RwaVault.sol";
import {ReasoningLedger} from "../src/ReasoningLedger.sol";
import {DemoUSDT} from "../src/mocks/DemoUSDT.sol";

/// @notice Deploys RwaVault + ReasoningLedger identically to X Layer Testnet
///         (chain 1952) and Mainnet (chain 196) — same script, parameterized
///         by env vars, so there's no drift between the two deploys.
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url xlayer_testnet --broadcast --verify
///   forge script script/Deploy.s.sol --rpc-url xlayer_mainnet --broadcast --verify
///
/// Required env (see .env.example):
///   PRIVATE_KEY            deployer key, funded with OKB for gas
/// Optional env:
///   AGENT_SIGNER_ADDRESS    backend signer authorized on ReasoningLedger (defaults to deployer)
///   ASSET_TOKEN_ADDRESS     real stablecoin address; REQUIRED on mainnet, optional on testnet
///                           (testnet deploys DemoUSDT + seeds balances if omitted)
///   INITIAL_APR_BPS         default 500 (5%)
///   VAULT_CAP               default 0 (uncapped)
///   YIELD_RESERVE_SEED      default 10_000e6 (testnet-only convenience seed)
contract Deploy is Script {
    uint256 internal constant X_LAYER_MAINNET_CHAIN_ID = 196;
    uint256 internal constant X_LAYER_TESTNET_CHAIN_ID = 1952;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address agentSigner = vm.envOr("AGENT_SIGNER_ADDRESS", deployer);
        uint256 initialAprBps = vm.envOr("INITIAL_APR_BPS", uint256(500));
        uint256 vaultCap = vm.envOr("VAULT_CAP", uint256(0));
        uint256 yieldReserveSeed = vm.envOr("YIELD_RESERVE_SEED", uint256(10_000e6));
        address assetOverride = vm.envOr("ASSET_TOKEN_ADDRESS", address(0));

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        require(
            block.chainid == X_LAYER_MAINNET_CHAIN_ID || block.chainid == X_LAYER_TESTNET_CHAIN_ID,
            "Deploy: unrecognized chain, expected X Layer testnet (1952) or mainnet (196)"
        );

        if (block.chainid == X_LAYER_MAINNET_CHAIN_ID) {
            require(assetOverride != address(0), "Deploy: ASSET_TOKEN_ADDRESS is required on mainnet");
        }

        vm.startBroadcast(deployerKey);

        IERC20 asset;
        bool deployedDemoAsset = false;
        if (assetOverride != address(0)) {
            asset = IERC20(assetOverride);
            console.log("Using existing asset token:", assetOverride);
        } else {
            DemoUSDT demo = new DemoUSDT();
            asset = IERC20(address(demo));
            deployedDemoAsset = true;
            console.log("Deployed DemoUSDT (testnet only):", address(demo));
            // Seed the deployer with enough demo USDT to fund the reserve and
            // still have plenty left over for live demo deposits.
            demo.mint(deployer, yieldReserveSeed * 10);
        }

        RwaVault vault = new RwaVault(
            asset,
            "Candor Demo T-Bill Pool",
            "cvUSDT",
            deployer,
            initialAprBps,
            vaultCap
        );
        console.log("RwaVault deployed:", address(vault));

        ReasoningLedger ledger = new ReasoningLedger(deployer, agentSigner);
        console.log("ReasoningLedger deployed:", address(ledger));
        console.log("Agent signer authorized:", agentSigner);

        if (deployedDemoAsset && yieldReserveSeed > 0) {
            IERC20(address(asset)).approve(address(vault), yieldReserveSeed);
            vault.fundYieldReserve(yieldReserveSeed);
            console.log("Seeded yield reserve:", yieldReserveSeed);
        }

        vm.stopBroadcast();

        console.log("---");
        console.log("Deploy summary (save these into apps/api/.env and apps/web/.env.local):");
        console.log("ASSET_TOKEN_ADDRESS=", address(asset));
        console.log("RWA_VAULT_ADDRESS=", address(vault));
        console.log("REASONING_LEDGER_ADDRESS=", address(ledger));
    }
}
