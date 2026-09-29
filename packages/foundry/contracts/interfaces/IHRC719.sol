// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

/// @notice HIP-719: an HTS token's own facade lets the calling account (or contract) associate itself.
interface IHRC719 {
    function associate() external returns (uint256 responseCode);
}
