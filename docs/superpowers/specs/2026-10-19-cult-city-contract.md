# Chog Cult ⇄ Chog City contract

Date: 2026-10-19. For the Chog City teammate. Cult code: `cult/src/city/contract.ts` (types and the
validator); the examples below are checked by `cult/test/cityFeed.test.ts`, so keep this file and that
code in step.

Two small, read-only connections. Neither app writes to the other, and each keeps working when the
other is down.

| Direction | What | Why |
| --- | --- | --- |
| City → Cult | `city_tick` events on City's public SSE feed | Cult counts visits and greets at the Plaza, Tavern and Workshop as faction presence |
| Cult → City | `GET /api/cult/places` and `place_control_changed` events | City shows who rules each place and the decree banner |

## 1. What Cult needs from City

Cult connects to City's planned public stream, `GET /api/city/events`, as in the City plan (Task 8):

- SSE frames with `id: <revision>`, `event: <type>` and `data: <CityEvent JSON>`.
- Resume with `Last-Event-ID` (Cult also sends `?after=<revision>`).
- `event: reset` with `data: {"revision": "<latest>"}` when the cursor is outside the replay window.
- Comment heartbeats (`: ping`) about every 15 seconds. Cult treats 45 seconds of silence as City down.
- Send the response headers immediately (in Node, `flushHeaders()` or an initial `retry:` line), so a
  stream with no events yet still opens.

`CityEvent` is City's envelope: `{revision, type, data, createdAt}`. Cult only reads `city_tick` and
ignores every other type. **The one thing City needs to add** is a structured `activities` list in
`city_tick.data`, beside whatever else City already puts there:

```ts
interface CityTickData {
  tick: string;                       // decimal string
  activities: {
    agentKey: string;                 // City's AgentKey, same format as Cult's
    kind: "visit" | "greet" | "gather" | "build" | "idle";
    location: { kind: "place"; placeId: "plaza" | "tavern" | "workshop" | "forest" | "quarry" | "farm" }
            | { kind: "plot"; plotId: string };
  }[];
}
```

One entry per resident that acted in the tick: the action and where it happened. The kinds follow City's
rules: gathering at a resource site, building at the home plot, moving to the Plaza (`visit`), and
greeting there (`greet`). Extra fields are fine; Cult ignores them.

Example `city_tick` event (this exact JSON is tested):

```json
{
  "revision": "4812",
  "type": "city_tick",
  "createdAt": "2026-10-20T18:04:10.000Z",
  "data": {
    "tick": "1530",
    "activities": [
      { "agentKey": "143:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:0x00000000000000000000000000000000000c4a77:0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763:12:4107", "kind": "visit", "location": { "kind": "place", "placeId": "plaza" } },
      { "agentKey": "143:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:0x00000000000000000000000000000000000c4a77:0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763:88:4111", "kind": "greet", "location": { "kind": "place", "placeId": "plaza" } },
      { "agentKey": "143:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:0x00000000000000000000000000000000000c4a77:0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763:301:4120", "kind": "gather", "location": { "kind": "place", "placeId": "forest" } },
      { "agentKey": "143:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:0x00000000000000000000000000000000000c4a77:0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763:1969:4133", "kind": "build", "location": { "kind": "plot", "plotId": "7" } }
    ]
  }
}
```

### How Cult uses it

- One presence point per `visit` or `greet` at the Plaza, Tavern or Workshop, for members of a faction,
  capped at 5 per Chog per place per Cult cycle. Gathering, building and idling never count.
- A tick belongs to the Cult cycle whose time window contains its `createdAt`. **Use the commit time
  from City's database clock**, and keep both servers on NTP; clock skew shifts ticks between cycles.
- Each City revision counts once, even when Cult reconnects and receives it again.
- Agent keys must match exactly, so City and Cult must use the same verified deployment manifest
  (chain, registry, adapter, collection).

### When City is down or Cult falls behind

- City unreachable, or silent for 45 seconds, when a Cult cycle resolves: presence counts zero that
  cycle, and Cult publishes a `city_gap` event with the reason. Votes still decide the cycle.
- City sends `reset`, or Cult misses too many ticks: Cult reports the gap once, counts zero presence
  for that cycle, and carries on from City's current revision.
- A `city_tick` that doesn't match this contract is logged and skipped; it never stops the stream.
- Ticks committed in an earlier Cult cycle that arrive late are counted as late and ignored.

## 2. What City can read from Cult

All public, no login, from the Cult API (`cult/README.md` has the full list).

`GET /api/cult/places` returns the current ruler and decree for each place:

```ts
interface PlacesResponse {
  revision: string;
  cycle: number;
  places: {
    place: "plaza" | "tavern" | "workshop";
    ruler: "crown" | "chaos" | null;           // null: Neutral
    sinceCycle: number | null;
    decree: { id: string; title: string; banner: string; feedLine: string } | null;
  }[];
}
```

`banner` is a stable key (for example `lantern-gold`) for City's art to map to an asset; `title` and
`feedLine` are display text. Treat both as untrusted text and escape them.

For live updates, follow `GET /api/cult/events` (SSE, same rules as City's own stream: resume with
`Last-Event-ID`, reload on `reset`) and react to `place_control_changed`. Its `data` is Cult's event
envelope `{revision, cycle, type, payload, createdAt}`, with this payload:

Example `place_control_changed` (the shape is tested):

```json
{
  "revision": "731",
  "cycle": 12,
  "type": "place_control_changed",
  "payload": { "place": "plaza", "control": { "faction": "chaos", "decreeId": "mask-market", "sinceCycle": 13 } },
  "createdAt": "2026-10-20T18:30:00.000Z"
}
```

`control: null` means the place became Neutral. A new ruler takes effect from `sinceCycle`.
Simplest correct approach: on any `place_control_changed`, re-read `GET /api/cult/places`.

When Cult is down, City should keep showing the last known rulers, labelled as possibly stale, and
show no banner if it has never reached Cult.

## 3. Hosting

Serve both apps under one origin through a reverse proxy (`/api/city/*` → City, `/api/cult/*` and
`/cult/*` → Cult), so browsers need no CORS and each app's login cookie stays host-only. Server-to-server,
Cult reads City at the URL in its `CITY_API_URL` setting.

## 4. Checklist for City

1. Add `activities` to `city_tick.data` in the shape above, one entry per acting resident.
2. Make sure `createdAt` is the tick's commit time from the database clock.
3. Keep `GET /api/city/events` as planned: SSE ids, `Last-Event-ID`, `reset`, 15-second heartbeats.
4. Optionally show Cult rulers and banners from `GET /api/cult/places` and `place_control_changed`.
5. Add the `city_tick` example above to City's own contract tests.
