// The 3D village. Renders committed world state; Chogs walk between committed positions.
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AgentState, CitizenState, CityEvent, PlaceId, WorldState } from '../../shared/contracts';
import { appearanceOf, type Appearance } from '../../shared/looks';
import { GATHER_SITES } from '../../shared/rules';
import { citizenAsleep } from '../../simulation/citizens';
import { District3D, LOTS, rowsInUse } from './District3D';
import { GrowthDistrict3D } from './Districts3D';
import { builtUp } from '../world/growth';
import { recipeForLevel } from '../../shared/rules';
import { FACTION_SHORT, type Rulers } from '../cult/rulers';
import { activityOf, placeName } from '../format';
import { appearanceFor } from '../looks';
import { scarfFor, type Glyph } from '../world/art';
import { standings } from '../world/positions';
import { Chog3D, type ChogAction } from './Chog3D';
import { fractionalTick, nightness, timeOfDay } from './daylight';
import { geo, ribbon } from './geometry';
import { glow, night, PALETTE as C, toon } from './materials';
import { OverlayContext } from './overlay';
import { bridges, DISTRICT_SIZE, DISTRICTS, FOOTPATHS, local, PLACES, PLOTS, POND, PROJECT_SITES, ROADS, spline, STREAM, type XZ } from './layout';
import { House3D, Lot3D, Pine, Place3D, Rock, RoundTree, Ruins3D, Scaffold3D, Tent3D } from './models';
import { fountainCentre, Projects3D } from './Projects3D';
import { Pops3D } from './Pops3D';
import { CameraDirector, VILLAGE_CENTRE, VILLAGE_FRAME, type CameraShot, type TownFrame } from './CameraDirector';
import { Burst3D } from './Burst3D';
import type { Celebration } from '../fx/celebrations';
import { Declutter, LABEL_PRIORITY, ScaledHtml } from './ScaledHtml';
import './camera.css';

// ---------------------------------------------------------------------------------------------
// Layout (world units; the logical grid is 12x10 cells of 2 units)


// ---------------------------------------------------------------------------------------------
// Terrain

function islandShape(scale = 1): THREE.Shape {
  const [x0, x1, z0, z1, r] = [-12.6, 12.6, -9.8, 9.9, 2.2];
  const pts: THREE.Vector2[] = [];
  const corner = (cx: number, cz: number, a0: number) => {
    for (let i = 0; i <= 6; i += 1) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
  };
  // Corners walked counter-clockwise in (x, -z) shape space.
  corner(x1 - r, -z0 - r, 0);
  corner(x0 + r, -z0 - r, Math.PI / 2);
  corner(x0 + r, -z1 + r, Math.PI);
  corner(x1 - r, -z1 + r, (3 * Math.PI) / 2);
  const dense: THREE.Vector2[] = [];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    const n = Math.max(1, Math.round(p.distanceTo(q) / 0.9));
    for (let k = 0; k < n; k += 1) dense.push(p.clone().lerp(q, k / n));
  });
  const wobbled = dense.map((p, i) => {
    const w = 1 + (Math.sin(i * 1.7) * 0.012 + Math.sin(i * 0.43) * 0.015);
    return p.clone().multiplyScalar(w * scale);
  });
  return new THREE.Shape(wobbled);
}

const Island = memo(function Island() {
  const [top, lower, foam] = useMemo(() => {
    const t = new THREE.ExtrudeGeometry(islandShape(), { depth: 0.55, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.1, bevelSegments: 1, curveSegments: 4 });
    t.rotateX(-Math.PI / 2);
    t.translate(0, -0.63, 0); // depth + bevel: grass top sits exactly at y=0
    const l = new THREE.ExtrudeGeometry(islandShape(0.985), { depth: 1.3, bevelEnabled: false });
    l.rotateX(-Math.PI / 2);
    l.translate(0, -1.85, 0);
    const f = new THREE.ShapeGeometry(islandShape(1.035));
    f.rotateX(-Math.PI / 2);
    return [t, l, f];
  }, []);
  return (
    <group>
      <mesh geometry={top} material={[toon(C.grass), toon(C.earth)]} receiveShadow />
      <mesh geometry={lower} material={toon(C.earthDeep)} />
      <mesh geometry={foam} position-y={-0.43}>
        <meshBasicMaterial color="#e9f6f4" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <Shore />
    </group>
  );
});

/** Where the footbridge to Newcomers' Row lands, and where each district's footbridge does: the shore stays clear. */
const LANDING = { x: 0, halfWidth: 1.3 };
const DISTRICT_LANDINGS: XZ[] = DISTRICTS.map((d) => d.bridge[0]);

/**
 * A rocky shoreline: boulders along the waterline, half in the water, a few climbing the cliff and a few
 * out in the shallows, so the island reads as land rising from the sea rather than a slab. Seeded, so
 * every viewer sees the same coast.
 */
const Shore = memo(function Shore() {
  const rocks = useMemo(() => {
    const edge = islandShape(1.01).getPoints();
    const out: { x: number; y: number; z: number; s: number; r: number; tone: string }[] = [];
    let walked = 0;
    edge.forEach((p, i) => {
      const q = edge[(i + 1) % edge.length]!;
      walked += p.distanceTo(q);
      if (walked < 0.6) return;
      walked = 0;
      const x = p.x;
      const z = -p.y; // shape space is (x, -z)
      if (z < -8.5 && Math.abs(x - LANDING.x) < LANDING.halfWidth) return;
      if (DISTRICT_LANDINGS.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 1.4)) return;
      const k = rand(x, z);
      const k2 = rand(z, x);
      // Clusters and gaps, not a wall: about a third of the coast is bare cliff meeting the water.
      if (Math.sin(x * 0.9 + z * 1.3) + k * 0.8 < 0.05) return;
      out.push({ x, y: -0.5 + k * 0.08, z, s: 0.14 + k * k * 0.3, r: k2 * Math.PI, tone: k2 > 0.6 ? C.stoneDark : k2 > 0.25 ? C.stone : '#a39a8c' });
      // Now and then a stone higher on the cliff face, and one out in the shallows.
      if (k > 0.8) out.push({ x: x * 0.997, y: -0.22, z: z * 0.997, s: 0.1 + k2 * 0.08, r: k * 3, tone: C.stone });
      if (k2 > 0.9) {
        const away = 1.05 + k * 0.04;
        out.push({ x: x * away, y: -0.52, z: z * away, s: 0.16 + k * 0.14, r: k2 * 2, tone: C.stoneDark });
      }
    });
    return out;
  }, []);
  return (
    <group>
      {rocks.map((rock, i) => (
        <mesh key={i} geometry={geo.dodecahedron(1)} material={toon(rock.tone)} position={[rock.x, rock.y, rock.z]} rotation={[rock.r, rock.r * 1.7, 0]} scale={[rock.s * 1.25, rock.s, rock.s]} castShadow receiveShadow />
      ))}
    </group>
  );
});

function Water() {
  const mesh = useRef<THREE.Mesh>(null!);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(140, 140, 70, 70);
    g.rotateX(-Math.PI / 2);
    return g.toNonIndexed();
  }, []);
  const base = useMemo(() => Float32Array.from(geometry.getAttribute('position').array), [geometry]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: C.water, flatShading: true, roughness: 0.35, metalness: 0.05 }), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      const x = base[i * 3]!;
      const z = base[i * 3 + 2]!;
      pos.setY(i, Math.sin(x * 0.45 + t * 0.9) * 0.06 + Math.cos(z * 0.38 + t * 0.7) * 0.06);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  });
  return <mesh ref={mesh} geometry={geometry} material={material} position-y={-0.5} receiveShadow />;
}

const ALL_PATHS = [...ROADS, ...FOOTPATHS];
/** Each district's road from the village to its footbridge. */
const ACCESS_ROADS = DISTRICTS.map((d) => ({ id: d.id, road: { points: spline(d.access), width: 0.5 } }));
const CLEAR_OF = [...ALL_PATHS, ...ACCESS_ROADS.map((a) => a.road)];

const Roads = memo(function Roads() {
  const geometries = useMemo(
    () => ALL_PATHS.map((r) => ({ edge: ribbon(r.points, r.width + 0.14), fill: ribbon(r.points, r.width) })),
    [],
  );
  return (
    <group>
      {geometries.map(({ edge, fill }, i) => (
        <group key={i}>
          <mesh geometry={edge} material={toon(C.pathEdge, true)} position-y={0.012 + i * 0.0003} receiveShadow />
          <mesh geometry={fill} material={toon(C.path, true)} position-y={0.02 + i * 0.0003} receiveShadow />
        </group>
      ))}
    </group>
  );
});

/** The roads out to the districts that exist. */
function AccessRoads({ districts }: { districts: ReadonlySet<string> }) {
  const geometries = useMemo(() => ACCESS_ROADS.map((a) => ({ id: a.id, edge: ribbon(a.road.points, a.road.width + 0.14), fill: ribbon(a.road.points, a.road.width) })), []);
  return (
    <group>
      {geometries
        .filter((g) => districts.has(g.id))
        .map(({ id, edge, fill }) => (
          <group key={id}>
            <mesh geometry={edge} material={toon(C.pathEdge, true)} position-y={0.011} receiveShadow />
            <mesh geometry={fill} material={toon(C.path, true)} position-y={0.019} receiveShadow />
          </group>
        ))}
    </group>
  );
}

/** The stream from the northern hills into the pond, and a little bridge wherever a road crosses it. */
const Stream = memo(function Stream() {
  const [bank, water, shine] = useMemo(() => [ribbon(STREAM, 1.35), ribbon(STREAM, 0.95), ribbon(STREAM, 0.28)], []);
  const crossings = useMemo(bridges, []);
  return (
    <group>
      <mesh geometry={bank} material={toon('#86b158', true)} position-y={0.008} receiveShadow />
      <mesh geometry={water} material={toon(C.water, true)} position-y={0.03} />
      <mesh geometry={shine} material={toon('#a6dde4', true)} position-y={0.034} />
      {crossings.map(({ at, yaw }, i) => (
        <group key={i} position={[at[0], 0, at[1]]} rotation-y={yaw}>
          {[-0.5, -0.25, 0, 0.25, 0.5].map((z, k) => (
            <mesh key={k} geometry={geo.box(0.95, 0.06, 0.22)} material={toon(k % 2 ? C.wood : '#b8794a')} position={[0, 0.1 + (0.25 - Math.abs(z) * 0.3), z]} castShadow receiveShadow />
          ))}
          {[-0.5, 0.5].map((x) =>
            [-0.55, 0, 0.55].map((z) => (
              <mesh key={`${x}${z}`} geometry={geo.box(0.05, 0.3, 0.05)} material={toon(C.woodDark)} position={[x, 0.3 + (0.25 - Math.abs(z) * 0.3), z]} castShadow />
            )),
          )}
          {[-0.5, 0.5].map((x) => (
            <mesh key={x} geometry={geo.box(0.04, 0.04, 1.2)} material={toon(C.woodDark)} position={[x, 0.42, 0]} />
          ))}
        </group>
      ))}
    </group>
  );
});

function rand(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function isClear(x: number, z: number, margin: number): boolean {
  if (Math.abs(x) > 11.8 || z < -9.1 || z > 9.3) return false;
  for (const { x: px, z: pz, r } of Object.values(PLOTS)) {
    const [lx, lz] = local(0, 0, -r, x - px, z - pz);
    if (Math.abs(lx) < 1.05 + margin && Math.abs(lz) < 1.05 + margin) return false;
  }
  for (const road of CLEAR_OF) for (const [rx, rz] of road.points) if (Math.hypot(x - rx, z - rz) < road.width / 2 + 0.2 + margin) return false;
  for (const [sx, sz] of STREAM) if (Math.hypot(x - sx, z - sz) < 0.8 + margin) return false;
  for (const p of Object.values(PLACES)) if (Math.hypot(x - p.pos[0], z - p.pos[1]) < 1.9 + margin) return false;
  for (const site of Object.values(PROJECT_SITES)) if (Math.hypot(x - site.pos[0], z - site.pos[1]) < site.clear + margin) return false;
  if (Math.hypot((x - POND.x) / (POND.rx + 0.4), (z - POND.z) / (POND.rz + 0.4)) < 1) return false;
  return true;
}

const Scenery = memo(function Scenery() {
  const { trees, grass, flowers, rocks } = useMemo(() => {
    const trees: { x: number; z: number; s: number; pine: boolean; tint: string }[] = [];
    for (let i = 0; i < 70 && trees.length < 34; i += 1) {
      const x = -11.4 + rand(i, 1) * 22.8;
      const z = -9 + rand(i, 2) * 2.4;
      if (isClear(x, z, 0.1)) trees.push({ x, z, s: 0.75 + rand(i, 3) * 0.5, pine: rand(i, 4) > 0.55, tint: rand(i, 5) > 0.5 ? C.leaf : '#6a9a4c' });
    }
    for (let i = 0; i < 60 && trees.length < 52; i += 1) {
      const x = -11.5 + rand(i, 6) * 23;
      const z = 7.6 + rand(i, 7) * 1.7;
      if (isClear(x, z, 0.1)) trees.push({ x, z, s: 0.7 + rand(i, 8) * 0.4, pine: rand(i, 9) > 0.6, tint: C.leaf });
    }
    // Clumps between homes, so the village reads as grown rather than placed.
    for (let i = 0; i < 400 && trees.length < 80; i += 1) {
      const x = -11 + rand(i, 61) * 22;
      const z = -7 + rand(i, 62) * 14;
      if (isClear(x, z, 0.35)) trees.push({ x, z, s: 0.6 + rand(i, 63) * 0.45, pine: rand(i, 64) > 0.7, tint: rand(i, 65) > 0.5 ? C.leaf : '#6a9a4c' });
    }
    const grass: [number, number, number][] = [];
    for (let i = 0; i < 1400 && grass.length < 420; i += 1) {
      const x = -12 + rand(i, 11) * 24;
      const z = -9.3 + rand(i, 12) * 18.6;
      if (isClear(x, z, -0.1)) grass.push([x, z, rand(i, 13)]);
    }
    const flowers: [number, number, string][] = [];
    const palette = ['#e98aa6', '#f4d35e', '#ffffff', '#c8a2f0', '#f29e6b'];
    for (let i = 0; i < 900 && flowers.length < 110; i += 1) {
      const x = -12 + rand(i, 21) * 24;
      const z = -9.3 + rand(i, 22) * 18.6;
      if (isClear(x, z, 0)) flowers.push([x, z, palette[Math.floor(rand(i, 23) * palette.length)]!]);
    }
    const rocks: [number, number, number][] = [];
    for (let i = 0; i < 200 && rocks.length < 14; i += 1) {
      const x = -12 + rand(i, 31) * 24;
      const z = -9.3 + rand(i, 32) * 18.6;
      if (isClear(x, z, 0.2)) rocks.push([x, z, 0.35 + rand(i, 33) * 0.4]);
    }
    return { trees, grass, flowers, rocks };
  }, []);

  const grassRef = useRef<THREE.InstancedMesh>(null!);
  const flowerRef = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    grass.forEach(([x, z, r], i) => {
      q.setFromEuler(new THREE.Euler(0, r * 6, (r - 0.5) * 0.4));
      m.compose(new THREE.Vector3(x, 0.08, z), q, new THREE.Vector3(1, 0.7 + r * 0.8, 1));
      grassRef.current.setMatrixAt(i, m);
    });
    grassRef.current.instanceMatrix.needsUpdate = true;
    const c = new THREE.Color();
    flowers.forEach(([x, z, color], i) => {
      m.makeTranslation(x, 0.07, z);
      flowerRef.current.setMatrixAt(i, m);
      flowerRef.current.setColorAt(i, c.set(color));
    });
    flowerRef.current.instanceMatrix.needsUpdate = true;
    if (flowerRef.current.instanceColor) flowerRef.current.instanceColor.needsUpdate = true;
  }, [grass, flowers]);

  return (
    <group>
      <instancedMesh ref={grassRef} args={[geo.cone(0.05, 0.2, 3), toon(C.grassDeep), grass.length]} receiveShadow />
      <instancedMesh ref={flowerRef} args={[geo.icosahedron(0.05, 0), toon('#ffffff'), flowers.length]} />
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} rotation-y={rand(i, 40) * 6}>
          {t.pine ? <Pine scale={t.s} /> : <RoundTree scale={t.s} tint={t.tint} />}
        </group>
      ))}
      {rocks.map(([x, z, s], i) => (
        <group key={i} position={[x, 0, z]} rotation-y={s * 9}>
          <Rock scale={s} />
        </group>
      ))}
      {/* pond */}
      <group position={[POND.x, 0, POND.z]}>
        <mesh geometry={geo.cylinder(1, 1, 0.04, 28)} material={toon(C.water)} scale={[POND.rx, 1, POND.rz]} position-y={0.03} />
        <mesh geometry={geo.torus(1, 0.05, 4, 28)} material={toon(C.pathEdge)} scale={[POND.rx, POND.rz, 1]} rotation-x={Math.PI / 2} position-y={0.05} />
        {[0, 0.25, -0.2].map((dx, i) => (
          <mesh key={i} geometry={geo.cylinder(0.015, 0.015, 0.5, 4)} material={toon('#557a45')} position={[1.6 + dx, 0.25, -0.35 + i * 0.12]} rotation-z={dx * 0.6} />
        ))}
        <mesh geometry={geo.cylinder(0.22, 0.22, 0.02, 10)} material={toon('#6f9b63')} position={[-0.6, 0.05, 0.1]} />
      </group>
    </group>
  );
});

function Clouds() {
  const group = useRef<THREE.Group>(null!);
  const clouds = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({ x: -26 + i * 8.5 + rand(i, 50) * 4, z: -9 + rand(i, 51) * 16, y: 7 + rand(i, 52) * 1.5, s: 0.8 + rand(i, 53) * 0.7, speed: 0.25 + rand(i, 54) * 0.2 })),
    [],
  );
  useFrame((_, dt) => {
    group.current.children.forEach((cloud, i) => {
      cloud.position.x += clouds[i]!.speed * Math.min(dt, 0.05);
      if (cloud.position.x > 28) cloud.position.x = -28;
    });
  });
  return (
    <group ref={group}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={c.s}>
          {[[0, 0, 0, 0.9], [0.9, -0.15, 0.1, 0.65], [-0.85, -0.2, 0, 0.6], [0.3, 0.35, -0.1, 0.6]].map(([x, y, z, r], j) => (
            <mesh key={j} geometry={geo.icosahedron(r!, 1)} material={toon('#ffffff')} position={[x!, y!, z!]} />
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Sky and light

const SKY_KEYS: [number, string, number, string, number][] = [
  // tod, sky, sun intensity, sun colour, hemisphere intensity
  [0.0, '#f6c7a4', 1.4, '#ffd2a1', 1.0],
  [0.12, '#cfe8ee', 2.3, '#fff3dc', 1.25],
  [0.38, '#bfe0ec', 2.4, '#fff6e6', 1.3],
  [0.5, '#f2a77c', 1.3, '#ffb27a', 1.05],
  [0.6, '#2c3760', 0.45, '#a9b9ff', 0.6],
  [0.88, '#27325a', 0.45, '#a9b9ff', 0.6],
  [1.0, '#f6c7a4', 1.4, '#ffd2a1', 1.0],
];

function sampleSky(tod: number) {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1]![0] <= tod) i += 1;
  const a = SKY_KEYS[i]!;
  const b = SKY_KEYS[i + 1]!;
  const t = (tod - a[0]) / (b[0] - a[0] || 1);
  return {
    sky: new THREE.Color(a[1]).lerp(new THREE.Color(b[1]), t),
    sun: a[2] + (b[2] - a[2]) * t,
    sunColor: new THREE.Color(a[3]).lerp(new THREE.Color(b[3]), t),
    hemi: a[4] + (b[4] - a[4]) * t,
  };
}

function DayCycle({ clock }: { clock: React.RefObject<{ tick: string; nextDueAt: string }> }) {
  const sun = useRef<THREE.DirectionalLight>(null!);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    scene.background = new THREE.Color('#cfe8ee');
    scene.fog = new THREE.Fog('#cfe8ee', 45, 95);
  }, [scene]);
  useFrame(() => {
    const tod = timeOfDay(fractionalTick(clock.current.tick, clock.current.nextDueAt, Date.now()));
    const k = sampleSky(tod);
    (scene.background as THREE.Color).copy(k.sky);
    const fog = scene.fog as THREE.Fog;
    fog.color.copy(k.sky);
    // Haze starts beyond the island however far the player zooms out.
    const d = camera.position.length();
    fog.near = d + 6;
    fog.far = d * 2.2 + 30;
    sun.current.intensity = k.sun;
    sun.current.color.copy(k.sunColor);
    hemi.current.intensity = k.hemi;
    const day = tod < 0.55 || tod > 0.95;
    const a = day ? ((tod + 0.05) % 1) / 0.6 : (tod - 0.55) / 0.45;
    sun.current.position.set(Math.cos(a * Math.PI) * 14, 9 + Math.sin(a * Math.PI) * 9, 9);
    const n = nightness(tod);
    night.value = n;
    glow.window.emissiveIntensity = n * 1.8;
    glow.lamp.emissiveIntensity = 0.25 + n * 2.2;
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#fff7ea', '#8fae6a', 1.2]} />
      <directionalLight
        ref={sun}
        castShadow
        position={[10, 16, 9]}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-far={60}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Residents

const ACTION: Record<Glyph, ChogAction> = {
  wood: 'chop',
  stone: 'mine',
  food: 'harvest',
  build: 'hammer',
  rest: 'sleep',
  social: 'wave',
  paused: 'paused',
  frozen: 'frozen',
  home: 'idle',
  ruins: 'idle',
};

interface Placement {
  agent: AgentState;
  target: [number, number];
  face: number;
  /** Asleep at home: the Chog walks to its door and goes inside. */
  indoors: boolean;
}

/** Where things sit on a lot (local coordinates; the gate is at +Z). */
function lotLayout(agent: AgentState): { tent: [number, number, number] | null; scaffold: [number, number, number]; door: [number, number] } {
  if (agent.homeLevel > 0) return { tent: null, scaffold: [0.55, 0.06, -0.3], door: [-0.18, 0.5] };
  // No house yet: the tent shares the lot with the build site while one is going up.
  const tent: [number, number, number] = agent.construction ? [-0.4, 0.06, -0.32] : [-0.06, 0.06, -0.14];
  return { tent, scaffold: [0.32, 0.06, -0.12], door: [tent[0], tent[2] + 0.42] };
}

/** Never turn fully away from the default camera: at most a side profile, so faces stay readable. */
function towardsViewer(yaw: number): number {
  const limit = Math.PI * 0.55;
  const a = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  return Math.max(-limit, Math.min(limit, a));
}

function placements(world: WorldState): Placement[] {
  const result: Placement[] = [];
  for (const { agent, location, slot } of standings(world).values()) {
    if (location.kind === 'plot') {
      const lot = PLOTS[location.plotId]!;
      if (activityOf(agent, world).glyph === 'rest') {
        const [dx, dz] = lotLayout(agent).door;
        result.push({ agent, target: local(lot.x, lot.z, lot.r, dx, dz), face: towardsViewer(lot.r + Math.PI), indoors: true });
        continue;
      }
      const building = !!agent.construction;
      // Beside the gate, outside the fence; while building, turned to face the house.
      const target = local(lot.x, lot.z, lot.r, 0.62 + slot * 0.6, 1.25);
      result.push({ agent, target, face: towardsViewer(lot.r + (building ? Math.PI : 0.3)), indoors: false });
      continue;
    }
    const { target, face } = placeSpot(location.placeId, slot);
    result.push({ agent, target, face, indoors: false });
  }
  return result;
}

/** Gap between neighbours working a site, and between rows of workers (a Chog is about 1.1 units wide). */
const SITE_SPACING = 1.75;
const SITE_ROW = 1.5;

/** Where the `slot`-th visitor stands at a place, and which way it faces. */
function placeSpot(placeId: PlaceId, slot: number): { target: [number, number]; face: number } {
  const layout = PLACES[placeId];
  let target: [number, number];
  if (layout.ring) {
    const a = (slot / 6) * Math.PI * 2 + Math.PI / 2;
    const r = layout.ring + Math.floor(slot / 6) * 0.45;
    target = [layout.anchor[0] + Math.cos(a) * r, layout.anchor[1] + Math.sin(a) * r];
  } else if (layout.rows) {
    target = [layout.anchor[0] - 1.6 + (slot % 4) * 1.15, layout.anchor[1] + Math.floor(slot / 4) * 1.15];
  } else {
    // An arc around the site with elbow room between workers, so a busy quarry doesn't become a pile.
    const ax = layout.anchor[0] - layout.pos[0];
    const az = layout.anchor[1] - layout.pos[1];
    const row = Math.floor(slot / 5);
    const radius = Math.hypot(ax, az) + row * SITE_ROW;
    const order = slot % 5;
    const side = order === 0 ? 0 : (order % 2 ? -1 : 1) * Math.ceil(order / 2);
    const a = Math.atan2(ax, az) + side * (SITE_SPACING / radius) + row * (SITE_SPACING / 2 / radius);
    target = [layout.pos[0] + Math.sin(a) * radius, layout.pos[1] + Math.cos(a) * radius];
  }
  const toward = layout.face === 'site' ? Math.atan2(layout.pos[0] - target[0], layout.pos[1] - target[1]) : layout.face;
  return { target, face: towardsViewer(toward) };
}

interface VillagerPlacement {
  citizen: CitizenState;
  target: [number, number];
  face: number;
  indoors: boolean;
  glyph: Glyph;
}

/** Villagers stand after the Chogs already at a place, so nobody overlaps. */
function villagerPlacements(world: WorldState): VillagerPlacement[] {
  const taken = new Map<PlaceId, number>();
  for (const { location } of standings(world).values()) {
    if (location.kind === 'place') taken.set(location.placeId, (taken.get(location.placeId) ?? 0) + 1);
  }
  const result: VillagerPlacement[] = [];
  for (const citizen of [...world.citizens].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const lot = LOTS[citizen.lotId];
    if (!lot) continue;
    if (citizen.location.kind === 'lot') {
      const asleep = citizenAsleep(citizen, world.tick);
      const target = asleep ? local(lot.x, lot.z, lot.r, -0.06, 0.3) : local(lot.x, lot.z, lot.r, 0.62, 1.25);
      result.push({ citizen, target, face: towardsViewer(lot.r + 0.3), indoors: asleep, glyph: asleep ? 'rest' : 'home' });
      continue;
    }
    const placeId = citizen.location.placeId;
    const slot = taken.get(placeId) ?? 0;
    taken.set(placeId, slot + 1);
    const { target, face } = placeSpot(placeId, slot);
    result.push({ citizen, target, face, indoors: false, glyph: GATHER_SITES[placeId]?.output ?? 'home' });
  }
  return result;
}

const villagerLooks = new Map<string, Appearance>();
function villagerAppearance(citizen: CitizenState): Appearance {
  const id = `${citizen.key}|${citizen.look.Skin}|${citizen.look.Head}|${citizen.look.Body}|${citizen.look.Eyes}`;
  let a = villagerLooks.get(id);
  if (!a) villagerLooks.set(id, (a = appearanceOf(citizen.look)));
  return a;
}

// ---------------------------------------------------------------------------------------------

export interface Scene3DProps {
  world: WorldState;
  tick: string;
  nextDueAt: string;
  selectedKey: string | null;
  focusNonce: number;
  reducedMotion: boolean;
  onSelect: (key: string) => void;
  /** A villager was clicked (in the citizens' district or at work). */
  onSelectCitizen?: (key: string) => void;
  /** Who rules each Cult place (server mode). Absent: plain place names. */
  rulers?: Rulers | null;
  /** Recent committed events, for pops over whoever earned or gave something. */
  events?: readonly CityEvent[];
  /** The viewer's own Chogs and villager: their earnings always pop. */
  mine?: ReadonlySet<string>;
  /** Confetti to set off (homes finished, projects built, the village growing). */
  bursts?: readonly Celebration[];
  onBurstDone?: (id: string) => void;
}

/** Before the opening shot takes over: anywhere sensible, so the first frame isn't empty. */
const FIRST_FRAME: [number, number, number] = [0.6, 40, 30];

const NOBODY: ReadonlySet<string> = new Set();
/** A stable number from a celebration's id, so its confetti falls the same way on every render. */
const seedOf = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 100003, 7);
/** Place names are full size within ~30 units and shrink beyond, to no less than 55%. */
const LABEL_SCALE = 30;

export default function Scene3D({ world, tick, nextDueAt, selectedKey, focusNonce, reducedMotion, onSelect, onSelectCitizen, rulers, events = [], mine = NOBODY, bursts = [], onBurstDone }: Scene3DProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const clock = useRef({ tick, nextDueAt });
  clock.current = { tick, nextDueAt };

  const placed = useMemo(() => placements(world), [world]);
  const villagers = useMemo(() => villagerPlacements(world), [world]);
  const spots = useMemo(
    () => new Map<string, XZ>([...placed.map((p) => [p.agent.key, p.target] as const), ...villagers.map((v) => [v.citizen.key, v.target] as const)]),
    [placed, villagers],
  );
  const built = useMemo(() => builtUp(world), [world]);
  const districtsInUse = useMemo(() => new Set(DISTRICTS.filter((d) => d.plots.some((id) => built.plots.has(id))).map((d) => d.id)), [built]);
  // The ground the town covers: the village heart plus every district in use.
  const town = useMemo<TownFrame>(() => {
    const f: TownFrame = { x: [...VILLAGE_FRAME.x], z: [...VILLAGE_FRAME.z] };
    for (const d of DISTRICTS) {
      if (!districtsInUse.has(d.id)) continue;
      const along = d.yaw === 0;
      const [hx, hz] = along ? [DISTRICT_SIZE.length / 2, DISTRICT_SIZE.width / 2] : [DISTRICT_SIZE.width / 2, DISTRICT_SIZE.length / 2];
      f.x = [Math.min(f.x[0], d.centre[0] - hx), Math.max(f.x[1], d.centre[0] + hx)];
      f.z = [Math.min(f.z[0], d.centre[1] - hz), Math.max(f.z[1], d.centre[1] + hz)];
    }
    return f;
  }, [districtsInUse]);
  const lotOwners = useMemo(() => new Map(world.citizens.map((c) => [c.lotId, c])), [world]);
  const occupants = useMemo(() => new Map(world.agents.map((a) => [a.plotId, a])), [world]);
  const selected = world.agents.find((a) => a.key === selectedKey);

  // The camera's shot: the village, or following whoever was just picked.
  const [shot, setShot] = useState<CameraShot>({ kind: 'village', n: 0 });
  const follow = useCallback((key: string) => setShot((s) => ({ kind: 'follow', key, n: s.n + 1 })), []);
  const villageView = useCallback(() => setShot((s) => ({ kind: 'village', n: s.n + 1 })), []);
  useEffect(() => {
    if (focusNonce > 0 && selectedKey) follow(selectedKey);
  }, [focusNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) || document.querySelector('[role="dialog"]')) return;
      villageView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [villageView]);
  const followedName =
    shot.kind === 'follow' ? world.agents.find((a) => a.key === shot.key)?.name ?? world.citizens.find((c) => c.key === shot.key)?.name ?? null : null;

  return (
    <OverlayContext.Provider value={overlay}>
      <div ref={overlay} className="overlay3d" />
      <Canvas
        flat
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ position: FIRST_FRAME, fov: 32, near: 0.5, far: 220 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        aria-label="3D view of the village"
      >
        <DayCycle clock={clock} />
        <Water />
        <Island />
        <District3D rows={rowsInUse(built.lots)} />
        {DISTRICTS.filter((d) => districtsInUse.has(d.id)).map((d) => (
          <GrowthDistrict3D key={d.id} district={d} />
        ))}
        <AccessRoads districts={districtsInUse} />
        {world.lots.map((lot) => {
          const layout = LOTS[lot.id];
          if (!layout || !built.lots.has(lot.id)) return null;
          const owner = lotOwners.get(lot.id);
          const fur = owner ? villagerAppearance(owner).skin.fur : undefined;
          return (
            <group key={lot.id} position={[layout.x, 0, layout.z]} rotation-y={layout.r} onClick={owner && onSelectCitizen ? (e) => (e.stopPropagation(), onSelectCitizen(owner.key)) : undefined}>
              <Lot3D vacant={!owner} flag={fur} raised={!!owner} highlighted={false} />
              {owner ? (
                <group position={[-0.06, 0.06, -0.14]}>
                  <Tent3D trim={fur!} />
                </group>
              ) : null}
            </group>
          );
        })}
        <Projects3D world={world} />
        <Roads />
        <Stream />
        <Scenery />
        <Clouds />

        {world.places.map((place) => {
          const layout = PLACES[place.id];
          const ruler = rulers?.places[place.id]?.ruler ?? null;
          return (
            <group key={place.id} position={[layout.pos[0], 0, layout.pos[1]]}>
              <group rotation-y={layout.r}>
                <Place3D id={place.id} {...(place.id === 'plaza' ? { centre: fountainCentre(world) } : {})} />
              </group>
              <ScaledHtml
                portal={overlay as React.RefObject<HTMLElement>}
                position={[0, place.id === 'forest' || place.id === 'farm' ? 2.35 : 2.0, 0]}
                factor={LABEL_SCALE}
                min={0.55}
                priority={LABEL_PRIORITY.place}
                center
                zIndexRange={[10, 0]}
                style={{ pointerEvents: 'none' }}
              >
                <div className="label3d">
                  {placeName(world, place.id)}
                  {ruler ? <span className={`label3d-ruler ruler--${ruler}`}>{FACTION_SHORT[ruler]}</span> : null}
                </div>
              </ScaledHtml>
            </group>
          );
        })}

        {world.plots.map((plot) => {
          const layout = PLOTS[plot.id];
          if (!layout || !built.plots.has(plot.id)) return null;
          const occupant = occupants.get(plot.id);
          const { x, z, r } = layout;
          const c = occupant?.construction;
          const total = c ? recipeForLevel(c.targetLevel)?.buildTicks ?? 1 : 1;
          const burned = occupant?.control.kind === 'burned';
          return (
            <group
              key={plot.id}
              position={[x, 0, z]}
              rotation-y={r}
              onClick={
                occupant
                  ? (e) => {
                      e.stopPropagation();
                      onSelect(occupant.key);
                    }
                  : undefined
              }
            >
              <Lot3D
                vacant={!occupant}
                flag={occupant ? scarfFor(occupant.identity.tokenId) : undefined}
                raised={!!occupant && occupant.policy.active && !burned}
                highlighted={selected?.plotId === plot.id}
              />
              {occupant && !burned ? (
                <group position={[-0.08, 0.06, -0.12]}>
                  <House3D style={occupant.homeStyle} level={occupant.homeLevel} />
                </group>
              ) : null}
              {occupant && !burned && lotLayout(occupant).tent ? (
                <group position={lotLayout(occupant).tent!} scale={c ? 0.78 : 1}>
                  <Tent3D trim={scarfFor(occupant.identity.tokenId)} />
                </group>
              ) : null}
              {burned ? <Ruins3D /> : null}
              {c ? (
                <group position={lotLayout(occupant!).scaffold}>
                  <Scaffold3D progress={(total - c.remainingTicks) / total} compact />
                </group>
              ) : null}
            </group>
          );
        })}

        {placed.map(({ agent, target, face, indoors }) => {
          const activity = activityOf(agent, world);
          return (
            <Chog3D
              key={agent.key}
              seed={Number(BigInt(agent.identity.tokenId) % 997n)}
              appearance={appearanceFor(agent)}
              target={target}
              face={face}
              action={ACTION[activity.glyph]}
              glyph={activity.glyph}
              name={agent.name}
              selected={agent.key === selectedKey}
              reducedMotion={reducedMotion}
              indoors={indoors}
              trackKey={agent.key}
              mine={mine.has(agent.key)}
              onSelect={() => onSelect(agent.key)}
            />
          );
        })}

        {villagers.map(({ citizen, target, face, indoors, glyph }) => (
          <Chog3D
            key={citizen.key}
            seed={parseInt(citizen.address.slice(-3), 16) % 997}
            appearance={villagerAppearance(citizen)}
            target={target}
            face={face}
            action={ACTION[glyph]}
            glyph={glyph}
            name={citizen.name}
            selected={false}
            reducedMotion={reducedMotion}
            indoors={indoors}
            trackKey={citizen.key}
            mine={mine.has(citizen.key)}
            onSelect={() => {
              follow(citizen.key);
              onSelectCitizen?.(citizen.key);
            }}
          />
        ))}

        {bursts.map((b) => {
          const at = b.burst?.at;
          const spot: [number, number, number] | null = !at
            ? null
            : at.kind === 'plot'
              ? PLOTS[at.plotId]
                ? [PLOTS[at.plotId]!.x, 1.1, PLOTS[at.plotId]!.z]
                : null
              : at.kind === 'project'
                ? [PROJECT_SITES[at.id].pos[0], 1.2, PROJECT_SITES[at.id].pos[1]]
                : [PLACES.plaza.pos[0], 1.4, PLACES.plaza.pos[1]];
          if (!spot) return null;
          return <Burst3D key={b.id} at={spot} big={b.burst!.big} seed={seedOf(b.id)} onDone={() => onBurstDone?.(b.id)} />;
        })}

        <Declutter />
        <Pops3D events={events} world={world} mine={mine} watching={selectedKey} where={(key) => spots.get(key) ?? null} />

        <OrbitControls
          makeDefault
          target={VILLAGE_CENTRE}
          enableDamping
          dampingFactor={0.08}
          minDistance={6}
          maxDistance={85}
          minPolarAngle={0.3}
          maxPolarAngle={1.18}
          zoomSpeed={0.8}
        />
        <CameraDirector town={town} shot={shot} reducedMotion={reducedMotion} onLetGo={() => setShot((s) => ({ kind: 'free', n: s.n + 1 }))} />
      </Canvas>
      {followedName ? (
        <div className="camera-chip" role="status">
          <span className="camera-chip-dot" aria-hidden="true" />
          <span>
            Following <strong>{followedName}</strong>
          </span>
          <button type="button" className="camera-chip-button" onClick={villageView}>
            Village view <kbd>Esc</kbd>
          </button>
        </div>
      ) : null}
    </OverlayContext.Provider>
  );
}
