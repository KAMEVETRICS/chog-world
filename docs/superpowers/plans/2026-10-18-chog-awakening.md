# Chog Awakening Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. The user authorized the first milestone in this chat; continue within that scope.

**Goal:** Prove that an existing Chog-style ERC-721 NFT controls a persistent ERC-8004 identity across ownership transfers.

**Architecture:** Immutable collection-specific adapter owning upstream registry identity NFTs; real upstream registry integration tests and local demonstration; separate testnet deployment planning and broadcast command.

**Tech Stack:** Solidity 0.8.24, OpenZeppelin 5.4.0, Hardhat 3.20.0 EVM, ethers 6.17.0, Node 24 test runner.

**Spec:** `docs/superpowers/specs/2026-10-18-chog-awakening-design.md`

## Global Constraints

- One awakening per NFT per adapter; token ID zero and agent ID zero are valid.
- Immutable binding, no upgrades or asset-execution surface.
- No mainnet transaction; public testnet broadcast requires an explicitly selected funded signer.
- Upstream sources pinned by commit and dependencies by exact version.
- Keep `agentWallet` unset and protect the binding metadata.

## Review Focus

- Registry safe-mint callback or reentrancy must not enable duplicate awakening or foreign NFT custody.
- Empty or zero IDs must not confuse existence checks.
- A stale owner, approved operator, or stranger must not manage an agent.
- Malicious reserved metadata writes must not corrupt discovery or payment-wallet state.
- Wrong network, missing contract code, or incomplete deployment inputs must fail before broadcast.

### Task 1: Adapter and real-registry tests

Files: `contracts/ChogAdapter.sol`, `contracts/interfaces/IIdentityRegistry.sol`, `contracts/test/TestChog.sol`, `contracts/vendor/erc8004/*`, `scripts/compile.mjs`, `test/helpers.mjs`, `test/adapter.test.mjs`.

Interfaces: `awaken(uint256,string) -> uint256`; `agentOf(uint256) -> uint256`; `bindingOf(uint256) -> (uint8,address,uint256)`; `controllerOf(uint256) -> address`; `setAgentURI(uint256,string)`; `setMetadata(uint256,string,bytes)`.

- [x] Write the defining ownership-transfer test first; run it and confirm missing adapter behavior is the failure.
- [x] Implement the minimal adapter and run the transfer proof.
- [x] Verify security, zero-ID, and rollback cases; reproduce the deployment-recovery finding before fixing it.
- [x] Run `npm test`; expected all integration tests pass against upstream registry version 2.0.0.

### Task 2: Reproducible local demo and testnet deployment preparation

Files: `scripts/demo.mjs`, `scripts/deploy.mjs`, `scripts/deployment-config.mjs`, `test/deployment.test.mjs`, `.env.example`, `README.md`.

Interfaces: deploy config takes explicit RPC, collection, registry, expected chain 10143; planning never signs; broadcasting only on `--broadcast` and chain 10143.

- [x] Write failing tests for wrong network, invalid addresses, and no-signing planning behavior.
- [x] Implement deployment preparation and local demo using Task 1 artifacts.
- [x] Run `npm test`, then the demo and deployment-plan entry points directly against the freshly compiled artifacts; passing transfer proof and concrete unsigned deployment configuration verified.

### Task 3: Provenance, public read check, final review

Files: `scripts/check-monad.mjs`, `docs/provenance.md`, `docs/progress.md`.

- [x] Record pinned upstream source checksums, registry addresses, and authentic Chog collection evidence.
- [x] Run read-only public checks; record failures separately from local test results.
- [x] Request a fresh security/code review, fix material findings, rerun full tests and demo.
- [x] Report local result and exact outstanding input for public deployment.
