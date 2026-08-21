// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice DEMO-ONLY mintable stand-in for WETH (18 decimals), used solely so
///         "swap USDT to ETH" resolves to a real, verified ERC20 contract on
///         X Layer Testnet instead of a synthetic placeholder address that
///         doesn't exist on-chain. Same pattern as DemoUSDT — never deploy
///         this to mainnet, where the real bridged/wrapped ETH address is
///         used instead.
contract DemoWETH is ERC20 {
    constructor() ERC20("Candor Demo WETH", "dWETH") {}

    /// @notice Open mint, deliberately — this is testnet play money, not an
    ///         asset with real value. Never deploy this contract to mainnet.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
