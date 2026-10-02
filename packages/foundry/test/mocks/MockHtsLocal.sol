// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IHederaTokenService } from "hedera-forking/IHederaTokenService.sol";

/// @dev An ERC-20 that stands in for an HTS fungible token on a plain local chain. Only the HTS stand-in may mint,
///      burn and move it on the treasury's behalf.
contract LocalHtsToken is ERC20 {
    address internal immutable _hts;
    uint8 internal immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _hts = msg.sender;
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function htsMint(address to, uint256 amount) external {
        require(msg.sender == _hts, "only HTS");
        _mint(to, amount);
    }

    function htsBurn(address from, uint256 amount) external {
        require(msg.sender == _hts, "only HTS");
        _burn(from, amount);
    }

    function htsTransfer(address from, address to, uint256 amount) external {
        require(msg.sender == _hts, "only HTS");
        _transfer(from, to, amount);
    }
}

/// @dev The four Hedera Token Service calls `LiquidityPool` makes, for a plain local chain (anvil) where 0x167 is
///      empty. `script/Deploy.s.sol` installs it with `anvil_setCode`. Not used in tests (they use the hedera-forking
///      emulator) and never on Hedera, where the real service answers.
contract MockHtsLocal {
    int64 internal constant SUCCESS = 22;

    mapping(address => address) public treasuryOf;

    function createFungibleToken(IHederaTokenService.HederaToken memory token, int64, int32 decimals)
        external
        payable
        returns (int64, address)
    {
        // forge-lint: disable-next-line(unsafe-typecast)
        LocalHtsToken created = new LocalHtsToken(token.name, token.symbol, uint8(uint32(decimals)));
        treasuryOf[address(created)] = token.treasury;
        if (msg.value > 0) payable(msg.sender).transfer(msg.value); // locally, creating a token is free
        return (SUCCESS, address(created));
    }

    function mintToken(address token, int64 amount, bytes[] memory) external returns (int64, int64, int64[] memory) {
        require(msg.sender == treasuryOf[token], "not the supply key");
        // forge-lint: disable-next-line(unsafe-typecast)
        LocalHtsToken(token).htsMint(msg.sender, uint256(uint64(amount)));
        return (SUCCESS, 0, new int64[](0));
    }

    function burnToken(address token, int64 amount, int64[] memory) external returns (int64, int64) {
        require(msg.sender == treasuryOf[token], "not the supply key");
        // forge-lint: disable-next-line(unsafe-typecast)
        LocalHtsToken(token).htsBurn(msg.sender, uint256(uint64(amount)));
        return (SUCCESS, 0);
    }

    function transferToken(address token, address sender, address recipient, int64 amount) external returns (int64) {
        require(msg.sender == sender, "only the sender");
        // forge-lint: disable-next-line(unsafe-typecast)
        LocalHtsToken(token).htsTransfer(sender, recipient, uint256(uint64(amount)));
        return SUCCESS;
    }
}
