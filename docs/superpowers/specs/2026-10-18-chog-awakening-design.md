# Chog Awakening proof

The user authorized the proposed first milestone: bind an existing Chog NFT to an ERC-8004 identity, then prove that management follows an NFT transfer. This is a new contract project in an empty workspace.

## Scope and approach

Implement a small, non-upgradeable adapter with immutable ERC-721 collection and identity-registry addresses. Its first environment is a local EVM with the actual upstream registry behind its expected proxy and a test NFT. Prepare a testnet deployment command, defaulting to a reviewable plan. A public deployment requires a funded testnet signer; no signer has been supplied.

Alternatives considered: reuse the deployed Mogs adapter (its collection is fixed, so it cannot serve Chogs); deploy the larger upgradeable Unruggable adapter (more administration and features than this proof needs); implement the focused adapter (selected).

## Contract behavior

- `awaken(tokenId, agentURI)` is callable only by the current NFT owner. One awakening per NFT per adapter; token ID zero and agent ID zero are valid.
- The registry mints the identity to the adapter. The adapter verifies custody, records an immutable ERC-721 binding, emits `AgentBound`, and writes its raw 20-byte address under `agent-binding`.
- `bindingOf(agentId)`, `agentOf(tokenId)`, and `controllerOf(agentId)` support discovery. Missing bindings revert instead of returning a misleading default ID.
- The current NFT owner can update the agent URI and ordinary metadata. Former owners and approved NFT operators have no adapter management rights. Reserved `agent-binding` and `agentWallet` metadata cannot be changed through the adapter.
- Clear the registry's default `agentWallet` during awakening. This proof has no wallet delegation, asset-execution, NFT withdrawal, rebinding, upgrade, or administrative control surface.
- Accept only the expected registry's safe mint during awakening; reject unsolicited NFT transfers. Protect mutations from reentrancy, including a duplicate awakening while registration is in progress.

## Verification

Use exact upstream registry source pinned by commit and OpenZeppelin 5.4.0. Integration tests cover custody, binding encoding/event, valid zero IDs, duplicate rejection, unauthorized calls, reserved metadata, nonexistent tokens/agents, receiver restrictions, and rollback on failed registry registration. The defining test lets A update, transfers the NFT to B, confirms A is rejected and B succeeds, and verifies identity ownership remains at the adapter.

Compile with solc 0.8.24, optimizer 200, viaIR, Shanghai EVM. Node's test runner and Hardhat's local EVM keep local checks independent of public RPC uptime. A local demo prints the defining transfer proof. Deployment planning validates chain ID 10143, registry code, collection interface, and constructor arguments before offering broadcast.

## Public-chain and runtime boundaries

Use the existing Monad ERC-8004 registry rather than deploying a competing registry. Mainnet Chog collection provenance must be documented before mainnet use. Do not represent this project-specific proof as the canonical ERC-8217 singleton; it uses the draft's discovery format. Backend memory, sessions, social credentials, inference, City, Cult, and Bots are later milestones. NFT transfer alone does not revoke those offchain permissions.

## Acceptance

`npm test` and `npm run demo` pass. The testnet deployment command produces a concrete plan without a private key. README clearly distinguishes local verification, public-chain reads, and any broadcast deployment. No mainnet transaction is required.
