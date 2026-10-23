// The village scene. Renders committed world state only; walking is a CSS transition between
// committed positions, never a client-side prediction.
import { memo, useMemo } from 'react';
import type { AgentState, Location, Place, Plot, WorldState } from '../../shared/contracts';
import { recipeForLevel } from '../../shared/rules';
import { FACTION_SHORT, type FactionId, type Rulers } from '../cult/rulers';
import { activityOf } from '../format';
import { standings } from './positions';
import { ChogFigure, GlyphPath, Home, Lot, Mailbox, PlaceArt, Ruins, Scaffold, scarfFor } from './art';

const CELL = 64;
const at = (x: number, y: number) => ({ x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 });

/** Deterministic pseudo-random in [0,1) from integers, for scenery placement. */
function noise(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A hand-drawn line: straight in intent, slightly wavering like an inked road. */
function wavy(x0: number, y0: number, x1: number, y1: number, amp: number, seed: number): string {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(len / 48));
  const [nx, ny] = [-(y1 - y0) / len, (x1 - x0) / len];
  const pt = (t: number, w: number) => `${(x0 + (x1 - x0) * t + nx * w).toFixed(1)} ${(y0 + (y1 - y0) * t + ny * w).toFixed(1)}`;
  let d = `M${x0} ${y0}`;
  for (let i = 1; i <= n; i += 1) {
    const w = i === n ? 0 : amp * Math.sin(seed + i * 1.9);
    d += ` Q${pt((i - 0.5) / n, amp * Math.sin(seed + i * 1.3 + 0.7))} ${pt(i / n, w)}`;
  }
  return d;
}

const LANES = [222, 350, 478];
const ROAD_Y = 548;
const MAIN_ROAD = wavy(28, ROAD_Y, 740, ROAD_Y, 3.5, 1);
const LANE_PATHS = [
  ...LANES.map((y, i) => wavy(104, y, 604, y, 2.5, i * 3 + 2)),
  wavy(352, 222, 352, ROAD_Y, 3, 7),
  'M64 196 Q78 222 104 222',
  'M704 196 Q690 222 604 222',
];
const FOOTPATHS = [160, 288, 416, 544].flatMap((x) => [160, 288, 416].map((y) => `M${x} ${y + 26} L${x} ${y + 62}`));
const ROADS = { lanes: LANES, main: ROAD_Y, columns: [352] };
const FLOWER_BEDS: [number, number][] = [[224, 182], [480, 296], [224, 424], [608, 420], [96, 330], [480, 168], [128, 470], [640, 300]];

function islandPath(): string {
  const [x0, y0, x1, y1] = [-22, 20, 790, 654];
  const pts: [number, number][] = [];
  const edge = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number, seed: number) => {
    const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 46));
    for (let i = 0; i < n; i += 1) {
      const t = i / n;
      const wobble = 7 * Math.sin((seed + i) * 1.7) + 4 * Math.sin((seed + i) * 0.63);
      pts.push([ax + (bx - ax) * t + nx * wobble, ay + (by - ay) * t + ny * wobble]);
    }
  };
  edge(x0, y0, x1, y0, 0, -1, 1);
  edge(x1, y0, x1, y1, 1, 0, 9);
  edge(x1, y1, x0, y1, 0, 1, 23);
  edge(x0, y1, x0, y0, -1, 0, 41);
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[pts.length - 1]!, pts[0]!);
  let d = `M${start[0]!.toFixed(1)} ${start[1]!.toFixed(1)}`;
  pts.forEach((p, i) => {
    const m = mid(p, pts[(i + 1) % pts.length]!);
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0]!.toFixed(1)} ${m[1]!.toFixed(1)}`;
  });
  return `${d} Z`;
}

const Terrain = memo(function Terrain() {
  const island = islandPath();
  const nearRoad = (x: number, y: number) =>
    [...ROADS.lanes, ROADS.main].some((ry) => Math.abs(y - ry) < 14) || ROADS.columns.some((rx) => Math.abs(x - rx) < 14 && y > 150 && y < 560);

  const tufts: [number, number][] = [];
  for (let gx = 0; gx < 12; gx += 1) {
    for (let gy = 0; gy < 10; gy += 1) {
      if (noise(gx, gy) > 0.55) continue;
      const x = gx * CELL + 10 + noise(gy, gx) * 44;
      const y = gy * CELL + 10 + noise(gx + 7, gy + 3) * 44;
      if (!nearRoad(x, y)) tufts.push([x, y]);
    }
  }
  const treeline = [
    ...Array.from({ length: 17 }, (_, i) => ({ x: -6 + i * 46 + noise(i, 2) * 16, y: 52 + noise(i, 5) * 14, s: 0.85 + noise(i, 9) * 0.4, pine: false })),
    ...Array.from({ length: 15 }, (_, i) => ({ x: 14 + i * 49 + noise(i, 4) * 20, y: 88 + noise(i, 6) * 16, s: 0.75 + noise(i, 3) * 0.35, pine: noise(i, 8) > 0.6 })),
    ...[[470, 612], [520, 628], [600, 606], [690, 624], [742, 600], [40, 616]].map(([x, y], i) => ({ x: x!, y: y!, s: 0.8 + noise(i, 1) * 0.3, pine: i % 2 === 1 })),
  ].filter((t) => t.x < 724 || t.y > 120);

  return (
    <g aria-hidden="true">
      <path d={island} fill="var(--meadow-shade)" transform="translate(3 5)" opacity="0.5" />
      <path d={island} fill="var(--meadow)" stroke="var(--ink)" strokeWidth="1.6" />
      <path d={island} fill="none" stroke="var(--meadow-deep)" strokeWidth="10" opacity="0.5" clipPath="url(#island-clip)" />

      {/* pond */}
      <g transform="translate(206 612)">
        <ellipse rx="52" ry="17" fill="var(--water)" stroke="var(--ink)" strokeWidth="1.3" />
        <path d="M-30 -2 q10 -4 20 0 M6 4 q10 -4 18 0" stroke="#fff" strokeWidth="1.2" fill="none" opacity="0.7" strokeLinecap="round" />
        <path d="M44 -12 l2 -12 M48 -10 l4 -10 M40 -10 l-1 -9" stroke="#557a45" strokeWidth="1.4" strokeLinecap="round" />
      </g>

      {/* roads: edge stroke under fill stroke for an inked, hand-cut look */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g stroke="var(--path-edge)">
          {FOOTPATHS.map((d) => <path key={d} d={d} strokeWidth="9" />)}
          {LANE_PATHS.map((d) => <path key={d} d={d} strokeWidth="15" />)}
          <path d={MAIN_ROAD} strokeWidth="24" />
        </g>
        <g stroke="var(--path)">
          {FOOTPATHS.map((d) => <path key={d} d={d} strokeWidth="6" />)}
          {LANE_PATHS.map((d) => <path key={d} d={d} strokeWidth="11" />)}
          <path d={MAIN_ROAD} strokeWidth="19" />
        </g>
        <path d={MAIN_ROAD} stroke="var(--path-edge)" strokeWidth="1" strokeDasharray="1 11" />
      </g>

      {FLOWER_BEDS.map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <ellipse rx="15" ry="7" fill="var(--meadow-deep)" stroke="var(--meadow-shade)" strokeWidth="1" />
          {[[-8, -1], [-3, 2], [2, -2], [7, 1], [10, -2], [-11, 2]].map(([fx, fy], j) => (
            <circle key={j} cx={fx} cy={fy} r="1.7" fill={['#e98aa6', '#f4d35e', '#fffaf0', '#c8a2f0'][(i + j) % 4]} stroke="var(--ink)" strokeWidth="0.4" />
          ))}
        </g>
      ))}

      {tufts.map(([x, y]) => (
        <path key={`${x}-${y}`} d={`M${x - 3} ${y} l1.5 -4 M${x} ${y} l0 -5 M${x + 3} ${y} l-1.5 -4`} stroke="var(--meadow-shade)" strokeWidth="1.1" strokeLinecap="round" />
      ))}

      {treeline.map((t, i) =>
        t.pine ? (
          <g key={i} transform={`translate(${t.x} ${t.y - 4}) scale(${t.s})`}>
            <path d="M0 -17 L-10 2 L-6 2 L-12 11 L12 11 L6 2 L10 2 Z" fill="#4f7a4a" stroke="var(--ink)" strokeWidth="1.1" strokeLinejoin="round" />
          </g>
        ) : (
          <g key={i} transform={`translate(${t.x} ${t.y}) scale(${t.s})`}>
            <path d="M-1.5 10 L-1.5 16 M1.5 10 L1.5 16" stroke="var(--wood)" strokeWidth="1.6" />
            <circle r="13" fill={i % 3 === 0 ? '#5f8547' : '#6f8f4e'} stroke="var(--ink)" strokeWidth="1.1" />
            <circle cx="-4" cy="-4" r="4" fill="#86a862" />
          </g>
        ),
      )}

      {/* compass rose */}
      <g transform="translate(752 52)" opacity="0.85">
        <circle r="17" fill="var(--paper-raised)" stroke="var(--ink)" strokeWidth="1" />
        <path d="M0 -14 L3.5 0 L0 14 L-3.5 0 Z" fill="var(--ink)" />
        <path d="M0 -14 L3.5 0 L0 0 Z" fill="var(--roof)" />
        <text y="-20" textAnchor="middle" fontSize="9" fontFamily="var(--font-display)" fill="var(--ink)">N</text>
      </g>
    </g>
  );
});

function PlaceMarker({ place, ruler }: { place: Place; ruler: FactionId | null }) {
  const p = at(place.x, place.y);
  return (
    <g transform={`translate(${p.x} ${p.y})`} aria-hidden="true">
      <PlaceArt id={place.id} />
      <text className="map-label" y="-46" textAnchor="middle">
        {place.name}
      </text>
      {ruler ? (
        <text className={`map-ruler ruler-text--${ruler}`} y="-32" textAnchor="middle">
          {FACTION_SHORT[ruler]}
        </text>
      ) : null}
    </g>
  );
}

function PlotMarker({
  plot,
  occupant,
  selected,
  onSelect,
}: {
  plot: Plot;
  occupant: AgentState | undefined;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const p = at(plot.x, plot.y);
  const c = occupant?.construction;
  const total = c ? recipeForLevel(c.targetLevel)?.buildTicks ?? 1 : 1;
  const progress = c ? (total - c.remainingTicks) / total : 0;
  const burned = occupant?.control.kind === 'burned';

  return (
    <g
      transform={`translate(${p.x} ${p.y})`}
      className={occupant ? 'plot plot--occupied' : 'plot'}
      onClick={occupant ? () => onSelect(occupant.key) : undefined}
      aria-hidden="true"
    >
      <Lot vacant={!occupant} />
      {selected ? <rect className="plot-ring" x="-31" y="-31" width="62" height="62" rx="10" /> : null}
      {occupant && !burned ? (
        <g transform="translate(-2 -1) scale(1.15)">
          <Home style={occupant.homeStyle} level={occupant.homeLevel} />
        </g>
      ) : null}
      {burned ? <Ruins /> : null}
      {c ? (
        occupant!.homeLevel > 0 ? (
          <g transform="translate(17 4) scale(0.6)">
            <Scaffold progress={progress} />
          </g>
        ) : (
          <Scaffold progress={progress} />
        )
      ) : null}
      {occupant ? <Mailbox flag={scarfFor(occupant.identity.tokenId)} raised={occupant.policy.active && !burned} /> : null}
      <text className="plot-number" x="-23" y="-18">
        {plot.id.slice(1)}
      </text>
    </g>
  );
}

const PLACE_SLOTS: [number, number][] = [
  [0, 0], [-19, 5], [19, 5], [-10, 17], [10, 17], [-29, 17], [29, 17], [0, 29], [-20, 30], [20, 30], [-38, 5], [38, 5],
];

function anchorFor(location: Location, world: WorldState): { x: number; y: number } {
  if (location.kind === 'plot') {
    const plot = world.plots.find((p) => p.id === location.plotId)!;
    const p = at(plot.x, plot.y);
    return { x: p.x + 24, y: p.y + 30 };
  }
  const place = world.places.find((pl) => pl.id === location.placeId)!;
  const p = at(place.x, place.y);
  return { x: p.x, y: p.y + 26 };
}

function useChogPositions(world: WorldState) {
  return useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    for (const [key, { location, slot }] of standings(world)) {
      const base = anchorFor(location, world);
      const [dx, dy] = location.kind === 'plot' ? [slot * 12, 0] : PLACE_SLOTS[slot % PLACE_SLOTS.length]!;
      positions.set(key, { x: base.x + dx, y: base.y + dy });
    }
    return positions;
  }, [world]);
}

function ChogToken({
  agent,
  world,
  position,
  selected,
  onSelect,
}: {
  agent: AgentState;
  world: WorldState;
  position: { x: number; y: number };
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const activity = activityOf(agent, world);
  const mood = activity.glyph === 'rest' ? 'sleep' : activity.glyph === 'frozen' ? 'frozen' : 'idle';
  const busy = agent.policy.active && agent.controlAvailability === 'verified';
  return (
    <g
      className={`chog${selected ? ' chog--selected' : ''}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      role="button"
      tabIndex={0}
      aria-label={`${agent.name}, Chog #${agent.identity.tokenId}. ${activity.label}.`}
      aria-pressed={selected}
      onClick={() => onSelect(agent.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(agent.key);
        }
      }}
    >
      <ellipse className="chog-hit" cx="0" cy="-12" rx="16" ry="21" />
      {selected ? <ellipse className="chog-ring" cx="0" cy="0.5" rx="14" ry="4.6" /> : null}
      <g
        className={busy && mood !== 'sleep' ? 'chog-bob' : undefined}
        style={{ animationDelay: `${-Number(BigInt(agent.identity.tokenId) % 7n) * 0.37}s` }}
      >
        <g transform="scale(1.25)">
          <ChogFigure scarf={scarfFor(agent.identity.tokenId)} mood={mood} />
        </g>
      </g>
      <g className="chog-bubble" transform="translate(0 -36)">
        <path d="M-2.5 6.5 L0 10 L2.5 6.5" fill="var(--paper-raised)" stroke="var(--ink)" strokeWidth="1" strokeLinejoin="round" />
        <circle r="7.6" fill="var(--paper-raised)" stroke="var(--ink)" strokeWidth="1" />
        <GlyphPath glyph={activity.glyph} />
      </g>
      <text className="chog-name" y="14" textAnchor="middle">
        {agent.name}
      </text>
    </g>
  );
}

export function CityMap({
  world,
  selectedKey,
  onSelect,
  rulers,
}: {
  world: WorldState;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Who rules each Cult place (server mode). */
  rulers?: Rulers | null;
}) {
  const positions = useChogPositions(world);
  const occupants = useMemo(() => new Map(world.agents.map((a) => [a.plotId, a])), [world]);
  const selected = world.agents.find((a) => a.key === selectedKey);
  // Stable DOM order: moving SVG nodes between renders would cancel the walking transition.
  const ordered = world.agents.filter((a) => positions.has(a.key));

  return (
    <svg className="city-map" viewBox="-36 6 840 664" role="group" aria-label={`Map of ${world.cityId === 'fixture-village' ? 'the fixture village' : 'the village'}`}>
      <defs>
        <clipPath id="island-clip">
          <rect x="-40" y="0" width="860" height="680" />
        </clipPath>
      </defs>
      <Terrain />
      {world.places.map((place) => (
        <PlaceMarker key={place.id} place={place} ruler={rulers?.places[place.id]?.ruler ?? null} />
      ))}
      {world.plots.map((plot) => (
        <PlotMarker
          key={plot.id}
          plot={plot}
          occupant={occupants.get(plot.id)}
          selected={selected?.plotId === plot.id}
          onSelect={onSelect}
        />
      ))}
      {ordered.map((agent) => (
        <ChogToken
          key={agent.key}
          agent={agent}
          world={world}
          position={positions.get(agent.key)!}
          selected={agent.key === selectedKey}
          onSelect={onSelect}
        />
      ))}
    </svg>
  );
}
