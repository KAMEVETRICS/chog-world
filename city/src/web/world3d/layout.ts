// Hand-placed village layout for the 3D world. Positions are view data only: the simulation
// knows plot IDs and place IDs, never coordinates, so this can change without touching rules.
import type { PlaceId } from '../../shared/contracts';

export type XZ = [number, number];

export interface PlotLayout {
  x: number;
  z: number;
  /** Yaw: 0 means the gate and front door face +Z. Each home faces its road. */
  r: number;
}

export const PLOTS: Record<string, PlotLayout> = {
  p01: { x: -5.6, z: -4.4, r: 0.25 },
  p02: { x: -6.5, z: -0.6, r: Math.PI - 0.15 },
  p03: { x: -1.5, z: -7.1, r: 1.45 },
  p04: { x: 2.3, z: -6.4, r: -1.4 },
  p05: { x: 4.8, z: -4.5, r: 0.2 },
  p06: { x: 6.9, z: -0.7, r: Math.PI + 0.25 },
  p07: { x: -6.0, z: 2.6, r: 0.1 },
  p08: { x: -5.2, z: 7.1, r: Math.PI - 0.1 },
  p09: { x: 1.0, z: 4.6, r: Math.PI * 0.78 },
  p10: { x: 6.3, z: 7.3, r: Math.PI + 0.05 },
  p11: { x: 7.4, z: 2.2, r: 0.45 },
  p12: { x: 3.7, z: 7.7, r: Math.PI - 0.2 },
};

export interface PlaceLayout {
  pos: XZ;
  /** Yaw of the building/site itself. */
  r: number;
  /** Where residents stand while there. */
  anchor: XZ;
  /** Where residents look while there: a yaw, or 'site' to face the place itself. */
  face: number | 'site';
  ring?: number;
  rows?: boolean;
}

export const PLACES: Record<PlaceId, PlaceLayout> = {
  plaza: { pos: [0, 0.6], r: 0, anchor: [0, 0.6], face: 'site', ring: 1.15 },
  tavern: { pos: [4.3, 2.5], r: -0.45, anchor: [3.6, 3.9], face: -0.3 },
  workshop: { pos: [9.2, 5.1], r: -0.55, anchor: [8.2, 6.3], face: -0.4 },
  farm: { pos: [-9.2, 5.2], r: 0.25, anchor: [-8.4, 6.7], face: Math.PI, rows: true },
  forest: { pos: [-9.6, -5.6], r: 0, anchor: [-8.0, -4.0], face: 'site' },
  quarry: { pos: [9.6, -5.9], r: 0, anchor: [8.1, -4.4], face: 'site' },
};

export const POND = { x: -1.6, z: 7.6, rx: 2.0, rz: 1.0 };

/** Catmull-Rom through control points, sampled every ~`step` units. */
export function spline(points: XZ[], step = 0.35): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = i === 0 ? 0 : 1; k <= n; k += 1) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

export const STREAM = spline([
  [-3.2, -10.4],
  [-3.9, -7.4],
  [-2.9, -4.9],
  [-3.7, -2.3],
  [-3.1, 0.7],
  [-3.7, 3.6],
  [-2.8, 5.9],
  [-1.9, 7.0],
]);

export interface Road {
  points: XZ[];
  width: number;
}

export const ROADS: Road[] = [
  // main road: farm - plaza - tavern - workshop
  { points: spline([[-8.6, 6.3], [-6.3, 4.6], [-3.4, 3.4], [-1.3, 1.9], [0, 0.6], [1.7, 1.5], [3.3, 3.4], [5.8, 4.8], [8.0, 6.0]]), width: 0.85 },
  // north-west to the forest
  { points: spline([[-0.6, 0.1], [-2.2, -1.2], [-3.6, -1.9], [-5.4, -2.6], [-7.2, -3.4], [-8.2, -4.2]]), width: 0.6 },
  // north-east to the quarry
  { points: spline([[0.7, 0.0], [2.3, -1.2], [4.4, -2.0], [6.4, -2.9], [8.2, -4.3]]), width: 0.6 },
  // north lane
  { points: spline([[0.1, -0.2], [0.5, -2.5], [-0.1, -4.8], [0.4, -7.2], [0.1, -8.6]]), width: 0.5 },
  // southern lane past the pond
  { points: spline([[1.7, 1.5], [2.2, 4.0], [3.6, 5.9], [6.3, 6.0]]), width: 0.5 },
  // western lane
  { points: spline([[-5.4, -2.6], [-6.9, 0.8], [-6.4, 4.0]]), width: 0.5 },
];

/** Nearest point on any road to (x, z). */
export function nearestRoadPoint(x: number, z: number): { point: XZ; distance: number } {
  let best: XZ = [x, z];
  let distance = Infinity;
  for (const road of ROADS)
    for (const p of road.points) {
      const d = Math.hypot(p[0] - x, p[1] - z);
      if (d < distance) {
        distance = d;
        best = p;
      }
    }
  return { point: best, distance };
}

/** Local offset (dx, dz) rotated by yaw r, added to (x, z). */
export function local(x: number, z: number, r: number, dx: number, dz: number): XZ {
  return [x + dx * Math.cos(r) + dz * Math.sin(r), z - dx * Math.sin(r) + dz * Math.cos(r)];
}

/** A footpath from each lot's gate to its nearest road. */
export const FOOTPATHS: Road[] = Object.values(PLOTS).map(({ x, z, r }) => {
  const gate = local(x, z, r, 0, 0.88);
  const { point } = nearestRoadPoint(gate[0], gate[1]);
  return { points: spline([gate, [(gate[0] + point[0]) / 2, (gate[1] + point[1]) / 2], point], 0.25), width: 0.32 };
});

/** Where a road crosses the stream: position and road direction (for bridges). */
export function bridges(): { at: XZ; yaw: number }[] {
  const result: { at: XZ; yaw: number }[] = [];
  const cross = (a: XZ, b: XZ, c: XZ, d: XZ): XZ | null => {
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
    const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : null;
  };
  for (const road of ROADS) {
    for (let i = 0; i < road.points.length - 1; i += 1) {
      const a = road.points[i]!;
      const b = road.points[i + 1]!;
      for (let j = 0; j < STREAM.length - 1; j += 1) {
        const hit = cross(a, b, STREAM[j]!, STREAM[j + 1]!);
        if (hit && !result.some((r) => Math.hypot(r.at[0] - hit[0], r.at[1] - hit[1]) < 1)) {
          result.push({ at: hit, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) });
        }
      }
    }
  }
  return result;
}
