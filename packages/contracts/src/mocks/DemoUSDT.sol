// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice DEMO-ONLY mintable stand-in for USDT (6 decimals), used solely so
///         RwaVault has a real ERC20 to hold on X Layer Testnet when no real
///         stablecoin address is supplied. The deploy script refuses to use
///         this on mainnet (chain id 196) — mainnet always requires a real
///         ASSET_TOKEN_ADDRESS (e.g. actual USDT) to be configured.
contract DemoUSDT is ERC20 {
    constructor() ERC20("Candor Demo USDT", "dUSDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open mint, deliberately — this is testnet play money, not an
    ///         asset with real value. Never deploy this contract to mainnet.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
