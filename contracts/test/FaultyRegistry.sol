// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

interface IAwakening {
    function awaken(uint256 tokenId, string calldata uri) external returns (uint256);
}

/// @dev Adversarial dependency used only for rollback and reentrancy tests.
contract FaultyRegistry is ERC721 {
    struct MetadataEntry { string metadataKey; bytes metadataValue; }
    uint256 private _nextId;
    uint256 public mode;
    bool public reentryBlocked;
    uint256 private _reentryToken;

    error RegistrationRejected();
    error WalletClearRejected();

    constructor() ERC721("Faulty test registry", "FAULT") {}

    function setMode(uint256 nextMode) external { mode = nextMode; }

    function startReentry(address adapter, uint256 tokenId) external {
        _reentryToken = tokenId;
        IAwakening(adapter).awaken(tokenId, "ipfs://reentry-test");
    }

    function register(string calldata, MetadataEntry[] calldata) external returns (uint256 agentId) {
        if (mode == 1) revert RegistrationRejected();
        agentId = _nextId++;
        if (mode == 2) { _mint(tx.origin, agentId); return agentId; }
        _safeMint(msg.sender, agentId);
        if (mode == 4) {
            try IAwakening(msg.sender).awaken(_reentryToken, "ipfs://attack") { revert("reentry succeeded"); }
            catch (bytes memory reason) {
                reentryBlocked = bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()"));
            }
        }
    }

    function unsetAgentWallet(uint256) external view {
        if (mode == 3) revert WalletClearRejected();
    }
}
