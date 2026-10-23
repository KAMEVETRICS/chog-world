# Source and deployment provenance

Recorded on 2026-10-18 for the Chog Awakening local proof. This document records source pins and public-chain observations. It does not assert that project tests passed, that a public deployment occurred, or that the local adapter is a canonical binding singleton.

## Chog Genesis on Monad mainnet

| Field | Verified value |
| --- | --- |
| Collection | Chog Genesis |
| Contract | `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763` |
| Network | Monad mainnet |
| Chain ID | `143` (`0x8f`) |
| Token interface | ERC-721 |

The source chain is:

1. [Chog's official link hub](https://linktr.ee/chognft) links to the [Chog Genesis collection on OpenSea](https://opensea.io/collection/chog-genesis), alongside the Chog website and builder site.
2. An [OpenSea item in that collection](https://opensea.io/item/monad/0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763/1646) identifies the contract, Chog Genesis collection, Monad network, and ERC721 standard.
3. A [MonadScan mint transaction](https://monadscan.com/tx/0x730195964d4ec7cfba5b460cad486b5c35356d0edabc3b88506c4547c64bc6d9) independently associates the same address with an ERC-721 Chog Genesis mint, token ID 1425.
4. [Monad's official developer organization](https://github.com/monad-developers/) lists mainnet chain ID 143 and the public RPC `https://rpc.monad.xyz`; see also the [mainnet network documentation](https://docs.monad.xyz/developer-essentials/network-information).

Read-only JSON-RPC requests to `https://rpc.monad.xyz` succeeded during this session:

| Request | Result |
| --- | --- |
| `eth_chainId` | `0x8f`, decimal 143 |
| `eth_call` to the collection, `supportsInterface(0x80ac58cd)` | `true` |
| `eth_call` to the collection, `name()` | `Chog Genesis` |

The calls used `latest` and were not pinned to a historical block. They required no wallet, signature, or transaction. Subsequent requests encountered intermittent DNS/network failures; a successful read is not an availability guarantee. The separate `$CHOG` fungible-token address displayed on the Chog website is not the NFT collection address above.

## Official testnet collection remains unresolved

No official deployment of **Chog Genesis on the current Monad testnet** was verified. Historical [CHOG PASS OpenSea testnet listings](https://testnets.opensea.io/collection/chog-pass) identify Monad Testnet and link to Chog's website and social account, but that does not establish a current Genesis deployment or an authenticated contract address.

Monad's [official testnet documentation](https://docs.monad.xyz/developer-essentials/testnet) states that testnet was reset from genesis on 2025-12-16. Pre-reset collection listings cannot establish present contract availability. A test fixture or user-selected testnet ERC-721 must be labelled accordingly; it must not be represented as the authentic mainnet collection or an official testnet Genesis collection without further evidence.

## Published ERC-8004 identity registries

The official [ERC-8004 contracts address list](https://github.com/erc-8004/erc-8004-contracts#contract-addresses), also available at the [pinned source revision](https://github.com/erc-8004/erc-8004-contracts/blob/b9e466c250744a7e06b13dff9d3c2844ed64f825/README.md#contract-addresses), publishes:

| Network | Identity registry |
| --- | --- |
| Monad mainnet | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Monad testnet | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

These are upstream-published addresses. Live chain ID, deployed bytecode, and proxy implementation checks are separate from source provenance. The local proof instantiates upstream registry contracts in a local EVM; that local instance is not a new public registry deployment.

## Vendored upstream contracts

Upstream: [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts), pinned commit **`b9e466c250744a7e06b13dff9d3c2844ed64f825`**.

Each file under `contracts/vendor/erc8004/` was read locally and compared with the UTF-8 raw upstream source at this exact commit. All three SHA-256 values matched:

| Local file | Pinned upstream file | SHA-256 |
| --- | --- | --- |
| `contracts/vendor/erc8004/IdentityRegistryUpgradeable.sol` | [IdentityRegistryUpgradeable.sol](https://github.com/erc-8004/erc-8004-contracts/blob/b9e466c250744a7e06b13dff9d3c2844ed64f825/contracts/IdentityRegistryUpgradeable.sol) | `18c8ca8c88493b46e54d000c96eaf7470d1f9dbfe55493fd7fa923bae543ff75` |
| `contracts/vendor/erc8004/HardhatMinimalUUPS.sol` | [HardhatMinimalUUPS.sol](https://github.com/erc-8004/erc-8004-contracts/blob/b9e466c250744a7e06b13dff9d3c2844ed64f825/contracts/HardhatMinimalUUPS.sol) | `9d3b152b88733e61f40ae2de775f7448001b73d9165f23ee8bbe5dd88cd042aa` |
| `contracts/vendor/erc8004/ERC1967Proxy.sol` | [ERC1967Proxy.sol](https://github.com/erc-8004/erc-8004-contracts/blob/b9e466c250744a7e06b13dff9d3c2844ed64f825/contracts/ERC1967Proxy.sol) | `d70ae5779f17b5a0b42eea535227f4004072ccc35b4d0b4ffe7c0ed5502a25c5` |
| `contracts/vendor/erc8004/ValidationRegistryUpgradeable.sol` | [ValidationRegistryUpgradeable.sol](https://github.com/erc-8004/erc-8004-contracts/blob/b9e466c250744a7e06b13dff9d3c2844ed64f825/contracts/ValidationRegistryUpgradeable.sol) | `26b1ebb8718abfeba1f12d51201f2adcf6c02f5bde79902532bd2d8fc3657882` |

The pinned identity implementation reports version `2.0.0`. `HardhatMinimalUUPS` is upstream's test bootstrap implementation; it provides ownership and initialization before the proxy upgrades to the identity implementation. The vendored `ERC1967Proxy` file wraps OpenZeppelin's proxy. These files retain their upstream `SPDX-License-Identifier: MIT` notices unchanged.

The application contract is separate from these upstream sources. Its immutable, non-upgradeable design does not imply that the upstream registry itself is non-upgradeable.

## Exact OpenZeppelin dependencies

Both `package.json` and `package-lock.json` pin the following exact versions; the installed package metadata also reports `5.4.0` for each:

| Package | Version | Locked npm integrity |
| --- | --- | --- |
| `@openzeppelin/contracts` | `5.4.0` | `sha512-eCYgWnLg6WO+X52I16TZt8uEjbtdkgLC0SUX/xnAksjjrQI4Xfn4iBRoI5j55dmlOhDv1Y7BoR3cU7e3WWhC6A==` |
| `@openzeppelin/contracts-upgradeable` | `5.4.0` | `sha512-STJKyDzUcYuB35Zub1JpWW58JxvrFFVgQ+Ykdr8A9PGXgtq/obF5uoh07k2XmFyPxfnZdPdBdhkJ/n2YxJ87HQ==` |

Upstream repositories: [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v5.4.0) and [OpenZeppelin Contracts Upgradeable](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/tree/v5.4.0). Their MIT licensing and source notices remain applicable to those dependencies. The lockfile integrity values identify npm package archives; they are distinct from the Solidity file SHA-256 values above.

## Mogs reference and ERC-8217 discovery caveat

Design reference: [Mogs8004Adapter.sol](https://github.com/dnebayis/monadmogs/blob/ec29fc55aabc8370144df80572a2fd02231858f1/contracts/src/Mogs8004Adapter.sol), pinned repository commit **`ec29fc55aabc8370144df80572a2fd02231858f1`**. This is a source-reference commit, not a Chog contract address. It does not establish a Chog deployment or confer canonical status on this project's adapter.

The current [ERC-8217 specification](https://ercs.ethereum.org/ERCS/erc-8217), particularly its [deployment model](https://ercs.ethereum.org/ERCS/erc-8217#deployment-model), requires the canonical per-chain binding singleton. Its discovery format stores exactly the binding contract's 20-byte address under ERC-8004 metadata key `agent-binding`; clients then query `bindingOf(agentId)` for token standard, collection, and token ID. The binding and metadata pointer must remain immutable, and the key must be protected against untrusted writes.

Chog Awakening uses this discovery shape for a collection-specific local proof. **It is not established as Monad's canonical ERC-8217 singleton, and this document makes no full ERC-8217 compliance claim.** Matching the metadata encoding and interface alone does not satisfy the canonical deployment requirement. Controller authorization is defined by the adapter's contract behavior and must be assessed separately from metadata discovery.
