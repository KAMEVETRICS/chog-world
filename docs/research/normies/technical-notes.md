# NORMIES technical structure and trust boundaries

Research date: 2026-10-21. Primary project documentation, source code and public deployment reports were inspected. No wallet connection, signature, transaction, local test execution, or fresh RPC read of proxy slots was performed. Main-branch source is not itself proof that a particular implementation is deployed.

## Interpretation

NORMIES has on-chain art, editable overlays, accounting and agent identity bindings. Its currently documented Agentic product is an identity/persona discovery layer, not a running autonomous agent service. “Zero servers” applies narrowly to reading NFT art and metadata from contracts: the hosted agent manifests, persona generation, event index, API and proposed execution environment introduce server dependencies.

Official source links:
- https://www.normies.art/docs/technical
- https://www.normies.art/docs/agentic
- https://www.normies.art/docs/lab
- https://api.normies.art/llms.txt
- https://github.com/ygtdmn/normies

## Art representation

The technical docs specify 40×40 mint art, 1 bit/pixel, 1,600 bits = 200 bytes. Encoding is MSB-first (bit 7 of byte 0 is the top-left pixel). SSTORE2 places data in contract bytecode, with a per-token pointer. The renderer merges consecutive filled pixels in each row into runs and constructs SVG on-chain; colors are #48494b / #e3e5e4. Eight trait bytes represent Type, Gender, Age, Hair Style, Facial Feature, Eyes, Expression and Accessory. Canvas V2 allows 50/60/70/80-sided grids (313/450/613/800 bytes).

Base and overlay are separate. The visual output is base XOR overlay, with each overlay set bit toggling a pixel. Zombie base art replaces the human base; blank canvases suppress the base entirely. Historical on-chain data persistence must not be confused with immutability of current pointers or renderer selection.

Sources: https://www.normies.art/docs/technical ; https://github.com/ygtdmn/normies/blob/main/src/NormiesBitmap.sol ; https://github.com/ygtdmn/normies/blob/main/src/NormiesRendererV6.sol

RendererV6 source also qualifies a general documentation claim: its Pixel Count is original art for non-zombies, but composited current image for zombies (tokenURI's explicit branch/comment). Avoid saying the numeric metadata Pixel Count never changes for every possible type. The renderer has owner-settable storage, transform-storage, zombie and Legendary Canvas references.

## NFT owner/admin powers

Normies.sol is ERC721C + ERC-2981, with a modular renderer and storage reference. The owner may change rendererContract, storageContract, minter authorizations and default royalty settings. Owner or authorized minter can mint. Burn accepts the approved address or token owner.

A significant qualification to a fixed-supply narrative: mint checks circulating _totalSupply < 10,000 and tokenId < 10,000, and burn decrements _totalSupply. There is no lifetime-ever-minted guard in this file. An authorized minter can therefore remint an available burned ID under this source. StorageV2 explicitly anticipates this in resetTokenState's comment, “Burned ids can be minted again.” This is an observed capability in source, not evidence it has happened or that minter permissions are currently enabled.

Source: https://github.com/ygtdmn/normies/blob/main/src/Normies.sol

Original-storage setters are also mutable: owner or authorized writers can replace SSTORE2 image pointers and packed traits. revealHash can be set only once and must be nonzero. Historical bytecode is still durable; the selected canonical record can change. Source implements a keccak-derived XOR keystream and traits XOR revealHash. The implementation shown does not include token ID in its image-keystream derivation, despite higher-level prose suggesting a token-keyed scheme.

Source: https://github.com/ygtdmn/normies/blob/main/src/NormiesStorage.sol

## Canvas accounting and permissions

CanvasV2 burns immediately on commit, records original filled-pixel counts, and moves existing attached pixels immediately. Reward is credited on reveal. The future entropy block is commitBlock + 5; reveal requires block.number greater than that. Expired blockhash gives the minimum tier reward. Current defaults: original pixel count <490 -> 1–4%, 490–889 -> 2–4%, >=890 -> 3–4%; integer-floor reward. The reward can target an owned Normie or the committer wallet. A token receiver that becomes nonexistent is handled by a wallet fallback in _creditReward.

Painting checks bitmap size/padding and popcount <= attached pixels, without consuming those pixels. Level is floor(attached/10)+1. Unused attached pixels can be withdrawn; taking pixels supporting an overlay requires explicit overlay reset. Canvas growth/blanking consume pixels.

CanvasV2 itself is not a proxy in the inspected source, but owner can repoint canvasStorage and zombieContract; replaceable logic is supported through storage roles. GUARDIAN/owner can pause all CanvasV2 operations including reveal. CONFIG/owner controls burn tiers and max percentage (<=100) and service prices. Tiers are read at reveal, so pending reward rules can change; a pause can outlast entropy availability.

Source: https://github.com/ygtdmn/normies/blob/main/src/NormiesCanvasV2.sol

StorageV2 contains overlays, attached and wallet pixels, allowances, cooldowns, grid sizes and delegates, with fallback to legacy overlay storage. Owner may authorize overlay writers and assign mover roles. ROLE_CANVAS can mint, burn, attach and detach; ROLE_MARKET / ROLE_WRAPPER can move wallet balances. Thus those roles and the admin who grants them are a trust boundary.

Pixel allowance is custody over that amount, including approved operations spending from attached pixels. Painting delegation does not grant spending permission. GUARDIAN/owner can disable third-party allowances; owners can still act and revoke. Default incoming-pixel cooldown is one minute; owner can set per-address longer cooldown up to seven days. Burn rewards do not cool. Existing grid, base-cleared and delegate state reset when a token is burned.

Source: https://github.com/ygtdmn/normies/blob/main/src/NormiesCanvasStorageV2.sol

Canvas delegates are owner-specific; their rights lapse on transfer and revive if the token returns to the setting owner. delegate.xyz V1/V2 delegates have painting rights. This is separate from agent management and pixel allowances. Enlargement launch totals are 900/2,000/3,300/4,800 pixels; blanking 200. The original Canvas is paused; V2 migration copied balances/delegates and legacy overlay reads remain supported.

Source: https://www.normies.art/docs/lab

## Market and revenue trust

PixelMarket is an ETH sell-side order book with partial or all-or-none fills, optional expiration and permissionless return of expired escrow. CONFIG may change listing price floor and fee/split parameters. The fee hard cap is 10%, but revenueShareBps can be any value from 0 to 10,000; half-to-holders is a configuration, not an immutable split. Owner can change fee recipient addresses. GUARDIAN/owner pauses listing/fills, while cancellation paths are separate.

Source: https://github.com/ygtdmn/normies/blob/main/src/NormiesPixelMarket.sol

RevenuePool posts off-chain-computed Merkle allocations, then opens claims after 24 hours. POSTER/owner posts; GUARDIAN/owner may cancel only before claims open. Claims themselves cannot be paused. CONFIG sets future claim windows, bounded below by 30 days. Owner may withdraw unallocated ETH, but not amounts reserved by posted epochs. Root correctness remains an off-chain scorer/poster/guardian monitoring dependency: the contract proves membership in a posted allocation, not fairness of that allocation.

Source: https://github.com/ygtdmn/normies/blob/main/src/NormiesRevenuePool.sol

NormiesAccess distinguishes owner, GUARDIAN (pause/allowance emergency switch/early epoch cancellation), CONFIG (parameters), POSTER (epochs). Owner retains role administration and pointer/writer/mover/withdrawal powers. The repo says Normies owner is Admin Safe 0xAF8e9BDcF6463EA1f50f8f70ECF13d85a092a1Aa (3-of-5 hardware wallets), Operations Safe 0x94afe25e744aEC9629cB67F63929fA4603898eB7 (3-of-5) has GUARDIAN+CONFIG, and deployer Lifebuoy access is locked. Those are documented governance assertions, not freshly queried Safe settings.

Sources:
- https://github.com/ygtdmn/normies/blob/main/src/NormiesAccess.sol
- https://github.com/ygtdmn/normies#ownership

## Agent binding: precise ownership model

ERC-8004 and ERC-8217 are currently labeled Draft. ERC-8004 provides identity, reputation and validation registries; it does not create an LLM, task loop, payments system, memory or execution wallet. ERC-8217 specifies discovering an external NFT binding: read registry metadata key agent-binding (20-byte address), call bindingOf(agentId) on that address, and inspect {standard, tokenContract, tokenId}. It does not standardize the binding contract's authorization policy. The standard explicitly makes binding-code/upgrade risk part of verification.

Sources:
- https://eips.ethereum.org/EIPS/eip-8004
- https://eips.ethereum.org/EIPS/eip-8217

Adapter8004 registers the identity NFT and remains its owner. The original Normie stays in the user's wallet with no Normie custody or NFT approval needed for registration. A transfer changes controller by reading current Normies.ownerOf(tokenId); it does not transfer the registry NFT. Therefore “no custodian” needs that qualification: no custody of the master Normie, permanent contract custody of the registry identity.

Source: https://adapter8004.xyz/

Official upgrade baseline (last verification in that report: 2026-07-29) says Ethereum proxy 0xde152AfB7db5373F34876E1499fbD893A82dD336 selects implementation 0xa6D23f27D3b1780B12488482a008cB3c3787135f, corresponding to commit a20035c. Adapter Safe admin is 0x03302Df40186D9B85faEA4fbb6cC5da028B23149. Etherscan's cached proxy/implementation pages corroborate that address and ABI, but no fresh Oct 21 slot read was performed. Unreleased main-branch behavior must not be reported as deployed: current baseline says Mainnet lacks delegate.xyz management, bindExisting, primary-agent APIs and newer token standards despite later source/docs showing them.

Source: https://github.com/unruggable-labs/adapter/blob/main/deployments/upgrade-baseline-from-last-deployed.md
Explorer: https://etherscan.io/address/0xde152AfB7db5373F34876E1499fbD893A82dD336#code

In baseline source, only current ERC721 owner controls agent writes. It can setAgentURI, setMetadata / batch, setAgentWallet and unsetAgentWallet. Reserved binding metadata cannot be overwritten by controllers. Registration clears the registry's default wallet (which otherwise would be the adapter). New wallet requires ERC-8004 proof-of-control signature. The owner admin can upgrade UUPS and swap identityRegistry, and rewrite legacy binding metadata into canonical format. Current code offers no per-agent unbind or arbitrary binding reassignment; upgrade governance remains authoritative. Repointing the registry changes forwarded calls and does not migrate old identities.

Source: https://github.com/unruggable-labs/adapter/blob/a20035c/src/Adapter8004.sol

Inference for runtime designers: transferring the master Normie transfers controller rights but does not automatically transfer external keys, cloud sessions, model credits, database memory or permissions. Registry wallet-clearing-on-transfer cannot be assumed here: the registry NFT stays adapter-owned, so a master NFT transfer does not invoke the registry's NFT transfer hook. Recheck/reset agentWallet and revoke old runtime credentials explicitly in any execution integration. No evidence inspected establishes a memory/key handover mechanism.

## What exists and what does not

Official Agentic docs explicitly mark awakening, deterministic personas/system prompts, live metadata, A2A Agent Card and registry as implemented. They explicitly say the advertised /agents/a2a/:tokenId route does not exist, no LLM is wired in, MCP is coming_soon, and reputation/validation registries are not yet read/written. Agent wallet delegation is not in the UI. Arena is described as a work in progress / coming soon; do not report the autonomous game as shipped.

Source: https://www.normies.art/docs/agentic

Actual agent API source sets active:true and x402Support:false and advertises web + A2A card URLs. /info returns interactions.status and mcp.status = coming_soon. Thus active:true denotes published identity metadata, not verified operational conversational availability. Routes render persona text dynamically; a declared service URL does not prove transport availability.

Source: https://github.com/ygtdmn/normies/blob/main/api-server/src/routes/agents.ts

Personas are generated in TypeScript from token traits and live Canvas state, with transformation history fetched from required Ponder indexer. Diff enrichment can fail softly. The pure generator uses seeded templates, not an LLM. “Sealed name and type” is the product's deterministic stability guarantee for stable input traits, not storage of the complete persona text in an immutable contract. Original trait setters and server code remain independent trust boundaries.

Sources:
- https://github.com/ygtdmn/normies/blob/main/api-server/src/services/persona-live.ts
- https://github.com/ygtdmn/normies/blob/main/api-server/src/lib/persona.ts
- https://github.com/ygtdmn/normies/blob/main/api-server/src/services/ponder-data.ts

## Ethereum address map

Addresses below are published by the project's technical docs. No fresh code hash/owner read was performed.

| Component | Address |
|---|---|
| Normies ERC721C | 0x9Eb6E2025B64f340691e424b7fe7022fFDE12438 |
| Original storage | 0x1B976bAf51cF51F0e369C070d47FBc47A706e602 |
| Renderer V1 | 0xBe57fC4D0c729b8e8d33b638Dd441F57365e4c25 |
| Renderer V2 | 0x7818f24d3239c945510e0a1a523dd9971812c6c0 |
| Renderer V3 | 0x1af01b902256d77cf9499a14ef4e494897380b05 |
| Renderer V4 | 0x8eC46Cc1f306652868a4dfbAAae87CBa2715A0eB |
| Renderer V5 | 0x7c726f02C5e840e1656b522A5C22caaf87C1C35C |
| Renderer V6 | 0xd6747533697878a6a3a29B5cCf815740BA23998D |
| Minter V1 | 0xC74994dD70FFb621CC514cE18a4F6F52124e296d |
| Minter V2 | 0xc513272597d3022D77b3d7EEBA92cea5D7fb2808 |
| Original Canvas | 0x64951d92e345C50381267380e2975f66810E869c |
| Original Canvas storage | 0xC255BE0983776BAB027a156681b6925cde47B2D1 |
| Canvas V2 | 0xF14f2852e1fD6A4108156054AF49B3915dc40E2e |
| Canvas storage V2 | 0x96F2DA32Bb9D429d59ac13dB469f4950cBe02084 |
| PixelMarket | 0x86156A8d6e4B9925F7fEca527ea5D71B0deeDB64 |
| RevenuePool | 0x481384812e79bf0d11FC0b1704af445D5F06813c |
| RoyaltySplitter | 0xA68A225f62772E6158f2B5f8afC184AdB69c3282 |
| Zombie | 0x18533ad55a54c3847Da06A48b51aD7DcB2551202 |
| Zombie storage | 0xA331bD22C90D1DA096934Db8bc6b69F0e1491E26 |
| Legendary Canvas registry | 0xfA55f6592522dA74224a67c7D3Fd1DF759c628e8 |
| Adapter8004 proxy | 0xde152AfB7db5373F34876E1499fbD893A82dD336 |
| ERC-8004 IdentityRegistry | 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 |
| delegate.xyz V2 | 0x00000000000000447e69651d841bD8D104Bed493 |
| delegate.xyz V1 | 0x00000000000076A84feF008CDAbe6409d2FE638B |

Address sources: https://www.normies.art/docs/technical and https://adapter8004.xyz/

Project README says Pixel Market stack deployed block 26,122,420 and went live 2026-10-05, with October Trislit review/fix review. That is the project's dated deployment/security assertion; no independent full audit assessment was performed. Report: https://github.com/ygtdmn/normies/blob/main/audits/2026-10-03-trislit-pixel-market.pdf
