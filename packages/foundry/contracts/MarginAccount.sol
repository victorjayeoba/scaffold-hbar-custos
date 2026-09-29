// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

/**
 * @title MarginAccount
 * @notice Position book and risk math. No tokens, no oracle: the child passes prices in.
 * @dev Units: size in HBAR (1e18, + long / − short), price in USD per HBAR (1e18), money in USDC (1e6).
 *      `size × price / 1e30` is USDC. A position's gain (PnL minus funding) is capped at its entry notional,
 *      so the pool never owes more than the open interest it accepted.
 */
abstract contract MarginAccount {
    struct Position {
        int256 size;
        uint256 collateral;
        uint256 entryPrice;
        uint256 entryNotional;
        int256 fundingIndex;
        uint64 openedAt;
    }

    uint256 public constant MAX_LEVERAGE = 50;
    uint256 public constant MAINTENANCE_BPS = 100;
    /// @notice Funding per hour, 1e18 = 100%, when the long/short skew equals the pool's assets.
    uint256 public constant FUNDING_FACTOR_PER_HOUR = 1e15;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant USDC_PER_SIZE_PRICE = 1e30;

    mapping(address => Position) internal _positions;
    address[] public traders;
    mapping(address => uint256) internal _slot; // index in `traders` + 1

    uint256 public longNotional;
    uint256 public shortNotional;
    int256 public fundingIndex;
    uint256 public fundingUpdatedAt;

    event FundingAccrued(int256 ratePerHour, int256 index);

    constructor() {
        fundingUpdatedAt = block.timestamp;
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    function positionOf(address trader) external view returns (Position memory) {
        return _positions[trader];
    }

    function traderCount() external view returns (uint256) {
        return traders.length;
    }

    function totalOpenNotional() public view returns (uint256) {
        return longNotional + shortNotional;
    }

    /// @notice Unrealised PnL in USDC at `price`, before funding and the gain cap.
    function pnl(address trader, uint256 price) public view returns (int256) {
        Position storage p = _positions[trader];
        return p.size * (int256(price) - int256(p.entryPrice)) / int256(USDC_PER_SIZE_PRICE);
    }

    /// @notice Funding the trader owes (negative: is owed), including what has accrued since the last update.
    function fundingOwed(address trader) public view returns (int256) {
        Position storage p = _positions[trader];
        if (p.size == 0) return 0;
        int256 owed = (currentFundingIndex() - p.fundingIndex) * int256(p.entryNotional) / 1e18;
        return p.size > 0 ? owed : -owed;
    }

    /// @notice Collateral + PnL − funding, with the gain capped at the entry notional. USDC, may be negative.
    function equity(address trader, uint256 price) public view returns (int256) {
        Position storage p = _positions[trader];
        if (p.size == 0) return 0;
        int256 gain = pnl(trader, price) - fundingOwed(trader);
        if (gain > int256(p.entryNotional)) gain = int256(p.entryNotional);
        return int256(p.collateral) + gain;
    }

    function maintenanceMargin(address trader) public view returns (uint256) {
        return _positions[trader].entryNotional * MAINTENANCE_BPS / BPS;
    }

    function isLiquidatable(address trader, uint256 price) public view returns (bool) {
        if (_positions[trader].size == 0) return false;
        return equity(trader, price) < int256(maintenanceMargin(trader));
    }

    /// @notice The price at which the position becomes liquidatable, at current funding. 0 if none.
    function liquidationPrice(address trader) external view returns (uint256) {
        Position storage p = _positions[trader];
        if (p.size == 0) return 0;
        int256 buffer = int256(p.collateral) - fundingOwed(trader) - int256(maintenanceMargin(trader));
        int256 liq = int256(p.entryPrice) - buffer * int256(USDC_PER_SIZE_PRICE) / p.size;
        return liq > 0 ? uint256(liq) : 0;
    }

    /// @notice Funding index including accrual up to now.
    function currentFundingIndex() public view returns (int256) {
        (int256 index,) = _pendingFunding();
        return index;
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Assets funding is measured against (the pool). 0 means no funding accrues.
    function _fundingPoolAssets() internal view virtual returns (uint256);

    function _pendingFunding() internal view returns (int256 index, int256 ratePerHour) {
        index = fundingIndex;
        uint256 assets = _fundingPoolAssets();
        if (assets == 0) return (index, 0);
        int256 skew = int256(longNotional) - int256(shortNotional);
        ratePerHour = int256(FUNDING_FACTOR_PER_HOUR) * skew / int256(assets);
        uint256 dt = block.timestamp - fundingUpdatedAt;
        index += int256(FUNDING_FACTOR_PER_HOUR) * skew * int256(dt) / (int256(assets) * 3600);
    }

    function _accrueFunding() internal {
        if (block.timestamp == fundingUpdatedAt) return;
        (int256 index, int256 ratePerHour) = _pendingFunding();
        fundingIndex = index;
        fundingUpdatedAt = block.timestamp;
        emit FundingAccrued(ratePerHour, index);
    }

    function _addPosition(address trader, int256 size, uint256 collateral, uint256 price, uint256 notional) internal {
        _positions[trader] = Position({
            size: size,
            collateral: collateral,
            entryPrice: price,
            entryNotional: notional,
            fundingIndex: fundingIndex,
            openedAt: uint64(block.timestamp)
        });
        traders.push(trader);
        _slot[trader] = traders.length;
        if (size > 0) longNotional += notional;
        else shortNotional += notional;
    }

    function _removePosition(address trader) internal {
        Position storage p = _positions[trader];
        if (p.size > 0) longNotional -= p.entryNotional;
        else shortNotional -= p.entryNotional;

        uint256 index = _slot[trader] - 1;
        address last = traders[traders.length - 1];
        traders[index] = last;
        _slot[last] = index + 1;
        traders.pop();
        delete _slot[trader];
        delete _positions[trader];
    }
}
