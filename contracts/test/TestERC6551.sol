// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Local fixture following the EIP-6551 reference registry's account address derivation.
contract TestERC6551Registry {
    event ERC6551AccountCreated(address account, address indexed implementation, bytes32 salt, uint256 chainId, address indexed tokenContract, uint256 indexed tokenId);

    function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external returns (address created) {
        bytes memory code = _creationCode(implementation, salt, chainId, tokenContract, tokenId);
        created = _computeAddress(salt, keccak256(code));
        if (created.code.length != 0) return created;
        assembly { created := create2(0, add(code, 0x20), mload(code), salt) }
        require(created != address(0), "create failed");
        emit ERC6551AccountCreated(created, implementation, salt, chainId, tokenContract, tokenId);
    }

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external view returns (address) {
        return _computeAddress(salt, keccak256(_creationCode(implementation, salt, chainId, tokenContract, tokenId)));
    }

    function _creationCode(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"3d60ad80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3",
            abi.encode(salt, chainId, tokenContract, tokenId)
        );
    }

    function _computeAddress(bytes32 salt, bytes32 codeHash) private view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash)))));
    }
}

/// @dev Local fixture: the current holder of the bound NFT signs for the account through ERC-1271, as Tokenbound AccountV3 does.
contract TestTokenAccount {
    function token() public view returns (uint256 chainId, address tokenContract, uint256 tokenId) {
        bytes memory footer = new bytes(0x60);
        assembly { extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60) }
        return abi.decode(footer, (uint256, address, uint256));
    }

    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) return address(0);
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError error, ) = ECDSA.tryRecover(hash, signature);
        return error == ECDSA.RecoverError.NoError && signer == owner() ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function execute(address to, uint256 value, bytes calldata data, uint8 operation) external payable returns (bytes memory result) {
        require(msg.sender == owner() && operation == 0, "not owner");
        bool ok;
        (ok, result) = to.call{value: value}(data);
        if (!ok) assembly { revert(add(result, 0x20), mload(result)) }
    }

    receive() external payable {}
}
