// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { CustosBase } from "./CustosBase.sol";
import { HbarDepositZap } from "../contracts/periphery/HbarDepositZap.sol";
import { PriceGuard } from "../contracts/PriceGuard.sol";

contract HbarDepositZapTest is CustosBase {
    HbarDepositZap internal zap;
    address internal carol = makeAddr("carol");

    function setUp() public override {
        super.setUp();
        zap = new HbarDepositZap(address(pool), address(guard), address(router), WHBAR, 300);
        vm.deal(carol, 1_000e8);
    }

    function test_depositWithHbarSwapsAndDepositsForTheCaller() public {
        uint256 usdcOut = 22.7e6; // 10 HBAR at the mock router's 2.27 USDC
        assertEq(zap.quote(10e8), usdcOut);
        uint256 expectShares = pool.previewDeposit(usdcOut);
        uint256 poolBefore = usdc.balanceOf(address(pool));

        vm.expectEmit(true, false, false, true, address(zap));
        emit HbarDepositZap.DepositedWithHbar(carol, 10e8, usdcOut, expectShares);
        vm.prank(carol);
        uint256 got = zap.depositWithHbar{ value: 10e8 }(usdcOut);

        assertEq(got, expectShares);
        assertEq(shares.balanceOf(carol), expectShares); // the shares land with the caller, not the zap
        assertEq(usdc.balanceOf(address(pool)) - poolBefore, usdcOut);
        assertEq(usdc.balanceOf(address(zap)), 0); // the zap keeps nothing
        assertEq(address(zap).balance, 0);
        assertEq(shares.balanceOf(address(zap)), 0);
    }

    function test_callerMinimumIsEnforced() public {
        vm.prank(carol);
        vm.expectRevert(bytes("slippage"));
        zap.depositWithHbar{ value: 10e8 }(22.7e6 + 1);
    }

    function test_oracleFloorStopsAShortChangingPool() public {
        // oracle $0.12, floor 3% below: 0.1164 USDC per HBAR. A pool paying 0.10 is refused even with minUsdc 0.
        assertEq(zap.oracleFloor(1e8), 116_400);
        router.setRate(100_000);
        vm.prank(carol);
        vm.expectRevert(bytes("slippage"));
        zap.depositWithHbar{ value: 10e8 }(0);

        router.setRate(116_400); // exactly at the floor: accepted
        vm.prank(carol);
        zap.depositWithHbar{ value: 10e8 }(0);
        assertGt(shares.balanceOf(carol), 0);
    }

    function testFuzz_neverFillsBelowTheOracleFloor(uint256 hbar, uint256 rate) public {
        hbar = bound(hbar, 1e8, 500e8);
        rate = bound(rate, 1, 10_000_000);
        router.setRate(rate);
        uint256 out = hbar * rate / 1e8;
        uint256 floor = zap.oracleFloor(hbar);
        vm.prank(carol);
        if (out < floor || out == 0) {
            vm.expectRevert();
            zap.depositWithHbar{ value: hbar }(0);
        } else {
            uint256 got = zap.depositWithHbar{ value: hbar }(0);
            assertGt(got, 0);
            assertEq(usdc.balanceOf(address(zap)), 0);
        }
    }

    function test_needsAnOkPrice() public {
        supra.set(10_000_000, block.timestamp); // Deviated
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PriceGuard__NotOk.selector, PriceGuard.Status.Deviated));
        zap.depositWithHbar{ value: 10e8 }(0);
    }

    function test_zeroValueReverts() public {
        vm.prank(carol);
        vm.expectRevert(HbarDepositZap.HbarDepositZap__ZeroAmount.selector);
        zap.depositWithHbar(0);
    }

    function test_constructorChecks() public {
        vm.expectRevert(HbarDepositZap.HbarDepositZap__InvalidAddress.selector);
        new HbarDepositZap(address(0), address(guard), address(router), WHBAR, 300);
        vm.expectRevert(HbarDepositZap.HbarDepositZap__InvalidAddress.selector);
        new HbarDepositZap(address(pool), address(guard), address(router), address(0), 300);
        vm.expectRevert(HbarDepositZap.HbarDepositZap__InvalidConfig.selector);
        new HbarDepositZap(address(pool), address(guard), address(router), WHBAR, 10_000);
        assertEq(address(zap.usdc()), address(usdc));
    }

    function test_associateDoesNotRevertOffHedera() public {
        assertFalse(zap.associate());
    }
}
