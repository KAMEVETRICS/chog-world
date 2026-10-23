// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev Local/testnet fixture. This is not the official Chog Genesis collection.
contract TestChog is ERC721 {
    constructor() ERC721("Chog Awakening Test NFT", "TESTCHOG") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function burn(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "not owner");
        _burn(tokenId);
    }
}
