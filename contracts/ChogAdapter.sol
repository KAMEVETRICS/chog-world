// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {IAgentBindings} from "./interfaces/IAgentBindings.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {IValidationRegistry} from "./interfaces/IValidationRegistry.sol";

/// @notice A Chog NFT controls an adapter-held ERC-8004 identity. The agent wallet can only be the Chog's ERC-6551 account.
/// @dev Not an officially designated canonical ERC-8217 singleton. No approvals, generic execution or asset custody.
contract ChogAdapter is IAgentBindings, IERC721Receiver, ReentrancyGuard {
    IERC721 public immutable collection;
    IIdentityRegistry public immutable identityRegistry;
    IERC6551Registry public immutable accountRegistry;
    address public immutable accountImplementation;
    bytes32 public immutable accountSalt;

    mapping(uint256 tokenId => bool) private _awakened;
    mapping(uint256 tokenId => uint256) private _agents;
    mapping(uint256 agentId => Binding) private _bindings;
    mapping(uint256 agentId => bool) private _bound;
    bool private _acceptingMint;
    bool private _receivedMint;
    uint256 private _receivedAgentId;

    error InvalidContract(address target);
    error NotTokenOwner(uint256 tokenId, address caller);
    error AlreadyAwakened(uint256 tokenId);
    error NotAwakened(uint256 tokenId);
    error UnknownAgent(uint256 agentId);
    error ReservedMetadata(string key);
    error UnexpectedNFT();
    error InvalidRegistryMint(uint256 agentId);
    error TokenAccountNotDeployed(address account);

    constructor(
        address collection_,
        address identityRegistry_,
        address accountRegistry_,
        address accountImplementation_,
        bytes32 accountSalt_
    ) {
        if (!ERC165Checker.supportsInterface(collection_, type(IERC721).interfaceId)) {
            revert InvalidContract(collection_);
        }
        if (identityRegistry_ == collection_ || !ERC165Checker.supportsInterface(identityRegistry_, type(IERC721).interfaceId)) {
            revert InvalidContract(identityRegistry_);
        }
        if (accountRegistry_.code.length == 0) revert InvalidContract(accountRegistry_);
        if (accountImplementation_.code.length == 0) revert InvalidContract(accountImplementation_);
        collection = IERC721(collection_);
        identityRegistry = IIdentityRegistry(identityRegistry_);
        accountRegistry = IERC6551Registry(accountRegistry_);
        accountImplementation = accountImplementation_;
        accountSalt = accountSalt_;
    }

    function awaken(uint256 tokenId, string calldata agentURI) external nonReentrant returns (uint256 agentId) {
        _requireOwner(tokenId);
        if (_awakened[tokenId]) revert AlreadyAwakened(tokenId);
        _awakened[tokenId] = true;

        IIdentityRegistry.MetadataEntry[] memory metadata = new IIdentityRegistry.MetadataEntry[](1);
        metadata[0] = IIdentityRegistry.MetadataEntry("agent-binding", abi.encodePacked(address(this)));
        _acceptingMint = true;
        _receivedMint = false;
        agentId = identityRegistry.register(agentURI, metadata);
        _acceptingMint = false;

        if (!_receivedMint || _receivedAgentId != agentId || identityRegistry.ownerOf(agentId) != address(this) || _bound[agentId]) {
            revert InvalidRegistryMint(agentId);
        }
        _agents[tokenId] = agentId;
        _bindings[agentId] = Binding(TokenStandard.ERC721, address(collection), tokenId);
        _bound[agentId] = true;
        // External NFT transfers do not transfer the identity NFT or reset its payment wallet.
        identityRegistry.unsetAgentWallet(agentId);
        emit AgentBound(agentId, TokenStandard.ERC721, address(collection), tokenId, msg.sender);
    }

    function agentOf(uint256 tokenId) external view returns (uint256) {
        if (!_awakened[tokenId]) revert NotAwakened(tokenId);
        return _agents[tokenId];
    }

    function bindingOf(uint256 agentId) public view returns (Binding memory) {
        if (!_bound[agentId]) revert UnknownAgent(agentId);
        return _bindings[agentId];
    }

    function controllerOf(uint256 agentId) public view returns (address) {
        return collection.ownerOf(bindingOf(agentId).tokenId);
    }

    function setAgentURI(uint256 agentId, string calldata agentURI) external nonReentrant {
        _requireOwner(bindingOf(agentId).tokenId);
        identityRegistry.setAgentURI(agentId, agentURI);
    }

    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external nonReentrant {
        _requireOwner(bindingOf(agentId).tokenId);
        bytes32 keyHash = keccak256(bytes(key));
        if (keyHash == keccak256("agent-binding") || keyHash == keccak256("agentWallet")) revert ReservedMetadata(key);
        identityRegistry.setMetadata(agentId, key, value);
    }

    /// @notice The Chog's ERC-6551 account. Whoever holds the Chog controls it, so it moves with the NFT.
    function tokenAccountOf(uint256 tokenId) public view returns (address) {
        return accountRegistry.account(accountImplementation, accountSalt, block.chainid, address(collection), tokenId);
    }

    /// @notice Sets the agent's ERC-8004 payment wallet to its Chog's deployed ERC-6551 account.
    /// @param signature Accepted by that account through ERC-1271 for the registry's AgentWalletSet digest,
    /// whose owner field is this adapter. With Tokenbound accounts the current Chog holder signs it.
    function setAgentWallet(uint256 agentId, uint256 deadline, bytes calldata signature) external nonReentrant {
        uint256 tokenId = bindingOf(agentId).tokenId;
        _requireOwner(tokenId);
        address account = tokenAccountOf(tokenId);
        if (account.code.length == 0) revert TokenAccountNotDeployed(account);
        identityRegistry.setAgentWallet(agentId, account, deadline, signature);
    }

    function unsetAgentWallet(uint256 agentId) external nonReentrant {
        _requireOwner(bindingOf(agentId).tokenId);
        identityRegistry.unsetAgentWallet(agentId);
    }

    /// @notice Forwards an ERC-8004 validation request, which the validation registry only accepts from the identity owner.
    function requestValidation(
        address validationRegistry,
        address validator,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external nonReentrant {
        _requireOwner(bindingOf(agentId).tokenId);
        if (validationRegistry == address(identityRegistry) || validationRegistry == address(collection)) revert InvalidContract(validationRegistry);
        (bool ok, bytes memory result) = validationRegistry.staticcall(abi.encodeCall(IValidationRegistry.getIdentityRegistry, ()));
        if (!ok || result.length != 32 || abi.decode(result, (address)) != address(identityRegistry)) revert InvalidContract(validationRegistry);
        IValidationRegistry(validationRegistry).validationRequest(validator, agentId, requestURI, requestHash);
    }

    function onERC721Received(address operator, address from, uint256 agentId, bytes calldata) external returns (bytes4) {
        if (msg.sender != address(identityRegistry) || operator != address(this) || from != address(0) || !_acceptingMint || _receivedMint) {
            revert UnexpectedNFT();
        }
        _receivedMint = true;
        _receivedAgentId = agentId;
        return IERC721Receiver.onERC721Received.selector;
    }

    function _requireOwner(uint256 tokenId) private view {
        if (collection.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
    }
}
