// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title RwaVault
/// @notice A deliberately simple, honestly-labelled demo tokenized yield pool.
///         This is NOT a real-world-asset custody or compliance system — it is
///         an ERC4626 vault with an admin-set APR, used so Candor's AI risk
///         engine has a real on-chain target to score and route stablecoin
///         deposits into (with a verdict anchored on ReasoningLedger before
///         every deposit).
///
/// @dev Solvency-safety design: yield is never phantom-minted into share price.
///      The owner must explicitly fund a `yieldReserve` of real asset tokens
///      up front (`fundYieldReserve`); `accrueYield` only ever releases
///      already-funded reserve into the assets backing share price, capped by
///      whatever remains in the reserve. So `totalAssets()` — and therefore
///      every share's redeemable value — is always fully backed by tokens the
///      contract actually holds. Misconfiguring `aprBps` too high just drains
///      the reserve faster; it can never make the vault insolvent.
contract RwaVault is ERC4626, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant YEAR = 365 days;

    /// @notice Annualized yield rate in basis points (e.g. 500 = 5% APR).
    uint256 public aprBps;

    /// @notice Real asset tokens set aside by the owner to fund future yield
    ///         accrual. Excluded from `totalAssets()` until released, so it can
    ///         never be double-counted as depositor principal.
    uint256 public yieldReserve;

    /// @notice Optional cap on totalAssets() for new deposits. 0 = uncapped.
    uint256 public cap;

    uint64 public lastAccrualTimestamp;

    event AprUpdated(uint256 oldBps, uint256 newBps);
    event CapUpdated(uint256 oldCap, uint256 newCap);
    event YieldReserveFunded(address indexed from, uint256 amount, uint256 newReserve);
    event YieldAccrued(uint256 amountReleased, uint256 remainingReserve, uint64 timestamp);

    error AprTooHigh(uint256 aprBps);
    error CapExceeded(uint256 requestedTotal, uint256 cap);

    /// @param asset_ the underlying stablecoin (e.g. USDT on X Layer)
    /// @param name_ / symbol_ share token metadata
    /// @param owner_ initial owner (admin) address
    /// @param initialAprBps starting APR in basis points; capped at 5000 (50%) — a
    ///        sanity ceiling so a fat-fingered admin value can't drain the reserve
    ///        absurdly fast; still adjustable up to that ceiling via setAprBps.
    /// @param initialCap 0 for uncapped, else max totalAssets() for new deposits
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address owner_,
        uint256 initialAprBps,
        uint256 initialCap
    ) ERC20(name_, symbol_) ERC4626(asset_) Ownable(owner_) {
        if (initialAprBps > 5_000) revert AprTooHigh(initialAprBps);
        aprBps = initialAprBps;
        cap = initialCap;
        lastAccrualTimestamp = uint64(block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Admin controls
    // ---------------------------------------------------------------------

    function setAprBps(uint256 newAprBps) external onlyOwner {
        if (newAprBps > 5_000) revert AprTooHigh(newAprBps);
        _accrueYield();
        emit AprUpdated(aprBps, newAprBps);
        aprBps = newAprBps;
    }

    function setCap(uint256 newCap) external onlyOwner {
        emit CapUpdated(cap, newCap);
        cap = newCap;
    }

    /// @notice Pull `amount` of the underlying asset from the owner and add it
    ///         to the yield reserve, to be released gradually via accrual.
    function fundYieldReserve(uint256 amount) external onlyOwner {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        yieldReserve += amount;
        emit YieldReserveFunded(msg.sender, amount, yieldReserve);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Yield accrual
    // ---------------------------------------------------------------------

    /// @notice Release accrued yield from the reserve into the assets backing
    ///         share price, capped by whatever remains in the reserve. Public
    ///         so anyone (or the frontend, before showing a quote) can bring
    ///         numbers current without waiting for the next deposit/withdraw.
    function accrueYield() external {
        _accrueYield();
    }

    function _accrueYield() internal {
        uint64 nowTs = uint64(block.timestamp);
        uint256 elapsed = nowTs - lastAccrualTimestamp;
        lastAccrualTimestamp = nowTs;

        if (elapsed == 0 || aprBps == 0 || yieldReserve == 0) return;

        uint256 base = totalAssets();
        uint256 accrued = Math.mulDiv(base, aprBps * elapsed, BPS_DENOMINATOR * YEAR);
        if (accrued > yieldReserve) accrued = yieldReserve;
        if (accrued == 0) return;

        yieldReserve -= accrued;
        emit YieldAccrued(accrued, yieldReserve, nowTs);
    }

    // ---------------------------------------------------------------------
    // ERC4626 overrides: accrue-before-action, pause guard, reentrancy guard,
    // cap enforcement. totalAssets() itself stays a pure view (excludes the
    // unreleased reserve) so share pricing is always fully token-backed.
    // ---------------------------------------------------------------------

    function totalAssets() public view override returns (uint256) {
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        // yieldReserve is always <= balance by construction (funded via
        // safeTransferFrom into this contract, only ever decremented).
        return balance - yieldReserve;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        if (cap == 0) return type(uint256).max;
        uint256 assets = totalAssets();
        return assets >= cap ? 0 : cap - assets;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 maxAssets = maxDeposit(receiver);
        if (maxAssets == type(uint256).max) return type(uint256).max;
        return _convertToShares(maxAssets, Math.Rounding.Floor);
    }

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        _accrueYield();
        uint256 max = maxDeposit(receiver);
        if (assets > max) revert CapExceeded(totalAssets() + assets, cap);
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        _accrueYield();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        _accrueYield();
        return super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        _accrueYield();
        return super.redeem(shares, receiver, owner_);
    }

    /// @notice Convenience read for the Candor risk engine / frontend: pool
    ///         utilization in bps = totalAssets() / cap (0 if uncapped).
    function utilizationBps() external view returns (uint256) {
        if (cap == 0) return 0;
        if (totalAssets() >= cap) return BPS_DENOMINATOR;
        return Math.mulDiv(totalAssets(), BPS_DENOMINATOR, cap);
    }
}
