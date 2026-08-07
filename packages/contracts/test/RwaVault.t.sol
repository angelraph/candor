// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RwaVault} from "../src/RwaVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract RwaVaultTest is Test {
    MockERC20 internal usdt;
    RwaVault internal vault;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant INITIAL_APR_BPS = 500; // 5%
    uint8 internal constant DECIMALS = 6;
    uint256 internal constant ONE = 10 ** DECIMALS;

    function setUp() public {
        usdt = new MockERC20("Mock USDT", "mUSDT", DECIMALS);
        vault = new RwaVault(IERC20(address(usdt)), "Candor T-Bill Pool", "cvUSDT", owner, INITIAL_APR_BPS, 0);

        usdt.mint(alice, 1_000_000 * ONE);
        usdt.mint(bob, 1_000_000 * ONE);
        usdt.mint(owner, 1_000_000 * ONE);

        vm.prank(alice);
        usdt.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdt.approve(address(vault), type(uint256).max);
        vm.prank(owner);
        usdt.approve(address(vault), type(uint256).max);
    }

    // -- basic deposit/withdraw -------------------------------------------

    function test_deposit_mintsSharesOneToOneWhenEmpty() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(1_000 * ONE, alice);
        assertEq(shares, 1_000 * ONE, "first depositor gets 1:1 shares");
        assertEq(vault.totalAssets(), 1_000 * ONE);
        assertEq(vault.balanceOf(alice), 1_000 * ONE);
    }

    function test_withdraw_returnsPrincipalWithNoAccrual() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE, alice);

        // No time has passed, no reserve funded -> no yield accrued.
        // NOTE: read balanceOf *before* vm.prank — an intervening external call
        // (even a view call like balanceOf) consumes the "next call" prank.
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 assetsOut = vault.redeem(shares, alice, alice);
        assertEq(assetsOut, 1_000 * ONE);
        assertEq(usdt.balanceOf(alice), 1_000_000 * ONE, "alice back to starting balance");
    }

    function test_multipleDepositors_shareProRata() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE, alice);
        vm.prank(bob);
        vault.deposit(3_000 * ONE, bob);

        assertEq(vault.totalAssets(), 4_000 * ONE);
        // No accrual yet -> 1:1 pricing still holds for both.
        assertEq(vault.balanceOf(alice), 1_000 * ONE);
        assertEq(vault.balanceOf(bob), 3_000 * ONE);
    }

    // -- yield accrual is always reserve-backed -----------------------------

    function test_accrual_increasesTotalAssets_boundedByReserve() public {
        vm.prank(alice);
        vault.deposit(10_000 * ONE, alice);

        vm.prank(owner);
        vault.fundYieldReserve(100 * ONE);

        uint256 before = vault.totalAssets();
        skip(365 days); // full year at 5% APR on 10,000 = 500, but reserve only has 100

        vault.accrueYield();

        uint256 afterAssets = vault.totalAssets();
        assertEq(afterAssets - before, 100 * ONE, "accrual capped by funded reserve, not by aprBps math");
        assertEq(vault.yieldReserve(), 0, "reserve fully released");
    }

    function test_accrual_neverExceedsFundedReserve_fuzz(uint256 principal, uint256 reserve, uint256 elapsedDays)
        public
    {
        principal = bound(principal, 1 * ONE, 500_000 * ONE);
        reserve = bound(reserve, 0, 50_000 * ONE);
        elapsedDays = bound(elapsedDays, 0, 3650);

        usdt.mint(alice, principal);
        vm.prank(alice);
        usdt.approve(address(vault), principal);
        vm.prank(alice);
        vault.deposit(principal, alice);

        if (reserve > 0) {
            usdt.mint(owner, reserve);
            vm.startPrank(owner);
            usdt.approve(address(vault), reserve);
            vault.fundYieldReserve(reserve);
            vm.stopPrank();
        }

        uint256 reserveBefore = vault.yieldReserve();
        skip(elapsedDays * 1 days);
        vault.accrueYield();

        assertLe(vault.yieldReserve(), reserveBefore, "reserve never increases from accrual");
        // Solvency invariant: contract's real token balance always covers totalAssets() + remaining reserve.
        assertGe(usdt.balanceOf(address(vault)), vault.totalAssets() + vault.yieldReserve());
    }

    function test_depositorsShareAccruedYieldProRata() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE, alice);
        vm.prank(bob);
        vault.deposit(1_000 * ONE, bob);

        // Fund a reserve larger than one year's accrual will actually need, so
        // the APR formula (not the reserve) is the binding constraint here.
        vm.prank(owner);
        vault.fundYieldReserve(200 * ONE);

        skip(365 days);
        vault.accrueYield();

        // 5% APR on a 2,000 base for one year = 100 total accrued, split
        // pro-rata across the two equal 1,000 depositors -> +50 each.
        uint256 aliceAssets = vault.previewRedeem(vault.balanceOf(alice));
        uint256 bobAssets = vault.previewRedeem(vault.balanceOf(bob));
        assertApproxEqAbs(aliceAssets, 1_050 * ONE, 1, "rounding dust only");
        assertApproxEqAbs(bobAssets, 1_050 * ONE, 1, "rounding dust only");
        assertEq(vault.yieldReserve(), 200 * ONE - 100 * ONE, "only the APR-bound amount is released");
    }

    // -- access control ------------------------------------------------------

    function test_onlyOwner_canSetAprBps() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setAprBps(1000);
    }

    function test_aprBps_cappedAt5000() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RwaVault.AprTooHigh.selector, 5001));
        vault.setAprBps(5001);
    }

    function test_onlyOwner_canFundYieldReserve() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.fundYieldReserve(1 * ONE);
    }

    function test_onlyOwner_canPause() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.pause();
    }

    // -- pause guards ---------------------------------------------------------

    function test_paused_blocksDeposit() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(1 * ONE, alice);
    }

    function test_paused_blocksWithdraw() public {
        vm.prank(alice);
        vault.deposit(1_000 * ONE, alice);

        vm.prank(owner);
        vault.pause();

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert();
        vault.redeem(shares, alice, alice);
    }

    function test_maxDeposit_zeroWhenPaused() public {
        vm.prank(owner);
        vault.pause();
        assertEq(vault.maxDeposit(alice), 0);
    }

    // -- cap enforcement --------------------------------------------------

    function test_cap_blocksDepositBeyondCap() public {
        vm.prank(owner);
        vault.setCap(1_000 * ONE);

        vm.prank(alice);
        vault.deposit(1_000 * ONE, alice);

        vm.prank(bob);
        vm.expectRevert();
        vault.deposit(1 * ONE, bob);
    }

    function test_utilizationBps_reflectsCapFill() public {
        vm.prank(owner);
        vault.setCap(1_000 * ONE);

        vm.prank(alice);
        vault.deposit(500 * ONE, alice);

        assertEq(vault.utilizationBps(), 5_000); // 50%
    }

    function test_utilizationBps_zeroWhenUncapped() public view {
        assertEq(vault.utilizationBps(), 0);
    }
}
