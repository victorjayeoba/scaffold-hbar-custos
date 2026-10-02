// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IAggregatorV3 } from "./interfaces/IAggregatorV3.sol";
import { ISupraSValueFeed } from "./interfaces/ISupraSValueFeed.sol";

/**
 * @title PriceGuard
 * @notice The one place prices come from. Chainlink is the price; Supra is the cross-check.
 *         `Stale` if either feed is older than `maxStaleness`, `Deviated` if they differ by more
 *         than `maxDeviationBps`. The market only opens and liquidates at an `Ok` price.
 */
contract PriceGuard is Ownable {
    enum Status {
        Ok,
        Stale,
        Deviated
    }

    error PriceGuard__NotOk(Status status);
    error PriceGuard__InvalidConfig();

    uint256 internal constant BPS = 10_000;
    /// @notice Upper bounds on what the owner may set, so a guard can never be configured to wave every price through.
    uint256 public constant MAX_STALENESS_LIMIT = 1 days;
    uint256 public constant MAX_DEVIATION_LIMIT_BPS = 2_000;

    IAggregatorV3 public immutable chainlink;
    ISupraSValueFeed public immutable supra;
    uint256 public immutable supraPair;
    uint256 internal immutable _chainlinkScale;

    uint256 public maxStaleness;
    uint256 public maxDeviationBps;

    event ParamsSet(uint256 maxStaleness, uint256 maxDeviationBps);

    constructor(
        address chainlink_,
        address supra_,
        uint256 supraPair_,
        uint256 maxStaleness_,
        uint256 maxDeviationBps_,
        address owner_
    ) Ownable(owner_) {
        if (chainlink_ == address(0) || supra_ == address(0)) {
            revert PriceGuard__InvalidConfig();
        }
        chainlink = IAggregatorV3(chainlink_);
        supra = ISupraSValueFeed(supra_);
        supraPair = supraPair_;
        uint8 dec = IAggregatorV3(chainlink_).decimals();
        if (dec > 18) revert PriceGuard__InvalidConfig();
        _chainlinkScale = 10 ** (18 - dec);
        _setParams(maxStaleness_, maxDeviationBps_);
    }

    /// @notice Changes the staleness window (seconds) and the largest Chainlink/Supra gap allowed (basis points).
    function setParams(uint256 maxStaleness_, uint256 maxDeviationBps_) external onlyOwner {
        _setParams(maxStaleness_, maxDeviationBps_);
    }

    /// @notice Chainlink's price, 1e18 = 1 USD per HBAR. Reverts unless the status is `Ok`.
    function price() external view returns (uint256) {
        (uint256 p, Status s,,,) = read();
        if (s != Status.Ok) revert PriceGuard__NotOk(s);
        return p;
    }

    /// @notice Ok, Stale or Deviated, right now.
    function status() external view returns (Status s) {
        (, s,,,) = read();
    }

    /// @notice Both feeds scaled to 1e18 (0 for a feed that is unavailable) and the status. Never reverts.
    /// @dev The market uses this to settle a close at the price worse for the trader when the feeds disagree.
    function prices() external view returns (uint256 chainlinkPrice, uint256 supraPrice, Status status_) {
        uint256 chainlinkAt;
        uint256 supraAt;
        (chainlinkPrice, chainlinkAt) = _readChainlink();
        (supraPrice, supraAt) = _readSupra();
        status_ = _status(chainlinkPrice, supraPrice, chainlinkAt, supraAt);
    }

    /// @notice Everything the UI shows. Never reverts: a feed that fails to answer reads as `Stale`.
    /// @return price_ Chainlink price scaled to 1e18 (0 if unavailable)
    /// @return status_ Ok, Stale or Deviated
    /// @return chainlinkAt Chainlink's last update, unix seconds
    /// @return supraAt Supra's last update, unix seconds
    /// @return deviationBps How far apart the two feeds are, in basis points of Chainlink's price
    function read()
        public
        view
        returns (uint256 price_, Status status_, uint256 chainlinkAt, uint256 supraAt, uint256 deviationBps)
    {
        uint256 supraPrice;
        (price_, chainlinkAt) = _readChainlink();
        (supraPrice, supraAt) = _readSupra();

        deviationBps = _deviationBps(price_, supraPrice);
        status_ = _status(price_, supraPrice, chainlinkAt, supraAt);
    }

    function _status(uint256 chainlinkPrice, uint256 supraPrice, uint256 chainlinkAt, uint256 supraAt)
        internal
        view
        returns (Status)
    {
        if (chainlinkPrice == 0 || supraPrice == 0 || _isStale(chainlinkAt) || _isStale(supraAt)) return Status.Stale;
        if (_deviationBps(chainlinkPrice, supraPrice) > maxDeviationBps) return Status.Deviated;
        return Status.Ok;
    }

    function _deviationBps(uint256 chainlinkPrice, uint256 supraPrice) internal pure returns (uint256) {
        if (chainlinkPrice == 0 || supraPrice == 0) return 0;
        uint256 diff = chainlinkPrice > supraPrice ? chainlinkPrice - supraPrice : supraPrice - chainlinkPrice;
        return diff * BPS / chainlinkPrice;
    }

    function _readChainlink() internal view returns (uint256 p, uint256 at) {
        try chainlink.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer > 0) return (uint256(answer) * _chainlinkScale, updatedAt);
        } catch { }
        return (0, 0);
    }

    function _readSupra() internal view returns (uint256 p, uint256 at) {
        try supra.getSvalue(supraPair) returns (ISupraSValueFeed.PriceFeed memory feed) {
            if (feed.price == 0 || feed.decimals > 36) return (0, 0);
            p = feed.decimals <= 18 ? feed.price * 10 ** (18 - feed.decimals) : feed.price / 10 ** (feed.decimals - 18);
            return (p, feed.time / 1000);
        } catch { }
        return (0, 0);
    }

    function _isStale(uint256 at) internal view returns (bool) {
        return at == 0 || (block.timestamp > at && block.timestamp - at > maxStaleness);
    }

    function _setParams(uint256 maxStaleness_, uint256 maxDeviationBps_) internal {
        if (
            maxStaleness_ == 0 || maxStaleness_ > MAX_STALENESS_LIMIT || maxDeviationBps_ == 0
                || maxDeviationBps_ > MAX_DEVIATION_LIMIT_BPS
        ) revert PriceGuard__InvalidConfig();
        maxStaleness = maxStaleness_;
        maxDeviationBps = maxDeviationBps_;
        emit ParamsSet(maxStaleness_, maxDeviationBps_);
    }
}
