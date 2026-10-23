import { describe, expect, it } from 'vitest';
import { LOTS } from '../../src/web/world3d/District3D';
import { bridges, local, PLACES, PLOTS, STREAM, type XZ } from '../../src/web/world3d/layout';
import { route } from '../../src/web/world3d/paths';

/** Every point along a route, a step apart. */
function walk(points: XZ[], step = 0.15): XZ[] {
  const out: XZ[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k <= n; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Inside a plot's fence (with a little give at the edge). */
function insideYard(p: XZ, plot: { x: number; z: number; r: number }): boolean {
  const [lx, lz] = local(0, 0, -plot.r, p[0] - plot.x, p[1] - plot.z);
  return Math.abs(lx) < 0.72 && Math.abs(lz) < 0.72;
}

const crossings = bridges().map((b) => b.at);
const inStream = (p: XZ) => STREAM.some(([x, z]) => Math.hypot(p[0] - x, p[1] - z) < 0.35);
const onBridge = (p: XZ) => crossings.some(([x, z]) => Math.hypot(p[0] - x, p[1] - z) < 1.0);

const doorstep = (id: string): XZ => {
  const plot = PLOTS[id]!;
  return local(plot.x, plot.z, plot.r, 0.62, 1.25);
};

describe('walking routes', () => {
  const homes = Object.keys(PLOTS);
  const places = Object.values(PLACES).map((p) => p.anchor);

  it('never cuts through another home’s yard or wades through the stream', () => {
    const problems: string[] = [];
    for (const home of homes) {
      for (const dest of places) {
        for (const p of walk(route(doorstep(home), dest))) {
          for (const [id, plot] of Object.entries(PLOTS)) if (id !== home && insideYard(p, plot)) problems.push(`${home} -> ${dest} crosses ${id}`);
          if (inStream(p) && !onBridge(p)) problems.push(`${home} -> ${dest} wades at ${p}`);
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it('uses the roads for every longer trip: home to place, place to place, villager lot to work', () => {
    const lotGates = Object.values(LOTS).map((lot) => local(lot.x, lot.z, lot.r, 0.62, 1.25));
    const trips: Array<[XZ, XZ]> = [
      ...homes.flatMap((home) => places.map((dest) => [doorstep(home), dest] as [XZ, XZ])),
      ...places.flatMap((a) => places.map((b) => [a, b] as [XZ, XZ])),
      ...lotGates.flatMap((gate) => [PLACES.farm.anchor, PLACES.forest.anchor, PLACES.quarry.anchor].map((site) => [gate, site] as [XZ, XZ])),
    ];
    for (const [from, to] of trips) {
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 4) continue;
      expect(route(from, to).length, `${from} -> ${to} went straight`).toBeGreaterThan(2);
    }
  });

  it('takes villagers over the footbridge, not across the water', () => {
    const lot = LOTS.c05!;
    const gate = local(lot.x, lot.z, lot.r, 0.62, 1.25);
    const path = route(gate, PLACES.farm.anchor);
    // The strait between the islands lies between z -9.5 and -13.2; the footbridge is at x = 0.
    for (const p of walk(path)) if (p[1] < -9.6 && p[1] > -13.2) expect(Math.abs(p[0])).toBeLessThan(0.6);
  });

  it('walks straight for short steps', () => {
    expect(route([0, 0], [0.5, 0.5])).toEqual([
      [0, 0],
      [0.5, 0.5],
    ]);
  });
});
