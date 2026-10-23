# ChogAdapter: payment wallet and owner-only ERC-8004 actions

Date: 2026-10-19. Status: implemented locally, not deployed. Target: Monad mainnet, chain 143.

## Problem

The adapter owns every awakened identity NFT. The ERC-8004 registry only lets that owner call
`setAgentWallet`, `unsetAgentWallet` and validation requests. The first adapter had no passthroughs,
so every awakened Chog was locked out of a payment wallet and validation. The adapter cannot be
upgraded, so a gap shipped to mainnet is permanent for every identity it creates.

## Decision: the agent wallet is the Chog's ERC-6551 account

The Chog World Order plan gives each Chog an ERC-6551 token-bound account (TBA) as its wallet.
The adapter therefore only lets the agent wallet be set to that Chog's TBA, never an arbitrary address.

- `tokenAccountOf(tokenId)` returns the TBA from the immutable ERC-6551 registry, account
  implementation and salt fixed at construction.
- `setAgentWallet(agentId, deadline, signature)`: current Chog holder only. It writes the TBA as
  `agentWallet`. The registry verifies `signature` against the TBA through ERC-1271. With
  Tokenbound AccountV3 the holder's EOA signs the registry's EIP-712 `AgentWalletSet` digest, whose
  `owner` field is the adapter address. The TBA must already be deployed.
- `unsetAgentWallet(agentId)`: current holder only.

Why only the TBA: the registry clears `agentWallet` only when the *identity* NFT moves, and here it
never moves. A free-form wallet would keep paying the seller after a Chog sale. A TBA is controlled by
whoever holds the Chog, so payments follow the NFT with no clean-up transaction.

## Decision: typed validation requests, no generic execution

`requestValidation(validationRegistry, validator, agentId, requestURI, requestHash)` is limited to the
current holder. The target must report `getIdentityRegistry() == identityRegistry` and cannot be the
identity registry or the collection. The ERC-8004 ValidationRegistry is not deployed on Monad mainnet
today (the upstream README lists only Identity and Reputation), so the address is supplied per call.

Rejected alternatives:
- ERC-721 `approve`/`setApprovalForAll` on identity NFTs. An approved address could transfer the
  identity out of the adapter or rewrite `agent-binding`.
- Generic `execute(target, data)`. The adapter owns *every* agent, so arbitrary calldata could act on
  another holder's `agentId`.

The ReputationRegistry needs no passthrough: its only owner check blocks self-feedback.

## Invariants kept

Immutable collection and registry, no admin, no upgrade, no withdrawal surface. The current
`ownerOf` holder controls every write. One awakening per token. `agent-binding` and `agentWallet`
stay unwritable through `setMetadata`. Unsolicited ERC-721 receipts are rejected.

## Holder-facing caveats to publish

- Assets in a Chog's TBA go to the buyer with the NFT. A seller can empty the TBA right before a sale.
- Sending a Chog into its own TBA (or a cycle of TBAs) locks it permanently.
- A Chog in a staking, escrow or vault contract can only be managed by that contract. No delegation
  support (for example delegate.xyz) is included.
- Holders are not the registry owner, so the ReputationRegistry's self-feedback check does not stop a
  holder from rating their own agent. Reputation readers must filter by trusted client addresses.
- The mainnet IdentityRegistry is an upgradeable proxy owned by an EOA (`0x5472…2603`, implementation
  `0x7274…9c02` as of 2026-10-19). Its owner can change registry behavior for all agents.
- Future owner-only ERC-8004 functions beyond these cannot be added to this adapter.
