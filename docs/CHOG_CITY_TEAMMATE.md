# Chog City: mainnet handoff

Date: 2026-10-20. Public information only. No private key is needed to build City, and none is in here.

## Deployed

| What | Value |
| --- | --- |
| ChogAdapter | `0x4A8d56DCAdB3bD4f8D9776E9e6F6211b845C6b02` ([Sourcify, exact match](https://repo.sourcify.dev/143/0x4A8d56DCAdB3bD4f8D9776E9e6F6211b845C6b02), [MonadScan](https://monadscan.com/address/0x4A8d56DCAdB3bD4f8D9776E9e6F6211b845C6b02)) |
| Deployment tx | `0xbd185b60f835b127f8c7c4e43f8bd96db7f8179f583dc47393f511d5ade022b7` |
| Activation block | `115003560` (index Chog Genesis transfers from here) |

The adapter has no admin and cannot be upgraded.

## Network and existing contracts

| What | Value |
| --- | --- |
| Chain | Monad mainnet, 143 (`0x8f`) |
| Public RPC | `https://rpc.monad.xyz`: `eth_getLogs` answers at most 100 blocks per request; `finalized` trails `latest` by about one block |
| Chog Genesis (ERC-721) | `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`, token IDs 1 to 1,969 |
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (v2.0.0, upgradeable by its owner; implementation `0x7274e874CA62410a93Bd8bf61c69d8045E399c02` at deploy) |
| ERC-8004 ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Tokenbound registry (ERC-6551) | `0x000000006551c19487814612e58FE06813775758` |
| Tokenbound AccountProxy | `0x55266d75D1a14E4572138116aF39863Ed6596E7F`, salt `0x00…00` (the Tokenbound SDK defaults; AccountV3 is `0x41C8f39463A868d3A88af00cd0fe7102F30E44eC`) |
| $CHOG (ERC-20, 18 decimals) | `0x350035555E10d9AfAF1566AaebfCeD5BA6C27777` |
| AI credits treasury | `0x04D32C3243c1a58D15E1bC7B036629eDB6B86Cc5` (holders send $CHOG here; credited from block 115000089) |

## Verified manifest

`deployments/manifests/monad-mainnet.json`, checked on chain at block 115004048 (receipt, activation block
hash, runtime code hash, and the adapter's collection and registry). City and Cult must use the same one,
or their agent keys won't match.

```json
{
  "environment": "monad-mainnet",
  "chainId": 143,
  "registry": "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
  "adapter": "0x4a8d56dcadb3bd4f8d9776e9e6f6211b845c6b02",
  "collection": "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763",
  "activationBlock": "115003560",
  "activationBlockHash": "0xa5205acf90e0430e85e874d2291658fe1603a8335291e894b94d9cc79704cf37",
  "receipts": {
    "adapterDeployment": "0xbd185b60f835b127f8c7c4e43f8bd96db7f8179f583dc47393f511d5ade022b7"
  },
  "runtimeCodeHashes": {
    "adapter": "0x5bd361efef40352c1299780dbe2b23176fcfe1f3f40c5c8d87bc1e70517ebf16"
  }
}
```

## Identity and ownership

- A holder calls `awaken(tokenId, agentURI)` once per Chog. The adapter registers the ERC-8004 identity
  and keeps it, so the registry's `ownerOf(agentId)` is always the adapter.
- Control follows the NFT: `controllerOf(agentId)` is the Chog's current `ownerOf`. Approved operators get
  no rights, and a sale hands control to the buyer at once.
- Anything a holder sets for their Chog should reset when it changes hands. Cult and Soul count an
  ownership epoch that advances on every Chog Transfer (even A → B → A).
- Agent key: `chainId:registry:adapter:collection:tokenId:agentId`, addresses lowercase, IDs decimal.
- No Chog is awakened yet: `agentOf(tokenId)` reverts with `NotAwakened` until its holder awakens it.

| Adapter function | Who | What it does |
| --- | --- | --- |
| `awaken(uint256 tokenId, string agentURI)` | Current holder | Creates the agent once; returns `agentId`; emits `AgentBound` |
| `agentOf(uint256 tokenId)` | Anyone | The Chog's `agentId` |
| `bindingOf(uint256 agentId)` | Anyone | `(standard, tokenContract, tokenId)` |
| `controllerOf(uint256 agentId)` | Anyone | Who controls the agent now |
| `tokenAccountOf(uint256 tokenId)` | Anyone | The Chog's Tokenbound wallet |
| `setAgentURI`, `setMetadata` | Current holder | Profile updates; `agent-binding` and `agentWallet` keys are reserved |
| `setAgentWallet(agentId, deadline, signature)`, `unsetAgentWallet(agentId)` | Current holder | Payment wallet = the Chog's Tokenbound account (the only one allowed), or cleared |
| `requestValidation(...)` | Current holder | Forwards an ERC-8004 validation request for that Chog's agent |

## City and Cult

Full contract with tested examples: `docs/superpowers/specs/2026-10-19-cult-city-contract.md`. In short,
City serves `GET /api/city/events` (SSE, `Last-Event-ID`, `reset`, 15-second heartbeats, headers sent
right away), and each `city_tick` carries `data.activities`: `{agentKey, kind, location}` per acting
resident. Visits and greetings at the Plaza, Tavern and Workshop earn faction presence. City can show
rulers from Cult's `GET /api/cult/places` and `place_control_changed`. Cult's public URL comes once it is
hosted.

## AI (OpenRouter)

Your own OpenRouter key, with a spending limit, arrives in a private message. Keep it in your local
environment only: never commit it, post it in a group chat, or ship it to the browser. API
`https://openrouter.ai/api/v1` (OpenAI-compatible); default model `anthropic/claude-haiku-5.5`.
