// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { CustosBase } from "../CustosBase.sol";
import { Handler } from "./Handler.sol";
import { MarginAccount } from "../../contracts/MarginAccount.sol";

/// @dev Fuzzed deposits, withdrawals, opens, closes, price moves, liquidations and ticks.
contract SolvencyInvariantTest is CustosBase {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(market, pool, guard, usdc, chainlink, supra);
        targetContract(address(handler));
    }

    /// @notice The pool can always pay every open position's largest possible gain.
    function invariant_poolCoversMaxGains() public view {
        assertGe(usdc.balanceOf(address(pool)), market.totalOpenNotional());
    }

    /// @notice The market holds exactly the collateral of open positions.
    function invariant_marketHoldsCollateral() public view {
        uint256 sum;
        for (uint256 i = 0; i < market.traderCount(); i++) {
            sum += market.positionOf(market.traders(i)).collateral;
        }
        assertEq(usdc.balanceOf(address(market)), sum);
    }

    /// @notice Open interest books match the positions.
    function invariant_openInterestMatchesPositions() public view {
        uint256 longs;
        uint256 shorts;
        for (uint256 i = 0; i < market.traderCount(); i++) {
            MarginAccount.Position memory p = market.positionOf(market.traders(i));
            if (p.size > 0) longs += p.entryNotional;
            else shorts += p.entryNotional;
        }
        assertEq(market.longNotional(), longs);
        assertEq(market.shortNotional(), shorts);
    }

    /// @notice Shares never claim more than the pool holds.
    function invariant_sharesBacked() public view {
        assertLe(pool.convertToAssets(pool.totalSupply()), pool.totalAssets());
    }

    /// @notice Right after a tick at an Ok price, no position is left underwater (≤ 8 traders fit one page).
    function invariant_noUnderwaterAfterTick() public view {
        if (!handler.justSweptAtOkPrice()) return;
        uint256 price = guard.price();
        for (uint256 i = 0; i < market.traderCount(); i++) {
            assertFalse(market.isLiquidatable(market.traders(i), price));
        }
    }

    /// @notice The keeper chain never breaks while the reserve and capacity hold.
    function invariant_keeperStaysScheduled() public view {
        if (handler.ticks() == 0) return;
        assertGt(market.nextRunAt(), 0);
        assertTrue(market.nextSchedule() != address(0));
    }
}
