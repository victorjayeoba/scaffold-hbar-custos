// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { CustosBase } from "./CustosBase.sol";
import { LiquidityPool } from "../contracts/LiquidityPool.sol";

contract LiquidityPoolTest is CustosBase {
    address internal whale = makeAddr("whale");

    function _lpApprove(address who) internal {
        vm.startPrank(who);
        usdc.approve(address(pool), type(uint256).max);
        shares.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _deposit(address who, uint256 assets) internal returns (uint256 minted) {
        usdc.mint(who, assets);
        _lpApprove(who);
        vm.prank(who);
        minted = pool.deposit(assets, who);
    }

    /*//////////////////////////////////////////////////////////////
                             SHARE TOKEN
    //////////////////////////////////////////////////////////////*/

    function test_shareTokenIsAnHtsTokenThePoolMints() public view {
        IERC20Metadata t = IERC20Metadata(pool.shareToken());
        assertEq(t.name(), "Custos LP USDC");
        assertEq(t.symbol(), "cUSDC-LP");
        assertEq(t.decimals(), 6);
        // first deposit: 1 share per micro-USDC, minus the dead shares kept by the pool
        assertEq(t.balanceOf(lp), POOL_SEED - pool.DEAD_SHARES());
        assertEq(t.balanceOf(address(pool)), pool.DEAD_SHARES());
        assertEq(t.totalSupply(), POOL_SEED);
        assertEq(pool.totalSupply(), POOL_SEED);
        assertEq(pool.balanceOf(lp), POOL_SEED - pool.DEAD_SHARES());
    }

    function test_createShareTokenOnceAndOnlyOwner() public {
        vm.expectRevert(LiquidityPool.LiquidityPool__ShareTokenExists.selector);
        pool.createShareToken{ value: 1e8 }();

        LiquidityPool fresh = new LiquidityPool(usdc, address(this));
        vm.deal(alice, 1e8);
        vm.prank(alice);
        vm.expectRevert();
        fresh.createShareToken{ value: 1e8 }();
    }

    function test_createShareTokenLeavesNoHbarInThePool() public {
        LiquidityPool fresh = new LiquidityPool(usdc, address(this));
        uint256 before = address(this).balance;
        fresh.createShareToken{ value: 5e8 }();
        assertEq(address(fresh).balance, 0); // whatever HTS doesn't take goes back to the caller
        assertLe(before - address(this).balance, 5e8);
        assertTrue(fresh.shareToken() != address(0));
    }

    function test_depositAndRedeemNeedTheShareToken() public {
        LiquidityPool fresh = new LiquidityPool(usdc, address(this));
        vm.expectRevert(LiquidityPool.LiquidityPool__NoShareToken.selector);
        fresh.deposit(1e6, alice);
        vm.expectRevert(LiquidityPool.LiquidityPool__NoShareToken.selector);
        fresh.redeem(1, alice);
        assertEq(fresh.totalSupply(), 0);
        assertEq(fresh.balanceOf(alice), 0);
    }

    function test_constructorRejectsZeroAsset() public {
        vm.expectRevert(LiquidityPool.LiquidityPool__InvalidAddress.selector);
        new LiquidityPool(IERC20(address(0)), address(this));
    }

    /*//////////////////////////////////////////////////////////////
                          DEPOSIT AND EXIT
    //////////////////////////////////////////////////////////////*/

    function test_depositMintsSharesAtPoolValue() public {
        assertEq(pool.totalAssets(), POOL_SEED);
        _open(alice, true, 100e6, 10); // 1 USDC fee to the pool raises the share price
        uint256 got = _deposit(bob, 1_000e6);
        assertLt(got, 1_000e6);
        assertApproxEqAbs(pool.previewRedeem(got), 1_000e6, 1);
        assertEq(shares.balanceOf(bob), got);
    }

    function test_previewsMatchActions() public {
        uint256 preview = pool.previewDeposit(500e6);
        uint256 got = _deposit(bob, 500e6);
        assertEq(got, preview);

        uint256 assetsPreview = pool.previewRedeem(got);
        vm.prank(bob);
        uint256 out = pool.redeem(got, bob);
        assertEq(out, assetsPreview);
        assertEq(shares.balanceOf(bob), 0);
    }

    function test_withdrawBurnsTheRoundedUpShares() public {
        uint256 got = _deposit(bob, 500e6);
        uint256 burn = pool.previewWithdraw(200e6);
        vm.prank(bob);
        uint256 burned = pool.withdraw(200e6, bob);
        assertEq(burned, burn);
        assertEq(shares.balanceOf(bob), got - burned);
        assertEq(usdc.balanceOf(bob), 1_000e6 + 200e6); // CustosBase gave bob 1,000 USDC
    }

    function test_redeemAllWhenNoPositions() public {
        uint256 held = shares.balanceOf(lp);
        vm.prank(lp);
        pool.redeem(held, lp);
        assertApproxEqAbs(usdc.balanceOf(lp), POOL_SEED - pool.DEAD_SHARES(), 1);
        assertEq(pool.totalSupply(), pool.DEAD_SHARES());
    }

    function test_redeemToAnotherReceiver() public {
        vm.prank(lp);
        uint256 out = pool.redeem(1_000e6, alice);
        assertEq(usdc.balanceOf(alice), 1_000e6 + out);
    }

    function test_redeemNeedsApproval() public {
        uint256 got = _deposit(bob, 100e6);
        vm.prank(bob);
        shares.approve(address(pool), 0);
        vm.prank(bob);
        vm.expectRevert();
        pool.redeem(got, bob);
    }

    function test_zeroAmountsAndZeroReceiverRevert() public {
        vm.startPrank(lp);
        vm.expectRevert(LiquidityPool.LiquidityPool__ZeroAmount.selector);
        pool.deposit(0, lp);
        vm.expectRevert(LiquidityPool.LiquidityPool__InvalidAddress.selector);
        pool.deposit(1e6, address(0));
        vm.expectRevert(LiquidityPool.LiquidityPool__ZeroAmount.selector);
        pool.redeem(0, lp);
        vm.expectRevert(LiquidityPool.LiquidityPool__InvalidAddress.selector);
        pool.redeem(1, address(0));
        vm.expectRevert(LiquidityPool.LiquidityPool__ZeroAmount.selector);
        pool.withdraw(0, lp);
        vm.expectRevert(LiquidityPool.LiquidityPool__InvalidAddress.selector);
        pool.withdraw(1, address(0));
        vm.stopPrank();
    }

    function test_redeemMoreThanHeldReverts() public {
        uint256 held = shares.balanceOf(lp);
        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(LiquidityPool.LiquidityPool__ExceedsMax.selector, held));
        pool.redeem(held + 1, lp);
    }

    function test_withdrawBlockedBelowRequiredLiquidity() public {
        _open(alice, true, 100e6, 10); // 1,000 open: the pool must keep 2,000
        assertEq(pool.requiredLiquidity(), 2_000e6);
        assertEq(pool.freeAssets(), POOL_SEED + 1e6 - 2_000e6);

        uint256 max = pool.maxWithdraw(lp);
        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(LiquidityPool.LiquidityPool__ExceedsMax.selector, max));
        pool.withdraw(max + 1, lp);

        vm.prank(lp);
        pool.withdraw(max, lp);
        assertGe(usdc.balanceOf(address(pool)), pool.requiredLiquidity());
        assertLe(pool.previewRedeem(pool.maxRedeem(lp)), pool.freeAssets());
    }

    /*//////////////////////////////////////////////////////////////
                    POOL VALUE INCLUDES OPEN TRADER PNL
    //////////////////////////////////////////////////////////////*/

    function test_totalAssetsBooksTraderLossesAndGains() public {
        _open(alice, true, 100e6, 10); // 1,000 notional at 0.12
        uint256 base = usdc.balanceOf(address(pool));
        _setPrice(11_400_000); // −5%: alice is down ~50
        assertApproxEqAbs(pool.totalAssets(), base + 50e6, 1e3);
        _setPrice(12_600_000); // +5%: alice is up ~50
        assertApproxEqAbs(pool.totalAssets(), base - 50e6, 1e3);
    }

    /// @dev Audit H-1: deposit, close a losing trade, redeem, all in one go, used to win back ~all of the loss.
    function test_jitDepositCannotRecaptureOwnLoss() public {
        _open(alice, true, 100e6, 10);
        vm.warp(block.timestamp + 300);
        _setPrice(11_400_000); // −5%
        uint256 start = usdc.balanceOf(alice);

        usdc.mint(alice, 1_000_000e6);
        _lpApprove(alice);
        vm.startPrank(alice);
        uint256 got = pool.deposit(1_000_000e6, alice);
        market.close();
        pool.redeem(got, alice);
        vm.stopPrank();

        uint256 back = usdc.balanceOf(alice) - 1_000_000e6 - start;
        assertLt(back, 50e6); // a plain close returns ~48: the loss stays lost
    }

    /// @dev Audit H-1: deposit, liquidate, redeem used to take ~98% of the liquidated collateral.
    function test_jitDepositCannotCaptureALiquidation() public {
        _open(alice, true, 100e6, 10);
        _setPrice(10_900_000);
        // what is left of alice's equity: the only part of her collateral the pool hadn't already booked
        uint256 leftover = uint256(market.equity(alice, 0.109e18));
        usdc.mint(whale, 1_000_000e6);
        _lpApprove(whale);
        vm.startPrank(whale);
        uint256 got = pool.deposit(1_000_000e6, whale);
        market.liquidate(alice);
        pool.redeem(got, whale);
        vm.stopPrank();
        // before the fix: 98.07 of 99. Now: the public 5 USDC reward plus at most the leftover equity (~7 USDC)
        assertLe(usdc.balanceOf(whale) - 1_000_000e6, leftover + 1);
        assertLt(leftover, 10e6);
    }

    /// @dev Audit L-1: a deposit just before an accrual used to cut the funding owed for the whole period.
    function test_depositAccruesFundingFirst() public {
        _open(alice, true, 100e6, 10);
        vm.warp(block.timestamp + 1800);
        _setPrice(12_000_000);
        int256 owedBefore = market.fundingOwed(alice);
        _deposit(whale, 1_000_000e6);
        assertEq(market.fundingUpdatedAt(), block.timestamp);
        assertApproxEqAbs(market.fundingOwed(alice), owedBefore, 1);
    }

    function test_depositsAndWithdrawalsPauseWithoutAGoodPrice() public {
        _open(alice, true, 100e6, 10);
        supra.set(10_000_000, block.timestamp); // 17% from Chainlink: Deviated
        usdc.mint(bob, 100e6);
        vm.prank(bob);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(LiquidityPool.LiquidityPool__NoPrice.selector);
        pool.deposit(100e6, bob);
        vm.prank(lp);
        vm.expectRevert(LiquidityPool.LiquidityPool__NoPrice.selector);
        pool.redeem(1e6, lp);
        // with no positions open there is nothing to price, so the pool stays open
        assertEq(pool.totalAssets(), usdc.balanceOf(address(pool)));
    }

    function test_noPositionsNoPriceNeeded() public {
        chainlink.set(0, block.timestamp); // feed down
        _deposit(bob, 100e6);
        vm.prank(lp);
        pool.redeem(1e6, lp);
    }

    /*//////////////////////////////////////////////////////////////
                       FIRST DEPOSIT AND DONATIONS
    //////////////////////////////////////////////////////////////*/

    function test_firstDepositMustExceedDeadShares() public {
        LiquidityPool fresh = new LiquidityPool(usdc, address(this));
        fresh.createShareToken{ value: 1e8 }();
        usdc.mint(bob, 1e6);
        vm.startPrank(bob);
        usdc.approve(address(fresh), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(LiquidityPool.LiquidityPool__TooFewShares.selector, 1_000));
        fresh.deposit(1_000, bob);
        uint256 got = fresh.deposit(1_001, bob);
        vm.stopPrank();
        assertEq(got, 1);
    }

    function test_inflationAttackUneconomic() public {
        LiquidityPool fresh = new LiquidityPool(usdc, address(this));
        fresh.createShareToken{ value: 1e8 }();
        IERC20 freshShares = IERC20(fresh.shareToken());
        usdc.mint(bob, 10_001e6);
        vm.startPrank(bob);
        usdc.approve(address(fresh), type(uint256).max);
        freshShares.approve(address(fresh), type(uint256).max);
        uint256 attackerShares = fresh.deposit(1_001, bob); // 1 share, 1,000 dead
        usdc.transfer(address(fresh), 10_000e6); // donation to inflate the share price
        vm.stopPrank();

        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(fresh), type(uint256).max);
        uint256 got = fresh.deposit(1_000e6, alice);
        vm.stopPrank();
        assertGt(got, 0);
        // the attacker can't come out ahead: the donation is spread over the dead shares too
        uint256 attackerValue = fresh.convertToAssets(attackerShares);
        assertLt(attackerValue, 10_000e6 + 1_001);
        assertApproxEqRel(fresh.convertToAssets(got), 1_000e6, 0.1e18); // alice keeps ≥ 90%
    }

    /*//////////////////////////////////////////////////////////////
                              ACCESS
    //////////////////////////////////////////////////////////////*/

    function test_onlyMarketPaysTraders() public {
        vm.expectRevert(LiquidityPool.LiquidityPool__OnlyMarket.selector);
        pool.payTrader(alice, 1e6);
        vm.prank(address(market));
        pool.payTrader(alice, 1e6);
        assertEq(usdc.balanceOf(alice), 1_001e6);
    }

    function test_payKeeperStopsAtFreeAssets() public {
        _open(alice, true, 100e6, 10);
        uint256 free = pool.freeAssets();
        vm.prank(address(market));
        vm.expectRevert(abi.encodeWithSelector(LiquidityPool.LiquidityPool__ExceedsFreeAssets.selector, free));
        pool.payKeeper(free + 1);
        vm.prank(address(market));
        pool.payKeeper(free);
        assertEq(pool.freeAssets(), 0);
    }

    function test_setMarketOnce() public {
        vm.expectRevert(LiquidityPool.LiquidityPool__MarketAlreadySet.selector);
        pool.setMarket(address(1));

        LiquidityPool fresh = new LiquidityPool(usdc, address(this));
        vm.expectRevert(LiquidityPool.LiquidityPool__InvalidAddress.selector);
        fresh.setMarket(address(0));
        vm.prank(alice);
        vm.expectRevert();
        fresh.setMarket(address(market));
        assertEq(fresh.requiredLiquidity(), 0);
    }

    function test_associateDoesNotRevertOffHedera() public {
        assertFalse(pool.associate());
    }

    function test_assetIsUsdc() public view {
        assertEq(pool.asset(), address(usdc));
    }

    /*//////////////////////////////////////////////////////////////
                                FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @dev Depositing then redeeming at once never returns more than went in.
    function testFuzz_roundTripNeverProfits(uint256 assets) public {
        assets = bound(assets, 1e6, 1_000_000e6);
        uint256 got = _deposit(bob, assets);
        vm.prank(bob);
        uint256 out = pool.redeem(got, bob);
        assertLe(out, assets);
        assertApproxEqAbs(out, assets, 2);
    }

    /// @dev The share price never falls when someone else deposits or withdraws.
    function testFuzz_othersFlowsKeepSharePrice(uint256 assets, uint256 out) public {
        assets = bound(assets, 1e6, 1_000_000e6);
        uint256 priceBefore = pool.convertToAssets(1e12);
        uint256 got = _deposit(bob, assets);
        assertGe(pool.convertToAssets(1e12), priceBefore);
        out = bound(out, 1, got);
        uint256 mid = pool.convertToAssets(1e12);
        vm.prank(bob);
        pool.redeem(out, bob);
        assertGe(pool.convertToAssets(1e12), mid);
    }

    /// @dev Withdrawing exactly `assets` always burns at least the shares redeeming would need.
    function testFuzz_withdrawRoundsAgainstTheCaller(uint256 assets) public view {
        assets = bound(assets, 1, 5_000e6);
        assertGe(pool.previewWithdraw(assets), pool.convertToShares(assets));
    }
}
