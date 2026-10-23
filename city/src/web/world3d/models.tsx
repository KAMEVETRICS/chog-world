// Low-poly, cel-shaded world models. Every model sits on y=0 and faces +Z (towards the camera).
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { HomeStyle, PlaceId } from '../../shared/contracts';
import { gable, geo } from './geometry';
import { glow, night, PALETTE as C, toon } from './materials';
import { Part } from './parts';

const INKED = 0.022;
const { damp } = THREE.MathUtils;

function Window({ position, size = [0.16, 0.17] }: { position: [number, number, number]; size?: [number, number] }) {
  return (
    <group position={position}>
      <mesh geometry={geo.box(size[0] + 0.05, size[1] + 0.05, 0.03)} material={toon(C.woodDark)} />
      <mesh geometry={geo.box(size[0], size[1], 0.04)} material={glow.window} />
    </group>
  );
}

function Door({ position, w = 0.2, h = 0.34 }: { position: [number, number, number]; w?: number; h?: number }) {
  return (
    <group position={position}>
      <Part geo={geo.box(w, h, 0.04)} color={C.wood} outline={0.012} />
      <mesh geometry={geo.sphere(0.018, 6, 4)} material={toon('#e0b84a')} position={[w * 0.3, 0, 0.03]} />
    </group>
  );
}

/** Rising puffs from a chimney; brighter against the night sky. */
function Smoke({ position }: { position: [number, number, number] }) {
  const puffs = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    puffs.current.children.forEach((puff, i) => {
      const t = (clock.elapsedTime * 0.35 + i / 3) % 1;
      puff.position.set(Math.sin(t * 4 + i) * 0.06, t * 0.75, -t * 0.12);
      puff.scale.setScalar(0.06 + t * 0.12);
      ((puff as THREE.Mesh).material as THREE.Material).opacity = 0.7 * (1 - t);
    });
  });
  return (
    <group ref={puffs} position={position}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} geometry={geo.icosahedron(1, 0)}>
          <meshBasicMaterial color="#f7f3ec" transparent opacity={0.6} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Homes. Levels 1-2 change the house itself; levels 3-5 add to it (porch, wing, tower...), so every
// upgrade is visible from across the village and a level-5 home reads as the grandest on the street.

/** A pennant on a pole: crowns the top level of every style. */
function Pennant({ position, height = 0.42 }: { position: [number, number, number]; height?: number }) {
  const flag = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => void (flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.25));
  return (
    <group position={position}>
      <mesh geometry={geo.cylinder(0.012, 0.012, height, 5)} material={toon(C.woodDark)} position={[0, height / 2, 0]} />
      <mesh ref={flag} geometry={geo.box(0.18, 0.1, 0.01)} material={toon(C.chog)} position={[0.09, height - 0.06, 0]} />
    </group>
  );
}

/** A water wheel turning on its axle (the mill). */
function WaterWheel({ position }: { position: [number, number, number] }) {
  const wheel = useRef<THREE.Group>(null!);
  useFrame((_, dt) => void (wheel.current.rotation.x -= dt * 0.7));
  return (
    <group position={position}>
      <group ref={wheel}>
        <Part geo={geo.torus(0.36, 0.04, 5, 18)} color="#c58a57" rotation-y={Math.PI / 2} outline={0.012} />
        <Part geo={geo.torus(0.2, 0.025, 4, 14)} color="#c58a57" rotation-y={Math.PI / 2} />
        {Array.from({ length: 10 }, (_, i) => (
          <mesh key={i} geometry={geo.box(0.16, 0.06, 0.74)} material={toon(i % 2 ? C.wood : C.woodDark)} rotation-x={(i / 10) * Math.PI} />
        ))}
      </group>
      <Part geo={geo.box(0.2, 0.12, 0.9)} color={C.stone} position={[0, -0.3, 0]} outline={0.01} />
      <mesh geometry={geo.cylinder(0.04, 0.04, 0.2, 6)} material={toon(C.slate)} rotation-z={Math.PI / 2} position={[0.08, 0, 0]} />
    </group>
  );
}

function Cottage({ level }: { level: number }) {
  if (level >= 2) {
    return (
      <group>
        <Part geo={geo.box(1.12, 0.98, 0.9)} color={C.plaster} position={[0, 0.49, 0]} outline={INKED} />
        <Part geo={geo.box(1.16, 0.07, 0.94)} color={C.woodDark} position={[0, 0.5, 0]} />
        <Part geo={gable(1.34, 0.6, 1.12)} color={C.roof} position={[0, 0.97, 0]} outline={INKED} />
        <Part geo={geo.box(0.17, 0.42, 0.17)} color="#9a5a46" position={[0.32, 1.27, -0.18]} outline={0.015} />
        <Smoke position={[0.32, 1.5, -0.18]} />
        <Door position={[0, 0.2, 0.46]} w={0.22} h={0.38} />
        <Window position={[-0.33, 0.27, 0.46]} />
        <Window position={[0.33, 0.27, 0.46]} />
        <Window position={[-0.27, 0.74, 0.46]} />
        <Window position={[0.27, 0.74, 0.46]} />
        <Part geo={geo.box(0.26, 0.07, 0.09)} color={C.wood} position={[-0.33, 0.15, 0.5]} />
        {[-0.41, -0.33, -0.25].map((x, i) => (
          <mesh key={x} geometry={geo.sphere(0.035, 6, 4)} material={toon(['#e98aa6', '#f4d35e', '#ffffff'][i]!)} position={[x, 0.21, 0.52]} />
        ))}
        {level >= 3 ? (
          // Porch cottage: a covered porch over the door and a dormer in the roof.
          <group>
            {[-0.24, 0.24].map((x) => (
              <mesh key={x} geometry={geo.box(0.045, 0.44, 0.045)} material={toon(C.woodDark)} position={[x, 0.22, 0.66]} castShadow />
            ))}
            <Part geo={geo.box(0.62, 0.05, 0.3)} color={C.roofDark} position={[0, 0.46, 0.6]} rotation-x={0.22} outline={0.012} />
            <group position={[-0.26, 1.19, 0.34]}>
              <Part geo={geo.box(0.26, 0.24, 0.2)} color={C.plaster} outline={0.012} />
              <Part geo={gable(0.32, 0.16, 0.28)} color={C.roof} position={[0, 0.12, 0]} outline={0.012} />
              <Window position={[0, -0.01, 0.1]} size={[0.12, 0.12]} />
            </group>
          </group>
        ) : null}
        {level >= 4 ? (
          // Farmhouse: a stone footing and a lean-to shed with a woodpile.
          <group>
            <Part geo={geo.box(1.17, 0.16, 0.95)} color={C.stone} position={[0, 0.08, 0]} />
            <Part geo={geo.box(0.26, 0.5, 0.6)} color={C.wood} position={[0.69, 0.25, -0.05]} outline={0.012} />
            <Part geo={geo.box(0.32, 0.04, 0.68)} color={C.roofDark} position={[0.7, 0.53, -0.05]} rotation-z={-0.35} outline={0.01} />
            {[0, 1, 2].map((i) => (
              <mesh key={i} geometry={geo.cylinder(0.05, 0.05, 0.3, 6)} material={toon(i % 2 ? C.wood : '#c58a57')} position={[0.7, 0.07 + i * 0.09, 0.33]} rotation-z={Math.PI / 2} />
            ))}
            {/* hay bales by the shed: the farm in farmhouse */}
            {[
              [0.5, 0.11, 0.62, 0.3],
              [0.72, 0.11, 0.6, -0.2],
              [0.61, 0.3, 0.6, 0.1],
            ].map(([x, y, z, r]) => (
              <Part key={`${x}${y}`} geo={geo.cylinder(0.11, 0.11, 0.2, 10)} color={C.wheat} position={[x!, y!, z!]} rotation={[0, r!, Math.PI / 2]} outline={0.01} />
            ))}
          </group>
        ) : null}
        {level >= 5 ? (
          // Manor: a round tower at the back, lit at night, flying the village pennant.
          <group position={[-0.46, 0, -0.28]}>
            <Part geo={geo.cylinder(0.2, 0.23, 2.05, 10)} color={C.plaster} position={[0, 1.025, 0]} outline={INKED} />
            <Part geo={geo.cylinder(0.24, 0.24, 0.08, 10)} color={C.stone} position={[0, 2.05, 0]} outline={0.012} />
            <Part geo={geo.cone(0.29, 0.46, 10)} color={C.roof} position={[0, 2.32, 0]} outline={INKED} />
            <Window position={[0, 1.75, 0.2]} size={[0.1, 0.15]} />
            <Pennant position={[0, 2.54, 0]} />
          </group>
        ) : null}
      </group>
    );
  }
  return (
    <group>
      <Part geo={geo.box(0.88, 0.6, 0.76)} color={C.plaster} position={[0, 0.3, 0]} outline={INKED} />
      <Part geo={gable(1.06, 0.48, 0.98)} color={C.roof} position={[0, 0.6, 0]} outline={INKED} />
      <Part geo={geo.box(0.13, 0.28, 0.13)} color="#9a5a46" position={[0.24, 0.84, -0.14]} outline={0.014} />
      <Door position={[-0.12, 0.17, 0.39]} />
      <Window position={[0.22, 0.34, 0.39]} />
    </group>
  );
}

function Gear({ position, radius = 0.17 }: { position: [number, number, number]; radius?: number }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, dt) => void (ref.current.rotation.z -= dt * 0.8));
  return (
    <group ref={ref} position={position}>
      <Part geo={geo.cylinder(radius, radius, 0.05, 10)} color="#e0b84a" rotation-x={Math.PI / 2} outline={0.012} />
      {Array.from({ length: 8 }, (_, i) => (
        <mesh
          key={i}
          geometry={geo.box(0.07, 0.07, 0.05)}
          material={toon('#c99a2e')}
          position={[Math.cos((i / 8) * Math.PI * 2) * radius, Math.sin((i / 8) * Math.PI * 2) * radius, 0]}
          rotation-z={(i / 8) * Math.PI * 2}
        />
      ))}
      <mesh geometry={geo.cylinder(0.05, 0.05, 0.07, 8)} material={toon(C.slate)} rotation-x={Math.PI / 2} />
    </group>
  );
}

function SawtoothRoof({ width, depth, y, teeth }: { width: number; depth: number; y: number; teeth: number }) {
  const step = width / teeth;
  return (
    <group position={[0, y, 0]}>
      <Part geo={geo.box(width + 0.08, 0.07, depth + 0.08)} color={C.slate} position={[0, 0.035, 0]} outline={INKED} />
      {Array.from({ length: teeth }, (_, i) => (
        <group key={i} position={[-width / 2 + step * (i + 0.5), 0.07, 0]}>
          <Part geo={gable(step * 0.9, 0.24, depth * 0.95)} color="#5d6b7b" rotation-y={Math.PI / 2} outline={0.014} />
        </group>
      ))}
    </group>
  );
}

function WorkshopHome({ level }: { level: number }) {
  const big = level >= 2;
  const w = big ? 1.2 : 0.92;
  const h = big ? 0.86 : 0.6;
  return (
    <group>
      <Part geo={geo.box(w, h, 0.8)} color={C.stone} position={[0, h / 2, 0]} outline={INKED} />
      <SawtoothRoof width={w} depth={0.8} y={h} teeth={big ? 3 : 2} />
      <Part geo={geo.box(0.36, 0.4, 0.04)} color={C.wood} position={[-0.12, 0.2, 0.41]} outline={0.012} />
      <mesh geometry={geo.box(0.012, 0.4, 0.05)} material={toon(C.woodDark)} position={[-0.12, 0.2, 0.42]} />
      <Window position={[0.27, 0.36, 0.41]} />
      {big ? (
        <>
          <Gear position={[0.3, 0.68, 0.43]} />
          <Part geo={geo.box(0.22, 0.2, 0.22)} color={C.wood} position={[w / 2 + 0.16, 0.1, 0.18]} rotation-y={0.3} outline={0.012} />
          <Part geo={geo.box(0.16, 0.15, 0.16)} color={C.woodDark} position={[w / 2 + 0.16, 0.27, 0.18]} rotation-y={0.7} outline={0.012} />
        </>
      ) : null}
      {level >= 3 ? (
        // Forge: a tall brick chimney with smoke, and an anvil by the door.
        <group>
          <Part geo={geo.box(0.2, 0.75, 0.2)} color="#9a5a46" position={[0.42, h + 0.3, -0.24]} outline={0.014} />
          <Smoke position={[0.42, h + 0.72, -0.24]} />
          <group position={[-0.5, 0, 0.56]}>
            <Part geo={geo.box(0.1, 0.16, 0.1)} color={C.woodDark} position={[0, 0.08, 0]} />
            <Part geo={geo.box(0.22, 0.07, 0.1)} color="#3a3048" position={[0.02, 0.19, 0]} outline={0.01} />
          </group>
        </group>
      ) : null}
      {level >= 4 ? <WaterWheel position={[-w / 2 - 0.1, 0.38, 0.05]} /> : null}
      {level >= 5 ? (
        // Guildhall: a clock tower on the roof, flying the village pennant.
        <group position={[-0.1, h + 0.07, 0]}>
          <Part geo={geo.box(0.32, 0.52, 0.32)} color={C.stone} position={[0, 0.26, 0]} outline={INKED} />
          <mesh geometry={geo.cylinder(0.1, 0.1, 0.02, 14)} material={toon('#fbf3e0')} position={[0, 0.34, 0.165]} rotation-x={Math.PI / 2} />
          <mesh geometry={geo.box(0.012, 0.07, 0.01)} material={toon(C.slate)} position={[0, 0.37, 0.18]} />
          <Part geo={geo.cone(0.27, 0.32, 4)} color={C.slate} position={[0, 0.68, 0]} rotation-y={Math.PI / 4} outline={0.014} />
          <Pennant position={[0, 0.82, 0]} height={0.36} />
        </group>
      ) : null}
    </group>
  );
}

function Treehouse({ level }: { level: number }) {
  const big = level >= 2;
  const deck = big ? 0.95 : 0.72;
  return (
    <group>
      <Part geo={geo.cylinder(0.11, 0.2, deck + 0.9, 7)} color={C.wood} position={[0, (deck + 0.9) / 2, -0.08]} outline={INKED} />
      {[-0.7, 0.9, 2.4].map((a) => (
        <Part key={a} geo={geo.cone(0.06, 0.3, 5)} color={C.woodDark} position={[Math.cos(a) * 0.17, 0.08, Math.sin(a) * 0.17 - 0.08]} rotation={[Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]} />
      ))}
      <Part geo={geo.cylinder(big ? 0.5 : 0.4, big ? 0.5 : 0.4, 0.06, 10)} color={C.woodDark} position={[0, deck, 0]} outline={0.015} />
      <Part geo={geo.box(big ? 0.62 : 0.48, big ? 0.42 : 0.34, big ? 0.5 : 0.42)} color="#e8cfa4" position={[0, deck + (big ? 0.24 : 0.2), 0.02]} outline={INKED} />
      <Part geo={gable(big ? 0.74 : 0.58, 0.28, big ? 0.62 : 0.54)} color={C.roof} position={[0, deck + (big ? 0.45 : 0.37), 0.02]} outline={INKED} />
      <Window position={[0.12, deck + 0.22, big ? 0.28 : 0.24]} size={[0.13, 0.13]} />
      <group position={[0, deck + 0.95, -0.12]}>
        <Part geo={geo.icosahedron(big ? 0.62 : 0.5, 0)} color={C.leaf} outline={INKED} />
        <Part geo={geo.icosahedron(big ? 0.42 : 0.34, 0)} color={C.leafLight} position={[-0.42, -0.12, 0.12]} outline={INKED} />
        <Part geo={geo.icosahedron(big ? 0.4 : 0.32, 0)} color={C.leafLight} position={[0.44, -0.08, 0.05]} outline={INKED} />
      </group>
      {level >= 3 ? (
        // Two decks: a lower platform with a railing around the trunk.
        <group position={[0, 0.48, -0.08]}>
          <Part geo={geo.cylinder(0.58, 0.58, 0.05, 12)} color={C.wood} outline={0.012} />
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return i === 2 ? null : <mesh key={i} geometry={geo.box(0.03, 0.2, 0.03)} material={toon(C.woodDark)} position={[Math.cos(a) * 0.54, 0.1, Math.sin(a) * 0.54]} />;
          })}
          <mesh geometry={geo.torus(0.54, 0.018, 4, 24)} material={toon(C.woodDark)} position={[0, 0.2, 0]} rotation-x={Math.PI / 2} />
        </group>
      ) : null}
      {level >= 4 ? (
        // Canopy lodge: a second little hut on the lower deck.
        <group position={[-0.34, 0.5, 0.24]} rotation-y={0.35}>
          <Part geo={geo.box(0.3, 0.26, 0.26)} color="#e8cfa4" position={[0, 0.13, 0]} outline={0.014} />
          <Part geo={gable(0.36, 0.18, 0.32)} color={C.roof} position={[0, 0.26, 0]} outline={0.014} />
          <Window position={[0, 0.13, 0.135]} size={[0.1, 0.1]} />
        </group>
      ) : null}
      {level >= 5 ? (
        // Tree palace: lanterns strung through the canopy, and a lookout on top.
        <group>
          {Array.from({ length: 7 }, (_, i) => {
            const a = (i / 7) * Math.PI * 2;
            return <mesh key={i} geometry={geo.sphere(0.04, 6, 4)} material={glow.lamp} position={[Math.cos(a) * 0.62, deck + 0.78 + Math.sin(a * 2) * 0.06, Math.sin(a) * 0.5 - 0.12]} />;
          })}
          <group position={[0, deck + 1.45, -0.12]}>
            <Part geo={geo.cylinder(0.16, 0.16, 0.05, 8)} color={C.woodDark} outline={0.01} />
            <Part geo={geo.cone(0.2, 0.26, 8)} color={C.roof} position={[0, 0.26, 0]} outline={0.012} />
            {[0, 1, 2, 3].map((i) => (
              <mesh key={i} geometry={geo.box(0.025, 0.14, 0.025)} material={toon(C.woodDark)} position={[Math.cos((i * Math.PI) / 2) * 0.13, 0.08, Math.sin((i * Math.PI) / 2) * 0.13]} />
            ))}
            <Pennant position={[0, 0.36, 0]} height={0.3} />
          </group>
        </group>
      ) : null}
      {/* ladder */}
      <group position={[0.3, deck / 2, 0.36]} rotation-x={-0.12}>
        <mesh geometry={geo.box(0.025, deck, 0.025)} material={toon(C.woodDark)} position={[-0.08, 0, 0]} />
        <mesh geometry={geo.box(0.025, deck, 0.025)} material={toon(C.woodDark)} position={[0.08, 0, 0]} />
        {Array.from({ length: big ? 5 : 4 }, (_, i) => (
          <mesh key={i} geometry={geo.box(0.16, 0.02, 0.02)} material={toon(C.wood)} position={[0, -deck / 2 + 0.12 + i * 0.17, 0]} />
        ))}
      </group>
    </group>
  );
}

export function House3D({ style, level }: { style: HomeStyle; level: number }) {
  if (level <= 0) return null;
  if (style === 'workshop') return <WorkshopHome level={level} />;
  if (style === 'treehouse') return <Treehouse level={level} />;
  return <Cottage level={level} />;
}

/** Every resident's first home: a canvas tent they sleep in until a real house is built. */
export function Tent3D({ trim }: { trim: string }) {
  return (
    <group>
      {/* canvas, ridge running front to back so the doorway faces the lane */}
      <group rotation-y={Math.PI / 2}>
        <Part geo={gable(0.92, 0.62, 0.86)} color="#efe2c4" position={[0, 0, 0]} outline={INKED} />
      </group>
      <mesh geometry={geo.box(0.05, 0.05, 0.98)} material={toon(trim)} position={[0, 0.62, 0]} />
      {/* doorway, flaps tied back */}
      <mesh geometry={geo.cone(0.21, 0.44, 3)} material={toon('#3a2a2a')} position={[0, 0.2, 0.462]} scale={[1, 1, 0.08]} rotation-y={Math.PI} />
      <Part geo={geo.box(0.14, 0.4, 0.02)} color="#e2d0a8" position={[-0.17, 0.2, 0.47]} rotation-z={0.42} outline={0.01} />
      <Part geo={geo.box(0.14, 0.4, 0.02)} color="#e2d0a8" position={[0.17, 0.2, 0.47]} rotation-z={-0.42} outline={0.01} />
      {[-0.46, 0.46].map((z) => (
        <mesh key={z} geometry={geo.cylinder(0.018, 0.018, 0.72, 5)} material={toon(C.woodDark)} position={[0, 0.34, z * 1.06]} />
      ))}
      {/* guy ropes pegged into the ground */}
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={geo.box(0.012, 0.012, 0.42)} material={toon('#b8a27e')} position={[side * 0.52, 0.18, 0.5]} rotation-y={side * 0.9} rotation-x={0.5} />
      ))}
      {/* lantern by the door: lit at night like every window */}
      <group position={[0.5, 0, 0.42]}>
        <mesh geometry={geo.box(0.035, 0.36, 0.035)} material={toon(C.woodDark)} position={[0, 0.18, 0]} castShadow />
        <mesh geometry={geo.box(0.08, 0.1, 0.08)} material={glow.window} position={[0, 0.4, 0]} />
        <mesh geometry={geo.cone(0.07, 0.06, 4)} material={toon(C.woodDark)} position={[0, 0.48, 0]} rotation-y={Math.PI / 4} />
      </group>
      {/* a woodpile: the start of a real house */}
      <Part geo={geo.cylinder(0.05, 0.05, 0.3, 6)} color={C.wood} position={[-0.5, 0.05, 0.25]} rotation-z={Math.PI / 2} />
      <Part geo={geo.cylinder(0.05, 0.05, 0.3, 6)} color={C.wood} position={[-0.5, 0.05, 0.36]} rotation-z={Math.PI / 2} />
      <Part geo={geo.cylinder(0.05, 0.05, 0.3, 6)} color={C.wood} position={[-0.5, 0.14, 0.305]} rotation-z={Math.PI / 2} />
    </group>
  );
}

/** Scaffolding with walls that rise towards `progress` (0..1). */
export function Scaffold3D({ progress, compact = false }: { progress: number; compact?: boolean }) {
  const walls = useRef<THREE.Mesh>(null!);
  useFrame((_, dt) => {
    const target = Math.max(0.08, progress);
    walls.current.scale.y = damp(walls.current.scale.y, target, 3, dt);
    walls.current.position.y = (walls.current.scale.y * 0.7) / 2;
  });
  const s = compact ? 0.62 : 1;
  return (
    <group scale={s}>
      <mesh ref={walls} geometry={geo.box(0.84, 0.7, 0.72)} material={toon(C.plaster)} scale={[1, 0.08, 1]} castShadow receiveShadow />
      {[
        [-0.48, -0.42],
        [0.48, -0.42],
        [-0.48, 0.42],
        [0.48, 0.42],
      ].map(([x, z]) => (
        <Part key={`${x}${z}`} geo={geo.cylinder(0.025, 0.025, 1.05, 5)} color={C.wood} position={[x!, 0.52, z!]} />
      ))}
      {[0.38, 0.78].map((y) => (
        <group key={y}>
          <Part geo={geo.box(1.0, 0.035, 0.035)} color={C.wood} position={[0, y, 0.42]} />
          <Part geo={geo.box(1.0, 0.035, 0.035)} color={C.wood} position={[0, y, -0.42]} />
          <Part geo={geo.box(0.035, 0.035, 0.88)} color={C.wood} position={[0.48, y, 0]} />
        </group>
      ))}
      <Part geo={geo.box(0.03, 0.62, 0.03)} color={C.woodDark} position={[0, 0.38, 0.43]} rotation-z={0.9} />
      <mesh geometry={geo.cone(0.09, 0.2, 3)} material={toon('#7b5ce0')} position={[0.56, 1.0, 0.42]} rotation-z={-Math.PI / 2} />
      {/* materials waiting on site */}
      <Part geo={geo.box(0.34, 0.06, 0.12)} color={C.wood} position={[-0.72, 0.03, 0.3]} rotation-y={0.2} />
      <Part geo={geo.box(0.34, 0.06, 0.12)} color={C.wood} position={[-0.7, 0.09, 0.28]} rotation-y={-0.1} />
      <Part geo={geo.dodecahedron(0.09)} color={C.stoneDark} position={[-0.72, 0.07, -0.05]} />
    </group>
  );
}

export function Ruins3D() {
  return (
    <group>
      <Part geo={geo.box(0.5, 0.42, 0.1)} color={C.stoneDark} position={[-0.2, 0.21, -0.3]} rotation-z={0.05} outline={INKED} />
      <Part geo={geo.box(0.1, 0.28, 0.5)} color={C.stoneDark} position={[0.35, 0.14, 0]} rotation-x={0.1} outline={INKED} />
      <Part geo={geo.box(0.42, 0.06, 0.6)} color="#5a4636" position={[0, 0.05, 0.05]} rotation-y={0.4} rotation-z={0.2} />
      {[[-0.3, 0.25], [0.1, 0.38], [0.45, 0.4], [-0.45, -0.05]].map(([x, z], i) => (
        <Part key={i} geo={geo.dodecahedron(0.08 + i * 0.015)} color={C.stone} position={[x!, 0.06, z!]} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Lots

export function Lot3D({ flag, raised, vacant, highlighted }: { flag?: string; raised?: boolean; vacant: boolean; highlighted: boolean }) {
  const half = 0.82;
  const seen = new Map<string, [number, number]>();
  for (let i = 0; i <= 8; i += 1) {
    const t = -half + (i / 8) * half * 2;
    const add = (x: number, z: number) => seen.set(`${x.toFixed(2)},${z.toFixed(2)}`, [x, z]);
    add(t, -half);
    add(-half, t);
    add(half, t);
    if (Math.abs(t) > 0.3) add(t, half); // gate gap at the front
  }
  const posts = [...seen.values()];
  return (
    <group>
      <mesh geometry={geo.box(1.76, 0.06, 1.76)} material={toon(highlighted ? '#e4dafc' : '#d9cb9e')} position={[0, 0.03, 0]} receiveShadow />
      {posts.map(([x, z]) => (
        <mesh key={`${x.toFixed(2)},${z.toFixed(2)}`} geometry={geo.box(0.045, 0.2, 0.045)} material={toon('#c8a77a')} position={[x, 0.13, z]} castShadow />
      ))}
      {[
        [0, -half, 1.64, 0],
        [-half, 0, 1.64, Math.PI / 2],
        [half, 0, 1.64, Math.PI / 2],
        [-0.57, half, 0.5, 0],
        [0.57, half, 0.5, 0],
      ].map(([x, z, len, rot]) => (
        <mesh key={`${x},${z}`} geometry={geo.box(len!, 0.03, 0.025)} material={toon('#b8956a')} position={[x!, 0.17, z!]} rotation-y={rot!} />
      ))}
      {flag ? (
        <group position={[-0.56, 0, 0.98]}>
          <mesh geometry={geo.box(0.04, 0.32, 0.04)} material={toon(C.woodDark)} position={[0, 0.16, 0]} castShadow />
          <Part geo={geo.box(0.13, 0.11, 0.18)} color="#f6f1e6" position={[0, 0.36, 0]} outline={0.01} />
          <mesh
            geometry={geo.box(0.02, 0.08, 0.1)}
            material={toon(flag)}
            position={raised ? [0.075, 0.45, 0] : [0.075, 0.37, 0.07]}
            rotation-x={raised ? 0 : Math.PI / 2}
          />
        </group>
      ) : null}
      {vacant ? (
        <group position={[0, 0, 0.1]}>
          <mesh geometry={geo.box(0.04, 0.42, 0.04)} material={toon(C.woodDark)} position={[0, 0.21, 0]} castShadow />
          <Part geo={geo.box(0.42, 0.22, 0.03)} color="#f6f1e6" position={[0, 0.42, 0]} outline={0.012} />
          <mesh geometry={geo.box(0.26, 0.025, 0.01)} material={toon('#8a7b6c')} position={[0, 0.44, 0.02]} />
          <mesh geometry={geo.box(0.18, 0.025, 0.01)} material={toon('#8a7b6c')} position={[0, 0.39, 0.02]} />
        </group>
      ) : null}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Scenery

export function Pine({ scale = 1, tint = C.pine }: { scale?: number; tint?: string }) {
  return (
    <group scale={scale}>
      <Part geo={geo.cylinder(0.06, 0.09, 0.3, 5)} color={C.woodDark} position={[0, 0.15, 0]} />
      <Part geo={geo.cone(0.46, 0.62, 6)} color={tint} position={[0, 0.55, 0]} outline={0.02} />
      <Part geo={geo.cone(0.36, 0.52, 6)} color={tint} position={[0, 0.88, 0]} outline={0.02} />
      <Part geo={geo.cone(0.24, 0.4, 6)} color={tint} position={[0, 1.16, 0]} outline={0.02} />
    </group>
  );
}

export function RoundTree({ scale = 1, tint = C.leaf }: { scale?: number; tint?: string }) {
  return (
    <group scale={scale}>
      <Part geo={geo.cylinder(0.07, 0.11, 0.5, 6)} color={C.wood} position={[0, 0.25, 0]} />
      <Part geo={geo.icosahedron(0.42, 0)} color={tint} position={[0, 0.78, 0]} outline={0.02} />
      <Part geo={geo.icosahedron(0.26, 0)} color={C.leafLight} position={[0.2, 0.92, 0.14]} outline={0.02} />
    </group>
  );
}

export function Rock({ scale = 1, color = C.stone }: { scale?: number; color?: string }) {
  return <Part geo={geo.dodecahedron(0.3)} color={color} scale={[scale * 1.2, scale * 0.7, scale]} position={[0, 0.12 * scale, 0]} outline={0.018} />;
}

// ---------------------------------------------------------------------------------------------
// Places

function Windmill() {
  const blades = useRef<THREE.Group>(null!);
  useFrame((_, dt) => void (blades.current.rotation.z += dt * 0.9));
  return (
    <group>
      <Part geo={geo.cylinder(0.2, 0.32, 1.35, 8)} color="#f1e4c6" position={[0, 0.67, 0]} outline={INKED} />
      <Part geo={geo.cone(0.3, 0.38, 8)} color={C.roof} position={[0, 1.53, 0]} outline={INKED} />
      <Door position={[0, 0.17, 0.27]} w={0.16} h={0.3} />
      <group ref={blades} position={[0, 1.22, 0.33]}>
        <mesh geometry={geo.cylinder(0.05, 0.05, 0.1, 8)} material={toon(C.woodDark)} rotation-x={Math.PI / 2} />
        {[0, 1, 2, 3].map((i) => (
          <group key={i} rotation-z={(i * Math.PI) / 2}>
            <mesh geometry={geo.box(0.035, 0.72, 0.03)} material={toon(C.woodDark)} position={[0, 0.38, 0]} />
            <Part geo={geo.box(0.17, 0.5, 0.015)} color="#fbf6ea" position={[0.1, 0.46, 0]} outline={0.01} />
          </group>
        ))}
      </group>
    </group>
  );
}

export function Lantern() {
  const light = useRef<THREE.PointLight>(null!);
  useFrame(() => void (light.current.intensity = 0.3 + night.value * 9));
  return (
    <group>
      <Part geo={geo.cylinder(0.035, 0.05, 1.25, 6)} color="#3a3048" position={[0, 0.62, 0]} />
      <mesh geometry={geo.box(0.2, 0.22, 0.2)} material={glow.lamp} position={[0, 1.33, 0]} />
      <Part geo={geo.cone(0.17, 0.14, 4)} color="#3a3048" position={[0, 1.51, 0]} rotation-y={Math.PI / 4} />
      <pointLight ref={light} position={[0, 1.33, 0]} color="#ffc66b" distance={6} decay={1.6} />
    </group>
  );
}

/** `centre` replaces the Plaza's lantern (the Fountain is built around it). */
export function Place3D({ id, centre }: { id: PlaceId; centre?: React.ReactNode }) {
  switch (id) {
    case 'forest':
      return (
        <group>
          {(
            [
              [-0.7, -0.7, 1.25],
              [0.45, -0.9, 1.45],
              [-0.05, -0.15, 1.55],
              [-1.05, 0.2, 1.05],
              [0.95, 0.05, 1.15],
              [0.25, 0.75, 0.9],
              [-0.6, 0.7, 0.85],
            ] as const
          ).map(([x, z, s], i) => (
            <group key={i} position={[x, 0, z]}>
              <Pine scale={s} tint={i % 2 ? C.pine : '#4a8a54'} />
            </group>
          ))}
          <group position={[0.7, 0, 0.85]}>
            <Part geo={geo.cylinder(0.17, 0.2, 0.2, 8)} color={C.wood} position={[0, 0.1, 0]} outline={0.015} />
            <mesh geometry={geo.cylinder(0.14, 0.14, 0.01, 8)} material={toon('#e5c39a')} position={[0, 0.205, 0]} />
            <group position={[0.02, 0.32, 0]} rotation-z={0.5}>
              <mesh geometry={geo.box(0.03, 0.3, 0.03)} material={toon(C.wood)} />
              <mesh geometry={geo.box(0.12, 0.08, 0.02)} material={toon('#c9d1d6')} position={[0.05, 0.12, 0]} />
            </group>
          </group>
          {[0, 1, 2].map((i) => (
            <Part key={i} geo={geo.cylinder(0.07, 0.07, 0.5, 7)} color={i === 1 ? C.woodDark : C.wood} position={[-0.95 + i * 0.13, 0.07 + (i === 1 ? 0.1 : 0), 1.0]} rotation-z={Math.PI / 2} rotation-y={0.4} outline={0.012} />
          ))}
        </group>
      );
    case 'quarry':
      return (
        <group>
          <Part geo={geo.dodecahedron(1)} color="#c4bcae" position={[0, 0.25, -0.5]} scale={[1.35, 0.75, 0.95]} outline={INKED} />
          <Part geo={geo.dodecahedron(0.6)} color="#aaa294" position={[-0.9, 0.18, -0.2]} scale={[1, 0.8, 0.9]} outline={INKED} />
          <group position={[0.75, 0, 0.35]}>
            <Rock scale={1.1} />
          </group>
          <group position={[-0.5, 0, 0.6]}>
            <Rock scale={0.7} color={C.stoneDark} />
          </group>
          {/* cart */}
          <group position={[0.1, 0, 0.75]} rotation-y={-0.35}>
            <Part geo={geo.box(0.55, 0.22, 0.34)} color={C.wood} position={[0, 0.25, 0]} outline={0.014} />
            {[-0.17, 0.17].map((x) =>
              [-0.19, 0.19].map((z) => (
                <mesh key={`${x}${z}`} geometry={geo.cylinder(0.08, 0.08, 0.04, 10)} material={toon('#3a3048')} position={[x, 0.08, z]} rotation-x={Math.PI / 2} />
              )),
            )}
            {[-0.12, 0.05, 0.16].map((x, i) => (
              <Part key={x} geo={geo.dodecahedron(0.08)} color={C.stone} position={[x, 0.39, i % 2 ? 0.06 : -0.05]} />
            ))}
          </group>
        </group>
      );
    case 'farm':
      return (
        <group>
          <Part geo={geo.box(2.2, 0.1, 1.5)} color={C.soil} position={[-0.25, 0.05, 0.15]} outline={0.015} />
          {Array.from({ length: 5 }, (_, row) =>
            Array.from({ length: 7 }, (_, col) => (
              <mesh
                key={`${row}-${col}`}
                geometry={geo.cone(0.07, 0.3, 4)}
                material={toon(row % 2 ? C.wheat : '#d9b448')}
                position={[-1.1 + col * 0.29, 0.25, -0.38 + row * 0.27]}
                castShadow
              />
            )),
          )}
          <group position={[1.15, 0, -0.55]}>
            <Windmill />
          </group>
          <group position={[1.05, 0, 0.75]}>
            <Part geo={geo.cylinder(0.12, 0.1, 0.22, 8)} color="#c79566" position={[0, 0.11, 0]} outline={0.012} />
            <mesh geometry={geo.cone(0.11, 0.1, 8)} material={toon(C.wheat)} position={[0, 0.27, 0]} />
          </group>
        </group>
      );
    case 'plaza':
      return (
        <group>
          <mesh geometry={geo.cylinder(1.35, 1.4, 0.06, 28)} material={toon(C.cobble)} position={[0, 0.03, 0]} receiveShadow />
          <mesh geometry={geo.torus(1.32, 0.05, 4, 32)} material={toon(C.pathEdge)} position={[0, 0.06, 0]} rotation-x={Math.PI / 2} />
          {centre ?? <Lantern />}
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.95, 0, -0.75]} rotation-y={-side * 0.6}>
              <Part geo={geo.box(0.6, 0.05, 0.2)} color={C.wood} position={[0, 0.2, 0]} outline={0.012} />
              <mesh geometry={geo.box(0.05, 0.2, 0.18)} material={toon(C.woodDark)} position={[-0.24, 0.1, 0]} />
              <mesh geometry={geo.box(0.05, 0.2, 0.18)} material={toon(C.woodDark)} position={[0.24, 0.1, 0]} />
            </group>
          ))}
        </group>
      );
    case 'tavern':
      return (
        <group>
          <Part geo={geo.box(1.6, 0.88, 1.05)} color={C.plaster} position={[0, 0.44, 0]} outline={INKED} />
          <Part geo={geo.box(1.64, 0.07, 1.09)} color={C.woodDark} position={[0, 0.46, 0]} />
          {[-0.79, 0.79].map((x) => (
            <mesh key={x} geometry={geo.box(0.06, 0.88, 0.06)} material={toon(C.woodDark)} position={[x, 0.44, 0.52]} />
          ))}
          <Part geo={gable(1.86, 0.62, 1.3)} color="#5f7a4a" position={[0, 0.88, 0]} outline={INKED} />
          <Part geo={geo.box(0.17, 0.4, 0.17)} color="#9a5a46" position={[-0.5, 1.25, -0.2]} outline={0.015} />
          <Smoke position={[-0.5, 1.48, -0.2]} />
          <Door position={[0, 0.2, 0.54]} w={0.26} h={0.4} />
          <Window position={[-0.5, 0.26, 0.53]} size={[0.24, 0.17]} />
          <Window position={[0.5, 0.26, 0.53]} size={[0.24, 0.17]} />
          <Window position={[-0.4, 0.68, 0.53]} />
          <Window position={[0.4, 0.68, 0.53]} />
          <group position={[0.92, 0.62, 0.55]}>
            <mesh geometry={geo.box(0.3, 0.03, 0.03)} material={toon(C.woodDark)} position={[0.08, 0.14, 0]} />
            <Part geo={geo.box(0.26, 0.2, 0.03)} color="#f6f1e6" position={[0.12, 0, 0]} outline={0.01} />
            <mesh geometry={geo.sphere(0.05, 8, 6)} material={toon('#7b5ce0')} position={[0.12, 0, 0.03]} />
          </group>
          {[
            [0.95, 0.3],
            [1.12, 0.05],
          ].map(([x, z]) => (
            <Part key={x} geo={geo.cylinder(0.12, 0.12, 0.28, 10)} color={C.wood} position={[x!, 0.14, z!]} outline={0.012} />
          ))}
        </group>
      );
    case 'workshop':
      return (
        <group>
          <Part geo={geo.box(1.5, 0.82, 1.0)} color={C.stone} position={[0, 0.41, 0]} outline={INKED} />
          <SawtoothRoof width={1.5} depth={1.0} y={0.82} teeth={3} />
          <Part geo={geo.box(0.46, 0.5, 0.04)} color={C.wood} position={[0.25, 0.25, 0.51]} outline={0.012} />
          <Gear position={[-0.4, 0.52, 0.53]} radius={0.2} />
          <Window position={[-0.4, 0.2, 0.51]} size={[0.2, 0.14]} />
          <group position={[-0.95, 0, 0.45]}>
            <Part geo={geo.box(0.26, 0.24, 0.26)} color={C.wood} position={[0, 0.12, 0]} rotation-y={0.2} outline={0.012} />
            <Part geo={geo.box(0.2, 0.18, 0.2)} color={C.woodDark} position={[0.05, 0.33, 0]} rotation-y={-0.3} outline={0.012} />
          </group>
          <group position={[0.95, 0, 0.6]}>
            <Part geo={geo.box(0.12, 0.16, 0.12)} color="#3a3048" position={[0, 0.08, 0]} />
            <Part geo={geo.box(0.3, 0.08, 0.14)} color="#4a4060" position={[0, 0.2, 0]} outline={0.012} />
          </group>
        </group>
      );
  }
}
