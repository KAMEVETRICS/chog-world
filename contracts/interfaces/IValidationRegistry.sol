// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The ERC-8004 validation-request entry point that requires the identity owner as caller.
interface IValidationRegistry {
    function getIdentityRegistry() external view returns (address);
    function validationRequest(address validatorAddress, uint256 agentId, string calldata requestURI, bytes32 requestHash) external;
}
