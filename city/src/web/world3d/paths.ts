// Walking routes. Residents leave by their gate, follow the roads and footpaths, cross the stream on its
// bridges and the strait on the footbridge, then step off the road to where they're going, instead of
// sliding through fences, houses and water in a straight line. View only: the simulation moves residents
// a whole place at a time; this decides how the walk between two committed positions looks.
import { DISTRICT_PATHS } from './District3D';
import { DISTRICTS, districtPaths, FOOTPATHS, PLACES, ROADS, spline, type XZ } from './layout';

/** Points of different paths closer than this are joined (crossings, a footpath meeting its road). */
const JOIN = 0.55;
/** A path that ends this close to another one runs into it. */
const MEETS = 1.4;
/** Open squares anyone may cross: every path point on one is joined to its centre. The roads stop at the Plaza's edge. */
const SQUARES: Array<{ centre: XZ; radius: number }> = [{ centre: PLACES.plaza.pos, radius: 1.75 }];
/** Within this, walk straight: the same yard, or a step across the Plaza. */
const STRAIGHT = 1.4;
/** Farther than this from any path, there is no sensible route: walk straight. */
const OFF_ROAD = 3.5;

interface Graph {
  points: XZ[];
  edges: Array<Array<{ to: number; cost: number }>>;
}

let graph: Graph | null = null;

const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function build(): Graph {
  const polylines: XZ[][] = [
    ...ROADS.map((r) => r.points),
    ...FOOTPATHS.map((r) => r.points),
    ...DISTRICT_PATHS.map((p) => spline(p, 0.5)),
    ...DISTRICTS.flatMap(districtPaths).map((p) => spline(p, 0.5)),
  ];
  const points: XZ[] = [];
  const owner: number[] = [];
  const edges: Graph['edges'] = [];
  const link = (a: number, b: number) => {
    const cost = dist(points[a]!, points[b]!);
    edges[a]!.push({ to: b, cost });
    edges[b]!.push({ to: a, cost });
  };
  const ends: number[] = [];
  polylines.forEach((line, li) => {
    line.forEach((p, i) => {
      points.push(p);
      owner.push(li);
      edges.push([]);
      if (i > 0) link(points.length - 2, points.length - 1);
      if (i === 0 || i === line.length - 1) ends.push(points.length - 1);
    });
  });
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      if (owner[a] !== owner[b] && dist(points[a]!, points[b]!) < JOIN) link(a, b);
    }
  }
  for (const square of SQUARES) {
    points.push(square.centre);
    owner.push(-1);
    edges.push([]);
    const hub = points.length - 1;
    for (let i = 0; i < hub; i += 1) if (dist(points[i]!, square.centre) < square.radius) link(i, hub);
  }
  // Each path's ends join the nearest point of any other path they run into.
  for (const e of ends) {
    let best = -1;
    for (let b = 0; b < points.length; b += 1) {
      if (owner[b] !== owner[e] && (best < 0 || dist(points[e]!, points[b]!) < dist(points[e]!, points[best]!))) best = b;
    }
    if (best >= 0 && dist(points[e]!, points[best]!) < MEETS) link(e, best);
  }
  return { points, edges };
}

function nearest(g: Graph, p: XZ): { index: number; distance: number } {
  let index = -1;
  let distance = Infinity;
  g.points.forEach((q, i) => {
    const d = dist(p, q);
    if (d < distance) {
      distance = d;
      index = i;
    }
  });
  return { index, distance };
}

/** Shortest path between two graph points (Dijkstra with a binary heap: fast however large the town grows). */
function shortest(g: Graph, from: number, to: number): number[] | null {
  const best = new Float64Array(g.points.length).fill(Infinity);
  const prev = new Int32Array(g.points.length).fill(-1);
  const heap: Array<[number, number]> = [[0, from]];
  best[from] = 0;
  const push = (item: [number, number]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (heap[parent]![0] <= heap[i]![0]) break;
      [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
      i = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > best[u]!) continue;
    if (u === to) break;
    for (const { to: v, cost } of g.edges[u]!) {
      if (d + cost < best[v]!) {
        best[v] = d + cost;
        prev[v] = u;
        push([best[v]!, v]);
      }
    }
  }
  if (best[to] === Infinity) return null;
  const path: number[] = [];
  for (let v = to; v >= 0; v = prev[v]!) path.unshift(v);
  return path;
}

/** Most a shortcut between two waypoints may stray from the road it replaces. */
const STRAY = 0.08;

/** Distance from p to the segment a-b. */
function offSegment(p: XZ, a: XZ, b: XZ): number {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
}

/**
 * Drops waypoints a walker can skip without leaving the road: a point goes only if the straight line from the
 * last kept point to the next stays within STRAY of every road point it replaces. Walkers turn at corners, not
 * every step, and never cut across a garden on the inside of a bend.
 */
function simplify(route: XZ[]): XZ[] {
  if (route.length < 3) return route;
  const out: XZ[] = [route[0]!];
  let anchor = 0;
  for (let i = 2; i < route.length; i += 1) {
    const a = route[anchor]!;
    const c = route[i]!;
    const strays = route.slice(anchor + 1, i).some((b) => offSegment(b, a, c) > STRAY);
    if (strays) {
      out.push(route[i - 1]!);
      anchor = i - 1;
    }
  }
  out.push(route[route.length - 1]!);
  return out;
}

/** The waypoints of a walk from `from` to `to`, both ends included. */
export function route(from: XZ, to: XZ): XZ[] {
  if (dist(from, to) < STRAIGHT) return [from, to];
  graph ??= build();
  const a = nearest(graph, from);
  const b = nearest(graph, to);
  if (a.distance > OFF_ROAD || b.distance > OFF_ROAD || a.index === b.index) return [from, to];
  const path = shortest(graph, a.index, b.index);
  if (!path) return [from, to];
  const roadWalk = path.reduce((sum, v, i) => (i ? sum + dist(graph!.points[path[i - 1]!]!, graph!.points[v]!) : 0), 0);
  // A detour more than three times the direct line means the road doesn't serve this trip: cut across.
  if (roadWalk + a.distance + b.distance > dist(from, to) * 3 + 4) return [from, to];
  return simplify([from, ...path.map((v) => graph!.points[v]!), to]);
}

/** Total length of a route. */
export const routeLength = (points: readonly XZ[]) => points.reduce((sum, p, i) => (i ? sum + dist(points[i - 1]!, p) : 0), 0);

