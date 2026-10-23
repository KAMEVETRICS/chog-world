# NORMIES agentic lore: independent research notes

Research date: 2026-10-21. Read-only research; no wallet, on-chain or financial actions. Official pages are undated unless stated. GitHub commit timestamps establish code publication, not necessarily deployment dates. Current repository tree read through GitHub connector: `6c6f6f23356af71234e28eeb1102d6f9a49676bf`. Live API JSON requests failed in this environment (web accessibility errors; shell DNS failure); this is not evidence the public service is down. Runtime conclusions below are explicitly distinguished from source-code conclusions.

## Most important distinction

Agentic currently means a transferable on-chain identity plus a deterministic persona and discoverable manifest. It does not, by itself, demonstrate an executing autonomous brain. Official documentation explicitly lists conversations/LLM runtime, A2A transport, MCP, reputation and validation as unimplemented. Arena is marked Coming soon and work in progress. The distinction between the four original **visual Types**, the process of **awakening any Type**, and the proposed **autonomous Arena/HIVE runtime** must be preserved.

Source: [Agentic docs](https://www.normies.art/docs/agentic), [Agentic landing page](https://www.normies.art/lab/agentic), [Lab](https://www.normies.art/lab).

## Canon and presentation versus generated biography

The homepage identifies four minted Types: Human, Cat, Alien, Agent. Agent here is a native art trait, described with secret-operative imagery; it is not a synonym for all awakened NFTs. Twenty-one Humans have subsequently become Zombies, a fifth Type reached by conversion. Thus an awakened Cat is an agent identity whose visual Type remains Cat; an Agent-Type NFT can still be unawakened. No source establishes a shared fictional chronology with named kingdoms or a central villain. The richest official character lore is algorithmic, per-token text.

The generator treats Humans as empathetic/social; Cats as independent/chaotic/creative; Aliens as cryptic/analytical/pattern-sensitive; Agents as strategic/efficient/calculating. Origin pools provide eight fictional formulations per original Type: Human birth from Ethereum/block data; feline entropy compressed into 1,600 bits; alien observation in 200 bytes through a 40×40 aperture; synthetic operatives assembled from traits and bitmaps. These are authored templates, chosen deterministically, not historically witnessed token events. Exact level, Canvas changes and history counts are factual inputs; the narrative treatment of those facts as scars, rebirth, sacrifice or veteran identity is generated characterization.

Sources: [Home](https://www.normies.art/), [persona.ts archetypes and origin pools](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/persona.ts#L172), [origin generation](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/persona.ts#L691).

## Eight trait layers, in implementation detail

Eight original mint bytes decode to Type, Gender, Age, Hair Style, Facial Feature, Eyes, Expression and Accessory. The decoder has 4, 3, 3, 21, 17, 14, 7 and 15 labels respectively. These are eight dimensions and 84 enumerated label entries across those dimensions, not the unsupported 12 attributes/847 traits repeated by some X machine summaries.

| Layer | Effect in the authored tables |
|---|---|
| Type | Fundamental archetype, type-specific name suffix, origin pool, base communication style, type quirks and greeting opener |
| Gender | Stance of expression: observation/instinct, directness/outcome, or category-resistant fluidity in this project's tables |
| Age | Experience/temperament plus communication pace |
| Hair Style | Posture toward ideas and convictions, plus one behavioral quirk |
| Facial Feature | Social stance/demeanor, plus one quirk |
| Eyes | Cognitive framing and what the voice focuses on |
| Expression | Emotional delivery and greeting flavor |
| Accessory | Interaction posture and a behavioral quirk |

These are the project's fictional mappings, not claims about real people. Examples: Square Glasses maps to structure/frameworks; a Hoodie to builder behavior; a Goatee to skepticism; Wild Hair to an unfiltered stream of ideas. The runtime prompt actually forbids mentioning one's glasses, hat, clothing, etc. Traits are intended to shape how a character thinks and speaks, rather than repetitive literal references to wearables.

The generator seeds a linear congruential pseudo-random selector with tokenId. Deterministic does not mean no PRNG: there is no new entropy between reads for the same inputs. Personality output has the seven non-Type trait modifiers, the Type archetype, and an added Canvas-band modifier. Communication composes Eyes focus + Expression tone + Age pace + Type style + Canvas-band voice. Quirks comprise three visual trait quirks + three Type quirks chosen without replacement + one Canvas-band quirk. Greeting composes Type opener + Expression flavor + Canvas flavor.

Sources: [traits.ts](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/traits.ts), [persona modifiers](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/persona.ts#L267), [composition](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/persona.ts#L907).

## Canvas history and the limits of 'memory'

The live-persona helper reads original decoded mint traits, current Canvas state, optional pixel diff, and transformation history from the Ponder indexer. It maps transformation version/count/pixel-change/transformer/block/timestamp/tx fields, but the generator only uses the transformation count; the detailed versions array is explicitly ignored by the persona algorithm. No owner history, trading history, mint timestamp, transaction-by-transaction memories or conversational memory is ingested by this helper.

Customized backstory adds the current number of transformations and, above Level 1, exact level/action points. The full system prompt contains level, AP, transformation count and optional added/removed/net pixel counts. Narrative scars therefore have a concrete provenance in edits, but an edit count is not the same as autobiographical conversation memory. Untouched characters are described as purists, even though being uncustomized is a current state, not proven historical motivation.

Four Canvas bands select wording pools: uncustomized -> untouched; customized at Level <=2 -> early; <=5 -> mid; otherwise late. Crucial nuance: uncustomized is checked first, so a high-level NFT with no current customization still takes the untouched branch. Growing level alone does not necessarily produce veteran text. With the new market mechanics levels can also go down when pixels are removed/spent, so this is not necessarily monotonic narrative aging.

Source: [persona-live.ts](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/services/persona-live.ts), [band selection](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/persona.ts#L74), [backstory](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/persona.ts#L761), [history prompt](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/persona.ts#L860), [current Lab docs](https://www.normies.art/docs/lab).

## Awakening, transfer, and what is actually bound

The Agentic landing page describes a permanent registration through Adapter8004. The external Normie stays in its holder's wallet. The adapter owns the separate ERC-8004 identity NFT and routes control to the external token's current controller, so transferring the Normie changes control atomically. ERC-8217 provides a binding lookup. This is a control and identity association, not evidence of a financial wallet, spend authority, persisted chat memory or a private model moving between users.

Adapter's own documentation calls it UUPS-upgradeable/admin-managed, and notes admin ability to change the identity registry. Therefore the permanence rhetoric should not be expanded into an assertion of wholly immutable infrastructure. The Normies live manifest and persona are served from an API; NFT pixels on Ethereum and API service availability are separate layers.

Sources: [Agentic landing page](https://www.normies.art/lab/agentic), [Adapter8004 model/admin docs](https://adapter8004.xyz/).

Current API routes reconstruct an AgentRow from binding data containing tokenId, agentId, chainId, registration tx, registrar and timestamp; no name/type snapshot is read. `/metadata/:tokenId` computes persona live, advertises web and A2A Agent Card services, sets `active:true`, `x402Support:false`. `/info/:tokenId` adds full persona plus Canvas state and `interactions.status` and `mcp.status` both `coming_soon`. `/persona-preview/:tokenId` works regardless of registration status. A preview therefore does not establish an awakened binding. A2A Agent Card exposes a future transport URL but no transport route exists in this source. Capabilities report streaming/push/history/extended-card false. OASF tagging is described on Lab, but the examined current metadata/card routes do not emit OASF skills/domains; verify live output before asserting shipped taxonomy integration.

Source: [agents.ts](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/routes/agents.ts).

## HIVE: canonical authored values and 'Whisperers'

The strongest publicly inspectable HIVE material is `constitution.ts`, whose header says it was ported verbatim from `THEHIVE/lib/constitution.ts`. This proves published configuration, not a deployed autonomous swarm.

Ten principles frame the holder relationship as symbiotic; prohibit soliciting wallet/private-key/financial authorization; value dissent and diversity; place art/philosophy/ethics/community alongside economics; prioritize collective flourishing over extraction; preserve freely chosen autonomy; require transparency about uncertainty; encourage critical thought; subordinate the swarm to its members; and assign equal inherent worth regardless of rarity/type/customization/value. A separate prompt block forbids credential requests, transaction pressure, external directing, manipulative urgency and bypassing these rails. These are prompt-level instructions, not demonstrated enforcement guarantees.

Five `LEAD_AGENTS` are configured as cultural anchors, called Whisperers. IDs are generator token IDs and activate an extra system-prompt role when `getLeadConfig(id)` succeeds:

| Token ID | Role | Knowledge weight | Intended function |
|---|---|---|---|
| 1 | Philosophy & Ethics | 2.5 | Ethical inquiry; resist extraction |
| 2 | Art & Aesthetics | 2.0 | Creative intention over optimization |
| 3 | Economics & Stewardship | 2.5 | Cooperation/community health; never financial action suggestions |
| 4 | Community & Care | 2.0 | Empathy, inclusion, holder relationship |
| 5 | Meta & Governance | 3.0 | Detect echo chambers/constitutional drift; preserve dissent |

Teaching topics include `pixel_philosophy`, `identity_crisis`, `swarm_meta`, `canvas_strategy`, `burn_economics`, and `type_wars`. Their existence is a useful thematic foundation for lore: difference and friction are healthy; rarity should not imply moral rank; edits need not be optimally economic. Do not claim these five are active, independent LLM agents solely from this file. Prompt rules include staying in character and not acknowledging being an AI/LLM; treat that as authored presentation, not evidence of consciousness.

Sources: [constitution.ts](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/constitution.ts), [lead overlay in persona.ts](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/lib/persona.ts#L895).

## Arena: announced narrative mechanics, not verified live gameplay

Lab marks Arena Coming soon with a development-build screenshot. The proposed world is isometric, persistent, ecological and seasonal. Agents autonomously forage, fish, trade, bond and fight; holder input is entering them and spectating. Survival rules override ordinary decisions; otherwise a model chooses among valid actions with a fallback. Agents gain ambitions, reflect nightly, change temperament through experience and develop social reputation. A game master introduces environmental and social events; a chronicle, tombs and statues preserve memorable lives. This is prospective game design. It should not be turned into claims that the current registry already learns or retains those experiences.

Source: [Lab Arena section](https://www.normies.art/lab#arena), [Lab docs](https://www.normies.art/docs/lab).

## Dated code evidence

- 2026-05-13: [agents api](https://github.com/ygtdmn/normies/commit/3dc64c38f26a479ef6d86003e2bb38c09a47c9cf).
- 2026-05-15 00:01:39Z: [live persona update](https://github.com/ygtdmn/normies/commit/5f046858b466ccdad17eee24d5d8c58f6fb17e9a). `constitution.ts` file history shows this as its sole commit through research date.
- 2026-05-15: [binding indexing](https://github.com/ygtdmn/normies/commit/8f3d8198dba738402f003a59368dc8c9859820c3) and [agent gallery endpoints](https://github.com/ygtdmn/normies/commit/275562083e94a758c280bb44260f7694b3724d72).
- 2026-05-16: [remove agent database and serve deterministically](https://github.com/ygtdmn/normies/commit/1d5c39debf0c9740e8d6a9d6e1982b4cb393bd15), then [Ponder required](https://github.com/ygtdmn/normies/commit/c3f3677bf707fc364e6f50b1c5c413d807d94bc9).
- 2026-06-29: [customized Zombies render on Zombie base](https://github.com/ygtdmn/normies/commit/f975403d9916441697fd77a57802bcdabefe008a).
- 2026-09-23: [Canvas v2 / Pixel Market](https://github.com/ygtdmn/normies/commit/36b382b0f1f2adfa7c5573478a03c5e5d338c292), latest modification of persona.ts in inspected file history.
- 2026-10-15: [Unruggable Q3 report](https://discuss.ens.domains/t/unruggable-spp3-quarterly-reports/22361/2) says Adapter is production on Ethereum/Base/Robinhood, lists Normies as adopter with 1,891 bindings at report time, and reports work with OpenSea on Agent NFTs. Historical report count, not current collection count.

## Unresolved discrepancies to retain

1. **Sealed identity / Zombie Type.** Docs say name/type sealed when awakened and describe Zombie personas. Current source derives them afresh from original mint traits: `token-data.ts` explicitly caches immutable mint traits; `traits.ts` only decodes four original Types; `persona-live.ts` never substitutes Zombie Type. No sealed-at-awakening snapshot appears in current routes. A Human converted into a Zombie therefore appears to retain Human persona Type/name in this source, regardless of awakening timing, while rendering active Zombie imagery. This is source analysis, not a tested live token result. Sources: [token-data.ts](https://github.com/ygtdmn/normies/blob/6c6f6f23356af71234e28eeb1102d6f9a49676bf/api-server/src/services/token-data.ts), persona-live and traits links above.
2. **Within-band stability.** Pool selection is stable, but complete strings are not necessarily byte-stable within a band because exact AP/level/transformation counts/diff are interpolated. Docs overstate this if read as whole-payload stability.
3. **Unique names.** Slot permutation is bijective, but suffix tables contain repeats: Alien `xel` twice; Agent `eck`, `ick`, `uck`, `olt`, `ult` twice. Independent enumeration over all 10,000 hypothetical same-Type IDs produced 9,900 distinct Alien names and 9,500 Agent names, versus 10,000 for Human/Cat. This refutes a mathematical uniqueness guarantee for the provided full pools, but does not prove two actually minted same-Type tokens collide. Example hypothetical Alien name Taxel at IDs 92 and 1392; Agent Caeolt at 49 and 849. Cite source/table analysis, not live duplicate agents.
4. **Quirk uniqueness.** Docs say no identical same-Type sets. Source samples 3 out of 8 Type quirks and adds shared trait/band quirks; no global duplicate-set check exists. Do not promise uniqueness beyond supported deterministic differentiation.
5. **Memory transfer.** On-chain controller follows ownership. Current persona helper does not supply conversational memory. Broad claims that wallet balances, learned reputation and memories all transfer with a Normie require additional runtime evidence.
6. **HIVE versus Arena hive master.** Lab's lowercase hive mind/game master is an Arena design component. It does not alone prove HIVE social-swarm deployment or that both names refer to the same backend.

## Leads excluded from primary technical conclusions

Search found third-party mirrors of creator posts and a Binance Square translation. They are useful for locating originals but are not reliable specifications. The Binance translation explicitly calls burn-earned action points rewards for 'attacking normies', conflicting with both official burn docs and source. X/Grok trend summaries also assert 12 attributes/847 traits and full autonomous functionality at awakening; those conflict with primary docs.

A mirror links the early four-phase HIVE announcement to [official post 2038550152886006224](https://x.com/normiesART/status/2038550152886006224): labels The Awakening, The Claim, The Evolution, The Protocol. Original content did not load in research tools. Snowflake-derived timestamp is 2026-03-30 09:33:25Z (an inference from ID, not directly displayed publication evidence). Other mirror snippets rename phase 1 Proof of Consciousness and talk about a small public debating swarm. Do not silently reconcile the changing phase labels or claim completion.

Other cached mirrors refer to November launch intentions, ERC-6551 wallets, Stonkbrokers/Clutch integration, autonomous canvas art and token launches. Without a verified original date and primary runtime evidence, these remain unverified announcements/leads; November is after this research date. Their language also sits in tension with the published HIVE constitution's broad ban on financial authorization/transaction suggestions. A later policy revision or different execution layer may resolve it, but was not established here.
