// The Chog, modelled on the official character: a chibi biped with a big purple head, swept
// hedgehog spikes, a cream face mask, huge glossy eyes, pink cheeks, pink mittens and feet.
// Movement is procedural: a bouncy walk cycle, then a per-activity loop once it arrives.
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GlyphIcon, type Glyph } from '../world/art';
import type { Appearance } from '../../shared/looks';
import { Aura, Eyes, Hat, Held, hidesCrown, Mouth, MouthProp, Outfit, sleeveColor } from './ChogParts';
import { geo } from './geometry';
import { PALETTE, toon } from './materials';
import { useOverlayPortal } from './overlay';
import { track } from './tracking';
import { route, routeLength } from './paths';
import type { XZ } from './layout';
import { LABEL_PRIORITY, ScaledHtml } from './ScaledHtml';
import { Part as InkPart } from './parts';

export type ChogAction = 'idle' | 'chop' | 'mine' | 'harvest' | 'hammer' | 'sleep' | 'wave' | 'paused' | 'frozen';

const OUTLINE = 0.018;
/** Bubbles and name tags: full size within ~28 units (the follow cam), shrinking with distance beyond. */
const TAG_SCALE = 28;
const { damp } = THREE.MathUtils;

/** Spikes on the head: [position, rotation, base radius, length]. Swept back like the official art. */
const SPIKES: [[number, number, number], [number, number, number], number, number][] = [
  // crown: tall quills sweeping up and back
  [[0.0, 0.2, 0.02], [-0.85, 0, 0], 0.13, 0.46],
  [[-0.11, 0.17, 0.0], [-0.75, 0, 0.55], 0.12, 0.4],
  [[0.11, 0.17, -0.01], [-0.75, 0, -0.55], 0.11, 0.38],
  // sides: framing the face, angled up and back rather than straight out
  [[-0.2, 0.06, -0.04], [-0.7, 0, 1.0], 0.11, 0.34],
  [[0.2, 0.05, -0.05], [-0.7, 0, -1.0], 0.1, 0.3],
  [[-0.21, -0.09, -0.07], [-0.9, 0, 1.45], 0.08, 0.24],
  [[0.21, -0.1, -0.07], [-0.9, 0, -1.45], 0.08, 0.22],
  // back of the head
  [[0, 0.06, -0.19], [-1.45, 0, 0], 0.13, 0.36],
  [[-0.12, -0.08, -0.18], [-1.75, 0, 0.35], 0.1, 0.28],
  [[0.12, -0.09, -0.18], [-1.75, 0, -0.35], 0.1, 0.26],
];

function Part({ outline = true, ...props }: Omit<React.ComponentProps<typeof InkPart>, 'outline'> & { outline?: boolean }) {
  return <InkPart outline={outline ? OUTLINE : 0} {...props} />;
}

/** Walking pace in world units per second, and the longest a walk may take (ticks are 10 s apart). */
const WALK_SPEED = 2.1;
const MAX_WALK_SECONDS = 7;

interface Walk {
  points: XZ[];
  /** Distance along the route at each point. */
  lengths: number[];
  total: number;
  start: number;
  duration: number;
}

/** Position and heading a fraction `p` of the way along a walk. */
function along(w: Walk, p: number): { at: XZ; heading: number } {
  const d = p * w.total;
  let i = 1;
  while (i < w.points.length - 1 && w.lengths[i]! < d) i += 1;
  const a = w.points[i - 1] ?? w.points[0]!;
  const b = w.points[i] ?? a;
  const span = (w.lengths[i] ?? 0) - (w.lengths[i - 1] ?? 0);
  const k = span > 0 ? (d - w.lengths[i - 1]!) / span : 1;
  return { at: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}

export interface Chog3DProps {
  seed: number;
  appearance: Appearance;
  target: [number, number];
  /** Yaw to face once arrived (radians, 0 = towards +Z / the camera). */
  face: number;
  action: ChogAction;
  glyph: Glyph;
  name: string;
  selected: boolean;
  reducedMotion: boolean;
  /** Asleep in a built home: walks to the door, then steps inside out of sight. */
  indoors?: boolean;
  /** Registers the live body under this key, so the camera can follow it. */
  trackKey?: string;
  /** The viewer's own resident: its bubble wins over strangers' when labels crowd. */
  mine?: boolean;
  onSelect: () => void;
}

export function Chog3D({ seed, appearance, target, face, action, glyph, name, selected, reducedMotion, indoors = false, trackKey, mine = false, onSelect }: Chog3DProps) {
  const root = useRef<THREE.Group>(null!);
  const presence = useRef<THREE.Group>(null!);
  const facing = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const legL = useRef<THREE.Group>(null!);
  const legR = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const eyes = useRef<THREE.Group>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);
  const overlay = useOverlayPortal();

  const walk = useRef<Walk>({ points: [target], lengths: [0], total: 0, start: -1, duration: 0 });
  const clock = useRef(0);

  // A new committed position starts a walk from wherever the Chog currently is, along the roads.
  useEffect(() => {
    const here: XZ = root.current ? [root.current.position.x, root.current.position.z] : target;
    const points = route(here, target);
    const lengths = [0];
    for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1]! + routeLength([points[i - 1]!, points[i]!]));
    const total = lengths[lengths.length - 1]!;
    // Strolling pace, quickened on long trips so everyone arrives well before the next tick.
    const speed = Math.max(WALK_SPEED, total / MAX_WALK_SECONDS);
    walk.current = { points, lengths, total, start: clock.current, duration: reducedMotion ? 0 : Math.max(0.4, total / speed) };
  }, [target[0], target[1], reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => (trackKey ? track(trackKey, root.current) : undefined), [trackKey]);

  useLayoutEffect(() => {
    root.current.position.set(target[0], 0, target[1]);
    facing.current.rotation.y = face;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime + seed * 1.37;
    clock.current = state.clock.elapsedTime;

    // --- travel ---------------------------------------------------------------------------
    const w = walk.current;
    const p = w.duration > 0 ? Math.min(1, (state.clock.elapsedTime - w.start) / w.duration) : 1;
    const { at, heading } = along(w, p);
    const walking = p < 1 && w.total > 0.05;
    root.current.position.x = at[0];
    root.current.position.z = at[1];

    const yawTarget = walking ? heading : face;
    const yaw = shortestAngle(facing.current.rotation.y, yawTarget);
    facing.current.rotation.y = reducedMotion ? yawTarget : damp(facing.current.rotation.y, yaw, 10, dt);

    // --- pose targets (radians / units), damped so actions blend instead of snapping -------
    let legLx = 0, legRx = 0, armLx = 0, armRx = 0;
    let armLz = -0.18, armRz = 0.18;
    let bodyY = 0, bodyX = 0, headY = 0, headZ = 0, headX = 0;
    let eyeOpen = 1;

    if (reducedMotion) {
      // Static, readable poses only.
      if (action === 'sleep') {
        legLx = legRx = -1.35;
        bodyY = -0.13;
        eyeOpen = 0.12;
      }
    } else if (walking) {
      const ph = t * 11;
      legLx = Math.sin(ph) * 0.75;
      legRx = -Math.sin(ph) * 0.75;
      armLx = -Math.sin(ph) * 0.7;
      armRx = Math.sin(ph) * 0.7;
      bodyY = Math.abs(Math.sin(ph)) * 0.05;
      bodyX = 0.08;
      headZ = Math.sin(ph) * 0.06;
    } else {
      switch (action) {
        case 'chop':
        case 'mine': {
          const speed = action === 'chop' ? 1.5 : 1.15;
          const c = (t * speed) % 1;
          const swing = c < 0.55 ? -2.7 * (c / 0.55) : -2.7 + 2.5 * Math.min(1, (c - 0.55) / 0.12);
          armLx = armRx = swing;
          armLz = -0.05;
          armRz = 0.05;
          bodyX = c > 0.55 && c < 0.75 ? (action === 'mine' ? 0.3 : 0.2) : -0.05;
          legLx = -0.25;
          legRx = 0.2;
          break;
        }
        case 'harvest': {
          const c = Math.sin(t * 2.4);
          bodyX = 0.35 + c * 0.12;
          armLx = -1 + c * 0.35;
          armRx = -1 - c * 0.35;
          headX = 0.2;
          break;
        }
        case 'hammer': {
          armRx = -1.4 - Math.max(0, Math.sin(t * 9)) * 1.1;
          armLx = -0.8;
          bodyX = 0.1;
          headX = 0.15;
          break;
        }
        case 'sleep': {
          legLx = legRx = -1.35;
          bodyY = -0.13;
          bodyX = -0.1;
          headZ = 0.28 + Math.sin(t * 1.2) * 0.03;
          armLz = -0.45;
          armRz = 0.45;
          eyeOpen = 0.12;
          break;
        }
        case 'wave': {
          armRz = 2.55 + Math.sin(t * 9) * 0.32;
          armRx = -0.2;
          const hop = (t * 0.55) % 1;
          bodyY = hop < 0.18 ? Math.sin((hop / 0.18) * Math.PI) * 0.16 : 0;
          headZ = -0.12;
          break;
        }
        case 'paused': {
          bodyY = Math.sin(t * 1.1) * 0.006;
          headX = 0.18;
          break;
        }
        case 'frozen':
          break;
        default: {
          bodyY = Math.sin(t * 2) * 0.01;
          headY = Math.sin(t * 0.45) * 0.5;
          armLx = Math.sin(t * 2) * 0.06;
          armRx = -Math.sin(t * 2) * 0.06;
        }
      }
      if (action !== 'sleep' && (t % 4.1) < 0.11) eyeOpen = 0.1; // blink
    }

    const k = walking ? 18 : 12;
    legL.current.rotation.x = damp(legL.current.rotation.x, legLx, k, dt);
    legR.current.rotation.x = damp(legR.current.rotation.x, legRx, k, dt);
    armL.current.rotation.x = damp(armL.current.rotation.x, armLx, k, dt);
    armR.current.rotation.x = damp(armR.current.rotation.x, armRx, k, dt);
    armL.current.rotation.z = damp(armL.current.rotation.z, armLz, k, dt);
    armR.current.rotation.z = damp(armR.current.rotation.z, armRz, k, dt);
    body.current.position.y = damp(body.current.position.y, bodyY, 16, dt);
    body.current.rotation.x = damp(body.current.rotation.x, bodyX, 10, dt);
    head.current.rotation.y = damp(head.current.rotation.y, headY, 4, dt);
    head.current.rotation.z = damp(head.current.rotation.z, headZ, 8, dt);
    head.current.rotation.x = damp(head.current.rotation.x, headX, 8, dt);
    eyes.current.scale.y = eyeOpen < 0.5 ? eyeOpen : damp(eyes.current.scale.y, eyeOpen, 30, dt);

    // Through the door: shrink into the doorway once arrived; step back out the same way.
    const shown = indoors && !walking ? 0 : 1;
    const s = reducedMotion ? shown : damp(presence.current.scale.x, shown, 7, dt);
    presence.current.scale.setScalar(s);
    presence.current.visible = s > 0.02;

    if (ring.current) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 4) * (reducedMotion ? 0 : 0.06);
      ring.current.scale.set(s, s, s);
    }
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = 'pointer';
  };
  const out = () => {
    setHovered(false);
    document.body.style.cursor = '';
  };
  useEffect(() => () => void (document.body.style.cursor = ''), []);

  const frozen = action === 'frozen';
  const skin = appearance.skin;
  const sleeve = sleeveColor(appearance);
  const trouser = appearance.outfit.kind === 'jumpsuit' ? appearance.outfit.color : skin.fur;
  const crownHidden = hidesCrown(appearance);
  const auraColor = appearance.aura ?? (appearance.radioactive ? '#9bff6a' : null);
  const bubbleY = appearance.hat.kind === 'wizard' || appearance.hat.kind === 'diamond' || appearance.hat.kind === 'halo' ? 2.35 : 2.05;

  return (
    <group
      ref={root}
      name={`chog:${name}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={over}
      onPointerOut={out}
    >
      {/* generous invisible hit volume */}
      <mesh position={[0, 0.6, 0]} visible={false}>
        <cylinderGeometry args={[0.5, 0.5, 1.3, 8]} />
      </mesh>

      {selected ? (
        <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.025}>
          <ringGeometry args={[0.56, 0.7, 40]} />
          <meshBasicMaterial color="#a58bff" transparent opacity={0.9} />
        </mesh>
      ) : null}

      <group ref={presence}>
      <group ref={facing} scale={1.6}>
        <group ref={body}>
          {/* legs: pivot at the hip */}
          {[
            [legL, -0.085],
            [legR, 0.085],
          ].map(([ref, lx]) => (
            <group key={lx as number} ref={ref as React.RefObject<THREE.Group>} position={[lx as number, 0.21, 0]}>
              <Part color={trouser} position={[0, -0.07, 0]} geo={geo.capsule(0.068, 0.1, 4, 10)} />
              <Part color={skin.mitt} position={[0, -0.165, 0.035]} scale={[1, 0.62, 1.35]} geo={geo.sphere(0.078, 14, 10)} />
            </group>
          ))}

          {/* torso, then whatever the NFT is wearing */}
          <Part color={skin.fur} position={[0, 0.33, 0]} scale={[1, 1, 0.9]} geo={geo.capsule(0.16, 0.12, 6, 14)} />
          <Outfit a={appearance} />

          {/* arms: pivot at the shoulder; the right mitten holds the NFT's accessory */}
          {[
            [armL, -0.185],
            [armR, 0.185],
          ].map(([ref, ax]) => (
            <group key={ax as number} ref={ref as React.RefObject<THREE.Group>} position={[ax as number, 0.43, 0]}>
              <Part color={sleeve ?? skin.fur} position={[0, -0.09, 0]} geo={geo.capsule(0.048, 0.11, 4, 8)} />
              <Part color={skin.mitt} position={[0, -0.19, 0.01]} geo={geo.sphere(0.064, 12, 10)} />
              {(ax as number) > 0 ? <Held a={appearance} /> : null}
            </group>
          ))}

          {/* head */}
          <group ref={head} position={[0, 0.68, 0]}>
            <Part color={skin.fur} geo={geo.sphere(0.25, 24, 18)} />
            {SPIKES.map(([pos, rot, r, h], i) =>
              crownHidden && i < 3 ? null : (
                <group key={i} position={pos} rotation={rot}>
                  <Part color={i % 3 === 1 ? skin.furDeep : skin.fur} position={[0, h / 2, 0]} geo={geo.cone(r, h, 5)} />
                </group>
              ),
            )}
            {/* face mask (bone-white for skull Chogs) */}
            <Part receive={false} color={appearance.skull ? '#efe9dc' : skin.mask} position={[0, -0.045, 0.118]} scale={[1.08, 0.88, 0.66]} geo={geo.sphere(0.205, 24, 18)} />
            {appearance.skull ? (
              <>
                {[-0.086, 0.086].map((x) => (
                  <mesh key={x} material={toon('#3a2f3f')} position={[x, 0, 0.226]} rotation-y={x * 1.7} scale={[1, 1.1, 0.3]} geometry={geo.sphere(0.078, 14, 10)} />
                ))}
                <mesh material={toon('#3a2f3f')} position={[0, -0.13, 0.215]} scale={[1, 0.35, 0.3]} geometry={geo.box(0.12, 0.05, 0.05)} />
              </>
            ) : null}
            <group ref={eyes}>
              <Eyes a={appearance} beams={action !== 'sleep' && action !== 'paused' && action !== 'frozen'} />
            </group>
            {!appearance.skull
              ? [-0.135, 0.135].map((cx) => (
                  <mesh key={cx} material={toon('#e0558a')} position={[cx, -0.075, 0.2]} rotation-y={cx * 3} scale={[1, 0.8, 0.3]} geometry={geo.sphere(0.04, 10, 8)} />
                ))
              : null}
            <mesh material={toon(PALETTE.chogPinkDeep)} position={[0, -0.06, 0.248]} scale={[1.3, 0.8, 0.6]} geometry={geo.sphere(0.016, 8, 6)} />
            <Mouth a={appearance} />
            <MouthProp a={appearance} />
            <Hat a={appearance} />
          </group>
        </group>
      </group>

      {auraColor ? <Aura color={auraColor} reducedMotion={reducedMotion} /> : null}

      {frozen ? (
        <mesh position={[0, 0.5, 0]}>
          <sphereGeometry args={[0.52, 16, 12]} />
          <meshBasicMaterial color="#bfe4ff" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      ) : null}
      </group>

      <ScaledHtml
        {...overlay}
        position={[0, indoors ? 2.55 : bubbleY, 0]}
        factor={TAG_SCALE}
        origin="50% 100%"
        priority={selected ? LABEL_PRIORITY.selected : mine ? LABEL_PRIORITY.mine : LABEL_PRIORITY.resident}
        center
        zIndexRange={[30, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className={`bubble3d${selected ? ' is-selected' : ''}`}>
          <GlyphIcon glyph={glyph} size={18} />
        </div>
      </ScaledHtml>
      {(selected || hovered) && !indoors ? (
        <ScaledHtml {...overlay} position={[0, -0.05, 0.3]} factor={TAG_SCALE} origin="50% 0%" priority={LABEL_PRIORITY.selected} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <div className="name3d">{name}</div>
        </ScaledHtml>
      ) : null}
    </group>
  );
}
