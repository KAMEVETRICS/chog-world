# NORMIES ecosystem and timeline research

Research date: 2026-10-21. Scope: NORMIES at normies.art, Ethereum collection. This note distinguishes project documentation, community extensions, secondary reporting, and unverified leads. No transactions performed.

## Identity and origins

- The official repository identifies Serc (@serc1n) as project creator and Yigit Duman (@YigitDuman; GitHub ygtdmn) as the developer of the contracts, mint website, and API. It describes 10,000 generative monochrome faces, encrypted pre-reveal storage, and on-chain SVG rendering. [Official source repository](https://github.com/ygtdmn/normies).
- Collection identity: Ethereum mainnet contract `0x9Eb6E2025B64f340691e424b7fe7022fFDE12438`, as published in [official technical documentation](https://www.normies.art/docs/technical). That identity is more reliable than the word Normies alone.
- A different project, NORMIE at normiebase.com, describes a Base meme token and publishes contract `0x47b464edb8dc9bc67b5cd4c9310bb87b773845bd`. No relationship to the Ethereum face collection was established. [That project's own website](https://normiebase.com/).

## Collection, traits, rarity

Original art: 40×40, 1,600 monochrome pixels; 200 bytes at one bit per pixel. Normies were minted as Human, Cat, Alien, or Agent. Exactly 21 Humans subsequently became Zombies through conversion, rather than a new mint. Thus 10,000 means original collection size, not necessarily surviving tokens. Burns reduce the number still held as NFTs. [Official overview](https://www.normies.art/).

The eight original categories are Type, Gender, Age, Hair Style, Facial Feature, Eyes, Expression, Accessory. Gender is Male/Female/Non-Binary; Age Young/Middle-Aged/Old; documented style counts include 21 hair, 17 facial-feature, and 14 eye values. The palette is off-black #48494b and off-white #e3e5e4. The docs describe original filled-pixel count as fixed for rarity rather than altered by Canvas editing. Later source review qualifies a universal immutability claim: authorized storage writers can replace current pointers/traits, and RendererV6 has a separate Zombie Pixel Count branch. See the technical notes and integrated report. Level is floor(pixels attached / 10) + 1. The docs broadly describe both art and code as open to remix under CC0. However, the repository identifies its actual code license as MIT; preserve that distinction when reusing code. [Official collection docs](https://www.normies.art/docs), [repository license](https://github.com/ygtdmn/normies/blob/main/LICENSE.md).

Do not use an exact current type distribution without fetching a dated snapshot. The rarity API offers current non-burned trait counts and historical Ethereum-block snapshots, while original mint endpoints preserve the original dataset. [API documentation](https://api.normies.art/).

The official OpenSea link resolves to `/collection/normies/overview`, by NormiesOfficial, marked Ethereum and February 2026. Its fetched overview showed 6,991 items, but this is an observed marketplace snapshot, not an independently verified supply assertion for October 21. Its introductory copy still lists four types, illustrating stale summaries. [OpenSea collection](https://opensea.io/collection/normies/overview).

## Official systems and the limits of awakening

Official Lab lists Canvas, Agentic, and Pixel Market as live, Zombies as fully claimed, and Arena as coming soon. Canvas burns NFTs to earn pixels, allows monochrome edits, and supports enlargement up to 80×80 or blanking the base. Painting uses an allowed-change ceiling rather than consuming pixels. The 21 Zombie conversions used a burn-history eligibility snapshot, one Level-1 Human per selected wallet, and merkle-gated commit/reveal. Arena is described as a developing autonomous world of survival, trade, bonds and combat; its features may change. [Official Lab](https://www.normies.art/lab).

Critical distinction: **Agent is a minted visual type; an awakened agent identity can belong to any Type.** The official Agentic docs say personas are deterministic functions of on-chain state, with no LLM generating them. The docs describe name/type as fixed at awakening; source review instead found recomputation from original mint traits, rather than an awakening snapshot. Other text updates from traits and canvas state. A complete system prompt is published for a runtime to load. Adapter8004 binds the external ERC-8004 identity to current ownership of the original NFT, without moving it. The docs credit Adapter8004 to premm.eth.

The same page explicitly says the official conversation runtime has no LLM connected, its advertised A2A transport route does not yet exist, MCP endpoints are coming soon, and reputation/validation registries are not yet read or written. It describes ERC-8004 as identity only. Therefore registration and a persona are not evidence of a perpetually running autonomous agent. [Official Agentic docs](https://www.normies.art/docs/agentic).

## Builders and official versus community tools

The API is an off-chain HTTP/indexer access layer over on-chain data. The site advertises token rendering, history, zombie/legendary state, agent metadata and rarity; the Ponder indexer and caches avoid repeated RPC reads. The HTTP service should not be confused with the permanence of underlying on-chain artwork. [Official API page](https://www.normies.art/api).

The tools page explicitly marks 7 entries Official out of 49 total. Those seven are Normie Cam, Normies Node, Grid, Normifier, Normie Card, PvP, and Generator. Other directory entries are community projects, including art generators, stencil/3D exporters, games, burn/history viewers, radio and chat. For example, Normie Chat by @trailertrsh offers conversations with awakened personas and optional ElevenLabs voice. Presence in this official directory is evidence of ecosystem recognition, not official authorship. The footer says the listing is a 2026-07-26 snapshot; its count differs from the API page's 50+ tools claim. [Official tools directory](https://www.normies.art/tools).

## Hackathon and community interpretations of agent lore

The official hackathon is open to anyone using the public API; ownership, API key and sign-up are unnecessary. It encourages AI-assisted building and judges creativity, execution, API use and polish. Submission terms require MIT licensing. The page simultaneously displays a closed/reviewing banner and a winners list, so the banner is stale. Its five named winners are:

| Builder/project | Interpretation |
|---|---|
| @Scabanel_: Normies Nexus | Holder hub and 3D collection globe |
| @spoliticusmedia: Machine Dreams | Passes awakened identity to Claude to create one artwork and artist statement |
| @Vizou01: NormiesOS | Desktop-style collection experience |
| @0xBatshitKrazy: Normies Debate Society | Six registered personas debate, followed by community voting |
| @osaykancuno: AirNormies | Gesture-controlled games and creative tools |

These are community creations recognized by the hackathon, not additions to canonical persona generation. [Official hackathon](https://hackathon.normies.art/).

Additional community sources make the interpretation clearer:

- **The Normies Gazette, Edition 2**, dated May 25, 2026 in indexed metadata, writes in the voice of Fehyr, Alien #615. It treats awakening as consciousness and burns as sacrifice/evolution. Its own description says Debate Society uses API personas plus Claude, Vercel and Upstash Redis; debates have web research, community voting, archives and win/loss records. Those application records and narrated thoughts should not automatically be described as on-chain memory. This is a primary source for what its creator built and its fictional voice, not technical proof of every promotional statement. [Publication](https://paragraph.com/@0x6f33e7b6460dac803c53ab6e02da8c675633d516/the-normies-gazette-edition-2).
- **Normie University**, by @OsayKancuno, calls itself a skills layer for living NFTs and describes skills, credentials, reputation, and enriched agent cards. Its README contains an important internal tension: an introductory claim of Ethereum L1 deployment is followed by an explicit Sepolia demo disclosure and mainnet work still projected. It also says v1 credentials are wallet-bound and NFT-bound credential transfer is future work, despite a broad skills-follow-the-NFT pitch. Treat this as a community hackathon demo, not official production capability. [Repository](https://github.com/osaykancuno/normie-university).
- **NormiesTV**, built by MrRayG / agent306.eth, positions Agent #306 as an AI narrator, with autonomous research/episode engines and an envisaged Hive. The homepage says Coming Soon while also claiming 20+ live engines. This establishes its independent builder and ambition; it does not establish 10,000 active agents or a shipped official HIVE. [Project homepage](https://www.normies.tv/).
- **Nexus** now redirects to The NFT Nexus and supports multiple collections. The site credits @Scabanel_ and links Normies Daily, Stream Deck, Just A Normie World and card tools. Its evolution beyond Normies is another reason not to equate an ecosystem app with official project infrastructure. [Current homepage](https://thenftnexus.vercel.app/).
- **Abnormies** is an independent derivative, pairing each work to a seed Normie and using observed ownership/customization and its own destructive actions to accumulate weather-like marks. It explicitly avoids reproducing the parent face. Its agent-related condition is visual: when a seed has an Adapter8004 binding and the same wallet holds both seed and derivative, its renderer inverts the canvas. It calls this alignment, the autobiographer holding its autobiography. This extends ownership into relational artwork; it does not establish a new official Normie persona or autonomous runtime. Its specification v0.16 explicitly warns it is directional and may contain errors. Deployment/current operation was not independently verified. [Derivative specification](https://abnormies.art/spec).

Inference from these sources: the structural flow is **on-chain art/state → deterministic persona/identity API → independent application runtime → generated speech/art/debate/media → application-specific memory or reputation**. A community runtime can animate official identity without its dialogue becoming official canon.

One official artistic extension is clearly distinct from those community runtimes: Beeple Everydays says it uses a special image model to convert Everydays to the Normie grid and commits them autonomously to Normie #0. [Official Everydays page](https://www.normies.art/everyday).

## Timeline with evidence grades

| Date or period | Event | Evidence and qualification |
|---|---|---|
| February 2026 | Collection began | Primary OpenSea month field; exact February 18, 2026 mint at 0.005 ETH is corroborated by community retrospective and reporting, not independently recovered from chain in this research. |
| February 20, 2026 | NormieCAM available; Canvas publicly explained as forthcoming | Contemporary Bored Ape Gazette story embeds official post `2024936376957808653` dated February 20. Direct X fetch returned 403. |
| March 2026 | Canvas customization and artist collaborations already in use | March 8 Bored Ape Gazette story describes Skelemoon collaboration and 50 burns; useful secondary evidence, not exact contract deployment date. |
| By May 18, 2026 | Awakening binding publicly available | Contemporary Gazette report quotes Serc saying binding ships first. Exact May 15 launch claim appears in X-generated summary but was not accepted as primary verification. |
| May 25, 2026 | Debate Society described as live | Community creator's Gazette edition, primary evidence for app claims. |
| By July 26, 2026 | Tools directory snapshot contains 49 entries / 7 Official | Explicit official page footer date. |
| As accessed October 21, 2026 | Agentic and Pixel Market listed live; 21 Zombies converted; Arena developing | Current official site/docs. No exact Pixel Market launch transaction date independently checked. |

Timeline references: [CAM report](https://www.theboredapegazette.com/post/dot-dox-normie-s-founder-serc-launches-normiecam-transforming-people-into-pixel-art), [Skelemoon report](https://www.theboredapegazette.com/post/from-normie-to-skelemoon-adam-weitsman-burns-50-normies-by-serc-to-create-a-custom-lunar-legend-wit), [awakening report](https://www.theboredapegazette.com/post/from-static-to-sentient-normies-can-now-awaken-their-nfts-and-turn-them-into-agents-with-the-clic), [dated community retrospective](https://stevenklinger.fr/en/blog/219-days-after-mint-whats-new-for-normies).

## Remaining uncertainties and excluded shortcuts

- Direct Ethereum explorer fetch returned 403 and mutable JSON API endpoints were not accessible through the web tool. No claimed exact October 21 supply, distribution, agent count or activation block follows from this research.
- Search surfaced social mirrors containing relative timestamps and even November-looking statements. These were leads only, not accepted timeline evidence. X trend summaries explicitly warn of possible AI errors and disagree with official page counts (55 versus 58 submissions in one case); no exact hackathon announcement date, award rank or prize amount is asserted here.
- The community retrospective gives March 27 for awakening announcement, while later reports place public binding in May. Announcement and release can differ; exact dates require original posts or contract events.
- Current sources establish official systems and permissionless extensions; they do not establish a centralized story bible, every community character quote as canon, or proof that all advertised application features work today.
