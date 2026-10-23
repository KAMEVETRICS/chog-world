// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice EIP-6551 registry address derivation used by the canonical Tokenbound deployment.
interface IERC6551Registry {
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external view returns (address);
}
