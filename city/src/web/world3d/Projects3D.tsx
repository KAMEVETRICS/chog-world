// Shared projects, built in the village as people chip in. Nothing shows until the first gift; then the
// site fills in with the funding (stones laid, posts raised, goods stacked) and the finished building
// appears the tick the project completes. View only: the simulation tracks funds, never geometry.
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { PROJECT_IDS, type ProjectId, type WorldState } from '../../shared/contracts';
import { PROJECTS } from '../../shared/rules';
import { gable, geo } from './geometry';
import { glow, PALETTE as C, toon } from './materials';
import { Lantern } from './models';
import { Part } from './parts';
import { PROJECT_SITES } from './layout';

const INKED = 0.02;
const { damp } = THREE.MathUtils;

/** How far along a project is, 0..1: the share of everything it needs that has been given. */
export function projectProgress(world: WorldState, id: ProjectId): number {
  const needs = PROJECTS[id].needs;
  const given = world.projects[id].given;
  const assets = (['wood', 'stone', 'food', 'coins'] as const).filter((a) => needs[a] > 0);
  const total = assets.reduce((sum, a) => sum + needs[a], 0);
  const have = assets.reduce((sum, a) => sum + Math.min(needs[a], given[a]), 0);
  return total ? have / total : 0;
}

/** Grows a group's height towards `to`, so new funding visibly builds up instead of popping in. */
function useRise(to: number) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    const g = ref.current;
    if (g) g.scale.y = damp(g.scale.y, Math.max(0.02, to), 2.5, dt);
  });
  return ref;
}

// ---------------------------------------------------------------------------------------------
// Plaza Fountain: an octagonal stone basin around the Plaza's lantern.

const RING_STONES = 16;
const BASIN_R = 0.66;

function FountainWater() {
  const jets = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    jets.current.children.forEach((drop, i) => {
      const t = (clock.elapsedTime * 0.9 + i / jets.current.children.length) % 1;
      const a = (i / jets.current.children.length) * Math.PI * 2;
      const r = 0.12 + t * 0.34;
      drop.position.set(Math.cos(a) * r, 0.62 + Math.sin(t * Math.PI) * 0.16 - t * 0.3, Math.sin(a) * r);
      drop.scale.setScalar(1 - t * 0.5);
    });
  });
  return (
    <group ref={jets}>
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} geometry={geo.sphere(0.04, 6, 4)} material={toon('#d9f4f8')} />
      ))}
    </group>
  );
}

function Fountain({ progress, built }: { progress: number; built: boolean }) {
  const laid = built ? RING_STONES : Math.round(progress * RING_STONES);
  return (
    <group>
      {built ? (
        <>
          <Part geo={geo.cylinder(BASIN_R, BASIN_R + 0.04, 0.24, 8)} color={C.stone} position={[0, 0.12, 0]} outline={INKED} />
          {/* water sits just under a raised rim, so it reads from the usual camera angle */}
          <mesh geometry={geo.cylinder(BASIN_R - 0.07, BASIN_R - 0.07, 0.02, 8)} material={toon(C.water)} position={[0, 0.25, 0]} />
          <mesh geometry={geo.torus(BASIN_R - 0.035, 0.045, 4, 8)} material={toon(C.cobble)} position={[0, 0.27, 0]} rotation-x={Math.PI / 2} rotation-z={Math.PI / 8} />
          <Part geo={geo.cylinder(0.1, 0.14, 0.42, 8)} color={C.stoneDark} position={[0, 0.35, 0]} outline={0.012} />
          <Part geo={geo.cylinder(0.3, 0.16, 0.08, 8)} color={C.stone} position={[0, 0.6, 0]} outline={0.012} />
          <mesh geometry={geo.cylinder(0.26, 0.26, 0.015, 8)} material={toon(C.water)} position={[0, 0.645, 0]} />
          <FountainWater />
          <group position={[0, 0.62, 0]} scale={0.6}>
            <Lantern />
          </group>
        </>
      ) : (
        <>
          <Lantern />
          {/* the basin laid stone by stone as gifts come in */}
          {Array.from({ length: laid }, (_, i) => {
            const a = (i / RING_STONES) * Math.PI * 2;
            return (
              <Part
                key={i}
                geo={geo.box(0.26, 0.16, 0.14)}
                color={i % 3 ? C.stone : C.stoneDark}
                position={[Math.sin(a) * BASIN_R, 0.08, Math.cos(a) * BASIN_R]}
                rotation-y={a}
                outline={0.01}
              />
            );
          })}
          {/* chalk line marking where the rest will go */}
          <mesh geometry={geo.torus(BASIN_R, 0.012, 3, 40)} material={toon('#f8f3e6')} position={[0, 0.065, 0]} rotation-x={Math.PI / 2} />
        </>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Market Hall: a timber hall with a striped awning, stalls and stacked goods.

const HALL = { w: 2.0, d: 1.25, post: 0.95 };
const POSTS: Array<[number, number]> = [-1, 0, 1].flatMap((i) => [
  [(i * HALL.w) / 2.2, -HALL.d / 2 + 0.08] as [number, number],
  [(i * HALL.w) / 2.2, HALL.d / 2 - 0.08] as [number, number],
]);

function Crate({ color, position }: { color: string; position: [number, number, number] }) {
  return (
    <group position={position}>
      <Part geo={geo.box(0.22, 0.16, 0.18)} color={C.wood} position={[0, 0.08, 0]} outline={0.01} />
      <mesh geometry={geo.box(0.18, 0.05, 0.14)} material={toon(color)} position={[0, 0.18, 0]} />
    </group>
  );
}

function Awning() {
  const stripes = 8;
  return (
    <group position={[0, HALL.post, 0]}>
      {Array.from({ length: stripes }, (_, i) => (
        <mesh
          key={i}
          geometry={gable(HALL.w / stripes + 0.002, 0.42, HALL.d + 0.3)}
          material={toon(i % 2 ? '#f6efe0' : '#c4573e')}
          position={[-HALL.w / 2 + (i + 0.5) * (HALL.w / stripes), 0, 0]}
          castShadow
        />
      ))}
      <mesh geometry={geo.box(HALL.w + 0.04, 0.05, 0.05)} material={toon(C.woodDark)} position={[0, 0.42, 0]} />
    </group>
  );
}

function MarketHall({ progress, built }: { progress: number; built: boolean }) {
  const frame = useRise(built ? 1 : progress);
  return (
    <group>
      <Part geo={geo.box(HALL.w + 0.2, 0.1, HALL.d + 0.2)} color={C.cobble} position={[0, 0.05, 0]} outline={0.012} />
      <group ref={frame} position={[0, 0.1, 0]} scale-y={0.02}>
        {POSTS.map(([x, z]) => (
          <Part key={`${x},${z}`} geo={geo.box(0.08, HALL.post, 0.08)} color={C.woodDark} position={[x, HALL.post / 2, z]} outline={0.01} />
        ))}
      </group>
      {built ? (
        <group position={[0, 0.1, 0]}>
          <Awning />
          {/* the counter facing the Plaza, with each good the market trades */}
          <Part geo={geo.box(HALL.w - 0.3, 0.3, 0.22)} color={C.wood} position={[0, 0.15, HALL.d / 2 - 0.25]} outline={0.012} />
          <Crate color={C.wood} position={[-0.55, 0.3, HALL.d / 2 - 0.25]} />
          <Crate color={C.stone} position={[0, 0.3, HALL.d / 2 - 0.25]} />
          <Crate color="#e0b23a" position={[0.55, 0.3, HALL.d / 2 - 0.25]} />
          {/* a hanging lamp, lit at night */}
          <mesh geometry={geo.box(0.12, 0.14, 0.12)} material={glow.lamp} position={[0, HALL.post - 0.12, 0]} />
          {/* barrels and sacks out back */}
          <Part geo={geo.cylinder(0.12, 0.12, 0.3, 10)} color={C.wood} position={[-0.7, 0.15, -0.3]} outline={0.01} />
          <Part geo={geo.sphere(0.13, 8, 6)} color="#e6d3a3" position={[0.7, 0.12, -0.3]} scale={[1, 0.8, 1]} outline={0.01} />
        </group>
      ) : (
        <group position={[0, 0.1, 0]}>
          {/* timber waiting to go up, fewer as the frame rises */}
          {Array.from({ length: Math.max(1, Math.round((1 - progress) * 4)) }, (_, i) => (
            <Part key={i} geo={geo.box(1.1, 0.06, 0.08)} color={C.wood} position={[-0.2, 0.04 + i * 0.065, HALL.d / 2 + 0.35]} rotation-y={0.08 * i} outline={0.008} />
          ))}
        </group>
      )}
    </group>
  );
}

/** Every shared project that has been started, at its site. The Fountain is drawn by the Plaza (see `fountainCentre`). */
export function Projects3D({ world }: { world: WorldState }) {
  return (
    <>
      {PROJECT_IDS.filter((id) => id !== 'fountain').map((id) => {
        const progress = projectProgress(world, id);
        const built = world.projects[id].completedTick !== null;
        if (!built && progress === 0) return null;
        const site = PROJECT_SITES[id];
        return (
          <group key={id} position={[site.pos[0], 0, site.pos[1]]} rotation-y={site.r}>
            <MarketHall progress={progress} built={built} />
          </group>
        );
      })}
    </>
  );
}

/** What stands at the Plaza's centre: the lantern alone, the Fountain going up around it, or the finished Fountain. */
export function fountainCentre(world: WorldState): React.ReactNode | undefined {
  const progress = projectProgress(world, 'fountain');
  const built = world.projects.fountain.completedTick !== null;
  return built || progress > 0 ? <Fountain progress={progress} built={built} /> : undefined;
}
