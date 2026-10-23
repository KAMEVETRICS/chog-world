// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice ERC-8217 draft discovery interface; canonical deployment status is a separate concern.
interface IAgentBindings {
    enum TokenStandard { ERC721, ERC1155, ERC6909 }

    struct Binding {
        TokenStandard standard;
        address tokenContract;
        uint256 tokenId;
    }

    event AgentBound(
        uint256 indexed agentId,
        TokenStandard indexed standard,
        address indexed tokenContract,
        uint256 tokenId,
        address registeredBy
    );

    function bindingOf(uint256 agentId) external view returns (Binding memory);
}
