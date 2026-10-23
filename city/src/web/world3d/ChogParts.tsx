// Trait-driven pieces of a Chog: headwear, outfit, eyes, mouth, held item and aura.
// Head-space coordinates: head sphere radius 0.25 at the origin, face towards +Z.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Appearance } from '../../shared/looks';
import { geo, shapes } from './geometry';
import { toon } from './materials';
import { Part as InkPart } from './parts';

const O = 0.018;
const INKY = '#120c1c';

function P(props: Omit<React.ComponentProps<typeof InkPart>, 'outline'> & { outline?: boolean }) {
  const { outline = true, ...rest } = props;
  return <InkPart outline={outline ? O : 0} {...rest} />;
}

const glowMaterial = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false });

/** Hats that sit on the crown hide the tall crown spikes beneath them. */
export function hidesCrown(a: Appearance): boolean {
  return ['cap', 'bucket', 'beanie', 'wizard', 'ushanka', 'helmet', 'fedora', 'hair', 'shroom'].includes(a.hat.kind);
}

// ---------------------------------------------------------------------------------------------
// Headwear

export function Hat({ a }: { a: Appearance }) {
  const { kind, color, accent } = a.hat;
  const spin = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 1.2;
  });
  switch (kind) {
    case 'none':
      return null;
    case 'cap':
      return (
        <group position={[0, 0.04, -0.01]} rotation-x={-0.12}>
          <P geo={shapes.dome(0.268)} color={color} scale={[1, 0.9, 1]} />
          <P geo={geo.cylinder(0.2, 0.2, 0.022, 18)} color={accent} position={[0, 0.02, 0.24]} scale={[1, 1, 0.8]} rotation-x={0.12} />
          <mesh geometry={geo.sphere(0.03, 8, 6)} material={toon(accent)} position={[0, 0.245, 0]} />
        </group>
      );
    case 'bucket':
      return (
        <group position={[0, 0.06, 0]} rotation-x={-0.08}>
          <P geo={shapes.dome(0.27)} color={color} scale={[1, 0.95, 1]} />
          <P geo={geo.cylinder(0.4, 0.42, 0.025, 22)} color={color} position={[0, 0.0, 0.02]} />
          <mesh geometry={shapes.band(0.272, 0.05)} material={toon(accent, true)} position={[0, 0.04, 0]} />
        </group>
      );
    case 'beanie':
      return (
        <group position={[0, 0.03, 0]}>
          <P geo={shapes.dome(0.272)} color={color} scale={[1, 1.15, 1]} />
          <P geo={geo.torus(0.262, 0.045, 6, 22)} color={accent} rotation-x={Math.PI / 2} position={[0, 0.02, 0]} />
          <P geo={geo.sphere(0.07, 10, 8)} color={accent} position={[0, 0.33, 0]} />
        </group>
      );
    case 'crown':
      return (
        <group position={[0, 0.22, -0.02]} rotation-x={-0.1}>
          <mesh geometry={shapes.band(0.17, 0.12)} material={toon(color, true)} />
          {Array.from({ length: 6 }, (_, i) => {
            const t = (i / 6) * Math.PI * 2;
            return <P key={i} geo={geo.cone(0.04, 0.1, 4)} color={color} position={[Math.cos(t) * 0.17, 0.1, Math.sin(t) * 0.17]} />;
          })}
          <mesh geometry={geo.sphere(0.035, 8, 6)} material={toon(accent)} position={[0, 0.01, 0.17]} />
          <mesh geometry={geo.sphere(0.025, 8, 6)} material={toon('#3b6fd0')} position={[0.12, 0.01, 0.12]} />
        </group>
      );
    case 'wizard':
      return (
        <group position={[0, 0.08, -0.02]} rotation-x={-0.25}>
          <P geo={geo.cylinder(0.38, 0.38, 0.025, 22)} color={color} />
          <P geo={geo.cone(0.27, 0.62, 12)} color={color} position={[0, 0.31, 0]} />
          {[
            [0.12, 0.18, 0.18],
            [-0.1, 0.3, 0.14],
            [0.05, 0.44, 0.08],
          ].map(([x, y, z], i) => (
            <mesh key={i} geometry={shapes.octahedron(0.035)} material={toon(accent)} position={[x!, y!, z!]} />
          ))}
        </group>
      );
    case 'ushanka':
      return (
        <group position={[0, 0.05, 0]}>
          <P geo={shapes.dome(0.29)} color={color} scale={[1, 0.95, 1]} />
          <P geo={geo.box(0.42, 0.11, 0.08)} color={accent} position={[0, 0.06, 0.25]} />
          {[-1, 1].map((s) => (
            <P key={s} geo={geo.box(0.07, 0.24, 0.2)} color={accent} position={[s * 0.27, -0.07, 0]} rotation-z={s * 0.12} />
          ))}
        </group>
      );
    case 'helmet':
      return (
        <group position={[0, 0.03, 0]}>
          <P geo={shapes.dome(0.28)} color={color} />
          <P geo={geo.box(0.06, 0.16, 0.42)} color={accent} position={[0, 0.3, -0.02]} />
          {[-1, 1].map((s) => (
            <P key={s} geo={geo.box(0.05, 0.2, 0.14)} color={color} position={[s * 0.25, -0.08, 0.06]} />
          ))}
        </group>
      );
    case 'fedora':
      return (
        <group position={[0, 0.18, 0]} rotation-x={-0.1}>
          <P geo={geo.cylinder(0.36, 0.36, 0.02, 22)} color={color} />
          <P geo={geo.cylinder(0.19, 0.22, 0.17, 16)} color={color} position={[0, 0.09, 0]} />
          <mesh geometry={shapes.band(0.215, 0.04)} material={toon(accent, true)} position={[0, 0.03, 0]} />
        </group>
      );
    case 'horns':
      return (
        <group>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.15, 0.2, 0.06]} rotation={[-0.3, 0, -s * 0.5]}>
              <P geo={geo.cone(0.05, 0.22, 7)} color={color} position={[0, 0.11, 0]} />
            </group>
          ))}
        </group>
      );
    case 'band':
      return (
        <group position={[0, 0.08, 0]} rotation-x={-0.15}>
          <P geo={geo.torus(0.25, 0.035, 6, 24)} color={color} rotation-x={Math.PI / 2} />
          <mesh geometry={geo.box(0.05, 0.14, 0.03)} material={toon(color)} position={[0.05, -0.08, -0.26]} rotation-z={0.4} />
          <mesh geometry={geo.box(0.05, 0.14, 0.03)} material={toon(color)} position={[-0.04, -0.09, -0.26]} rotation-z={-0.3} />
          {color === '#f4f1ea' ? <mesh geometry={geo.sphere(0.035, 8, 6)} material={toon('#d9473b')} position={[0, 0, 0.26]} scale={[1, 1, 0.4]} /> : null}
        </group>
      );
    case 'hair': {
      const rainbow = color === 'rainbow';
      return (
        <group position={[0, 0.02, -0.02]}>
          <P geo={shapes.dome(0.29)} color={rainbow ? '#e0334f' : color} scale={[1.05, 1.05, 1.05]} />
          {rainbow ? (
            <>
              <mesh geometry={geo.torus(0.27, 0.04, 6, 24)} material={toon('#f2c230')} rotation-x={Math.PI / 2} position={[0, 0.1, 0]} />
              <mesh geometry={geo.torus(0.29, 0.04, 6, 24)} material={toon('#4c9a52')} rotation-x={Math.PI / 2} position={[0, 0.02, 0]} />
            </>
          ) : null}
          {[-1, 1].map((s) => (
            <P key={s} geo={geo.capsule(0.08, 0.16, 4, 8)} color={rainbow ? '#3b6fd0' : color} position={[s * 0.24, -0.08, 0.02]} />
          ))}
        </group>
      );
    }
    case 'halo':
      return (
        <mesh geometry={geo.torus(0.17, 0.022, 8, 28)} material={glowMaterial(color)} position={[0, 0.48, 0]} rotation-x={Math.PI / 2 - 0.2} />
      );
    case 'laurel':
      return (
        <group position={[0, 0.1, 0]} rotation-x={-0.15}>
          <mesh geometry={geo.torus(0.255, 0.022, 6, 26)} material={toon(color)} rotation-x={Math.PI / 2} />
          {Array.from({ length: 10 }, (_, i) => {
            const t = (i / 10) * Math.PI * 2;
            return <mesh key={i} geometry={geo.cone(0.03, 0.08, 4)} material={toon(color)} position={[Math.cos(t) * 0.26, 0.03, Math.sin(t) * 0.26]} rotation-z={0.6} />;
          })}
        </group>
      );
    case 'thirdEye':
      return (
        <group position={[0, 0.12, 0.225]} rotation-x={-0.45}>
          <mesh geometry={geo.sphere(0.045, 12, 8)} material={toon(color)} scale={[1, 0.6, 0.4]} />
          <mesh geometry={geo.sphere(0.02, 8, 6)} material={a.hat.color === '#45c4dc' ? glowMaterial('#45c4dc') : toon(accent)} position={[0, 0, 0.015]} />
        </group>
      );
    case 'diamond':
      return (
        <group ref={spin} position={[0, 0.55, 0]}>
          <P geo={shapes.octahedron(0.1)} color={color} scale={[1, 1.4, 1]} />
        </group>
      );
    case 'shroom':
      return (
        <group position={[0, 0.12, 0]}>
          <P geo={shapes.dome(0.33)} color={color} scale={[1, 0.7, 1]} />
          {[
            [0.12, 0.17, 0.14],
            [-0.15, 0.14, 0.1],
            [0, 0.22, -0.05],
          ].map(([x, y, z], i) => (
            <mesh key={i} geometry={geo.sphere(0.04, 8, 6)} material={toon(accent)} position={[x!, y!, z!]} scale={[1, 0.5, 1]} />
          ))}
        </group>
      );
    case 'banana':
      return (
        <group position={[0, 0.27, 0]} rotation-z={0.3}>
          <P geo={geo.capsule(0.05, 0.26, 4, 8)} color={color} rotation-z={Math.PI / 2} />
          <mesh geometry={geo.box(0.04, 0.12, 0.12)} material={toon(accent)} />
        </group>
      );
  }
}

// ---------------------------------------------------------------------------------------------
// Outfit (body-space: torso centre y=0.33, shoulders y=0.43)

export function Outfit({ a }: { a: Appearance }) {
  const { kind, color, accent, stripes } = a.outfit;
  if (kind === 'none') return null;
  const shirt = (
    <P geo={geo.capsule(0.168, 0.12, 6, 14)} color={color} position={[0, 0.34, 0]} scale={[1, 0.9, 0.92]} />
  );
  return (
    <group>
      {kind === 'duck' ? null : shirt}
      {stripes ? (
        <>
          <mesh geometry={shapes.band(0.172, 0.03)} material={toon(accent, true)} position={[0, 0.39, 0]} scale={[1, 1, 0.92]} />
          <mesh geometry={shapes.band(0.172, 0.03)} material={toon(accent, true)} position={[0, 0.31, 0]} scale={[1, 1, 0.92]} />
        </>
      ) : null}
      {kind === 'suit' ? (
        <>
          <mesh geometry={geo.cone(0.08, 0.14, 3)} material={toon('#f4f1ea')} position={[0, 0.4, 0.145]} rotation={[Math.PI, 0, 0]} scale={[1, 1, 0.4]} />
          <mesh geometry={geo.box(0.035, 0.12, 0.02)} material={toon(accent)} position={[0, 0.37, 0.16]} />
        </>
      ) : null}
      {kind === 'jacket' ? <mesh geometry={geo.box(0.02, 0.2, 0.02)} material={toon(accent)} position={[0, 0.34, 0.158]} /> : null}
      {kind === 'vest' ? (
        <mesh geometry={geo.box(0.07, 0.2, 0.02)} material={toon(a.skin.fur)} position={[0, 0.35, 0.155]} />
      ) : null}
      {kind === 'hoodie' ? (
        <>
          <P geo={geo.torus(0.13, 0.06, 6, 16)} color={color} position={[0, 0.5, -0.06]} rotation-x={Math.PI / 2 + 0.5} />
          <mesh geometry={geo.box(0.14, 0.06, 0.02)} material={toon(accent)} position={[0, 0.29, 0.158]} />
        </>
      ) : null}
      {kind === 'robe' ? (
        <>
          <P geo={geo.cylinder(0.17, 0.25, 0.26, 14)} color={color} position={[0, 0.16, 0]} />
          <mesh geometry={shapes.band(0.172, 0.035)} material={toon(accent, true)} position={[0, 0.3, 0]} />
        </>
      ) : null}
      {kind === 'armor' ? (
        <>
          {[-1, 1].map((s) => (
            <P key={s} geo={shapes.dome(0.08)} color={accent} position={[s * 0.18, 0.44, 0]} />
          ))}
          <mesh geometry={geo.box(0.12, 0.08, 0.02)} material={toon(accent)} position={[0, 0.38, 0.16]} />
        </>
      ) : null}
      {kind === 'jumpsuit' ? (
        <>
          <P geo={geo.capsule(0.072, 0.08, 4, 10)} color={color} position={[-0.085, 0.17, 0]} />
          <P geo={geo.capsule(0.072, 0.08, 4, 10)} color={color} position={[0.085, 0.17, 0]} />
        </>
      ) : null}
      {kind === 'duck' ? (
        <group position={[0, 0.25, 0]}>
          <P geo={geo.torus(0.2, 0.075, 8, 20)} color={color} rotation-x={Math.PI / 2} />
          <P geo={geo.sphere(0.08, 10, 8)} color={color} position={[-0.16, 0.1, 0.16]} />
          <mesh geometry={geo.cone(0.03, 0.07, 6)} material={toon(accent)} position={[-0.16, 0.1, 0.25]} rotation-x={Math.PI / 2} />
        </group>
      ) : null}
    </group>
  );
}

/** Sleeve colour for the upper arm, or null for bare fur. */
export function sleeveColor(a: Appearance): string | null {
  return ['tee', 'suit', 'hoodie', 'robe', 'jacket', 'armor', 'jumpsuit'].includes(a.outfit.kind) ? a.outfit.color : null;
}

// ---------------------------------------------------------------------------------------------
// Eyes: rendered inside the blinking eye group, centred between the eyes at the face surface.

const EYE_X = 0.086;

function EyeBall({ x, color, lid }: { x: number; color: string; lid?: boolean }) {
  return (
    <group position={[x, 0, 0.232]} rotation-y={x * 1.7}>
      <mesh material={toon(color)} geometry={geo.sphere(0.07, 18, 14)} scale={[0.82, lid ? 0.55 : 1, 0.34]} position={[0, lid ? -0.015 : 0, 0]} />
      <mesh material={toon('#ffffff')} geometry={geo.sphere(0.021, 10, 8)} position={[0.022, lid ? 0.0 : 0.026, 0.022]} />
      {!lid ? <mesh material={toon('#ffffff')} geometry={geo.sphere(0.009, 8, 6)} position={[-0.016, -0.026, 0.02]} /> : null}
    </group>
  );
}

export function Eyes({ a, beams = true }: { a: Appearance; beams?: boolean }) {
  const { kind, color } = a.eyes;
  const beam = useMemo(() => glowMaterial(color, 0.85), [color]);
  const both = (render: (x: number) => React.ReactNode) => [-EYE_X, EYE_X].map((x) => <group key={x}>{render(x)}</group>);
  switch (kind) {
    case 'round':
      return <>{both((x) => <EyeBall x={x} color={color} />)}</>;
    case 'lidded':
      return <>{both((x) => <EyeBall x={x} color={color} lid />)}</>;
    case 'crying':
      return (
        <>
          {both((x) => (
            <>
              <EyeBall x={x} color={color} />
              <mesh geometry={geo.capsule(0.016, 0.1, 4, 6)} material={toon('#9fd8f5')} position={[x * 1.2, -0.09, 0.225]} />
            </>
          ))}
        </>
      );
    case 'happy':
      return (
        <>
          {both((x) => (
            <mesh geometry={geo.torus(0.04, 0.011, 4, 10, Math.PI)} material={toon(color)} position={[x, -0.005, 0.24]} rotation-y={x * 1.7} />
          ))}
        </>
      );
    case 'laser':
      return (
        <>
          {both((x) => (
            <>
              <mesh geometry={geo.sphere(0.05, 12, 10)} material={glowMaterial(color)} position={[x, 0, 0.235]} scale={[1, 1, 0.4]} />
              {beams ? <mesh geometry={geo.cylinder(0.022, 0.03, 2.4, 6)} material={beam} position={[x, -0.01, 1.45]} rotation-x={Math.PI / 2} /> : null}
            </>
          ))}
        </>
      );
    case 'glasses':
      return (
        <>
          {both((x) => (
            <>
              <EyeBall x={x} color="#120c1c" />
              <mesh geometry={geo.torus(0.062, 0.013, 6, 18)} material={toon(color)} position={[x, 0, 0.25]} rotation-y={x * 1.6} />
            </>
          ))}
          <mesh geometry={geo.box(0.06, 0.012, 0.012)} material={toon(color)} position={[0, 0.01, 0.262]} />
        </>
      );
    case 'btc':
      return (
        <>
          {both((x) => (
            <group position={[x, 0, 0.25]} rotation-y={x * 1.6}>
              <mesh geometry={geo.cylinder(0.068, 0.068, 0.02, 18)} material={toon(color)} rotation-x={Math.PI / 2} />
              <mesh geometry={geo.box(0.03, 0.07, 0.01)} material={toon('#ffffff')} position={[0, 0, 0.012]} />
            </group>
          ))}
          <mesh geometry={geo.box(0.06, 0.012, 0.012)} material={toon('#f39a1e')} position={[0, 0.02, 0.262]} />
        </>
      );
    case 'visor':
      return (
        <group position={[0, 0.01, 0.15]}>
          <mesh geometry={shapes.band(0.13, 0.08)} material={glowMaterial(color, 0.95)} rotation-y={0} scale={[1.55, 1, 0.75]} />
        </group>
      );
    case 'vr':
      return (
        <group position={[0, 0.01, 0.24]}>
          <P geo={geo.box(0.26, 0.11, 0.09)} color={color} />
          <mesh geometry={geo.box(0.22, 0.06, 0.01)} material={glowMaterial('#7be0ff')} position={[0, 0, 0.047]} />
        </group>
      );
    case 'thug':
      return <mesh geometry={geo.box(0.26, 0.055, 0.03)} material={toon('#120c1c')} position={[0, 0.01, 0.25]} />;
    case 'dead':
      return (
        <>
          {both((x) => (
            <group position={[x, 0, 0.245]} rotation-y={x * 1.6}>
              <mesh geometry={geo.box(0.08, 0.016, 0.01)} material={toon('#120c1c')} rotation-z={0.8} />
              <mesh geometry={geo.box(0.08, 0.016, 0.01)} material={toon('#120c1c')} rotation-z={-0.8} />
            </group>
          ))}
        </>
      );
    case 'heart':
      return (
        <>
          {both((x) => (
            <group position={[x, 0, 0.245]} rotation-y={x * 1.6}>
              <mesh geometry={geo.sphere(0.03, 8, 6)} material={toon(color)} position={[-0.022, 0.012, 0]} scale={[1, 1, 0.5]} />
              <mesh geometry={geo.sphere(0.03, 8, 6)} material={toon(color)} position={[0.022, 0.012, 0]} scale={[1, 1, 0.5]} />
              <mesh geometry={geo.cone(0.045, 0.06, 4)} material={toon(color)} position={[0, -0.025, 0]} rotation-z={Math.PI} scale={[1, 1, 0.4]} />
            </group>
          ))}
        </>
      );
  }
}

// ---------------------------------------------------------------------------------------------
// Mouth (head-space)

export function Mouth({ a }: { a: Appearance }) {
  const arc = (flip: boolean, color = INKY, r = 0.028) => (
    <mesh geometry={geo.torus(r, 0.006, 4, 10, Math.PI)} material={toon(color)} position={[0, flip ? -0.115 : -0.105, 0.236]} rotation-z={flip ? 0 : Math.PI} scale={[1, 1, 0.4]} />
  );
  switch (a.mouth) {
    case 'smile':
      return arc(false);
    case 'sad':
      return arc(true);
    case 'flat':
      return <mesh geometry={geo.box(0.05, 0.008, 0.01)} material={toon(INKY)} position={[0, -0.11, 0.238]} />;
    case 'open':
      return <mesh geometry={geo.sphere(0.022, 8, 6)} material={toon('#5a1530')} position={[0, -0.11, 0.232]} scale={[1, 1.2, 0.5]} />;
    case 'clown':
      return (
        <>
          {arc(false, '#d9473b', 0.05)}
          <mesh geometry={geo.sphere(0.035, 10, 8)} material={toon('#e0334f')} position={[0, -0.06, 0.255]} />
        </>
      );
    case 'drool':
      return (
        <>
          {arc(false)}
          <mesh geometry={geo.capsule(0.009, 0.05, 4, 6)} material={toon('#9fd8f5')} position={[0.02, -0.15, 0.228]} />
        </>
      );
    case 'gum':
      return <mesh geometry={geo.sphere(0.06, 14, 10)} material={toon('#f59ac0')} position={[0, -0.115, 0.27]} />;
    case 'coin':
      return (
        <mesh geometry={geo.cylinder(0.045, 0.045, 0.015, 16)} material={toon('#f2c230')} position={[0, -0.115, 0.25]} rotation-x={Math.PI / 2} />
      );
    case 'goldTooth':
      return (
        <>
          {arc(false)}
          <mesh geometry={geo.box(0.014, 0.016, 0.01)} material={toon('#f2c230')} position={[0.012, -0.122, 0.236]} />
        </>
      );
    case 'puke':
      return (
        <group position={[0, -0.12, 0.25]} rotation-x={0.5}>
          {['#e0334f', '#f2c230', '#4c9a52', '#3b6fd0'].map((c, i) => (
            <mesh key={c} geometry={geo.box(0.018, 0.22, 0.012)} material={toon(c)} position={[(i - 1.5) * 0.018, -0.11, 0]} />
          ))}
        </group>
      );
  }
}

// ---------------------------------------------------------------------------------------------
// Held item (in the right mitten, arm-space: mitten centre y=-0.19)

export function Held({ a }: { a: Appearance }) {
  switch (a.held) {
    case 'none':
    case 'cigar':
      return null;
    case 'frog':
      return (
        <group position={[0, -0.22, 0.08]}>
          <P geo={geo.sphere(0.075, 12, 10)} color="#5fbf55" scale={[1.1, 0.85, 1]} />
          {[-0.035, 0.035].map((x) => (
            <mesh key={x} geometry={geo.sphere(0.022, 8, 6)} material={toon('#ffffff')} position={[x, 0.06, 0.04]} />
          ))}
          <mesh geometry={geo.torus(0.025, 0.006, 4, 8, Math.PI)} material={toon('#d9473b')} position={[0, 0, 0.075]} rotation-z={Math.PI} />
        </group>
      );
    case 'coin':
      return <P geo={geo.cylinder(0.06, 0.06, 0.018, 16)} color="#f2c230" position={[0, -0.22, 0.07]} rotation-x={Math.PI / 2} />;
    case 'candleGreen':
    case 'candleRed': {
      const c = a.held === 'candleGreen' ? '#3fbf5a' : '#e0334f';
      return (
        <group position={[0, -0.2, 0.08]}>
          <P geo={geo.box(0.06, 0.16, 0.06)} color={c} />
          <mesh geometry={geo.box(0.012, 0.28, 0.012)} material={toon(c)} />
        </group>
      );
    }
    case 'heart':
      return (
        <group position={[0, -0.21, 0.08]}>
          <mesh geometry={geo.sphere(0.045, 10, 8)} material={toon('#e0334f')} position={[-0.03, 0.02, 0]} />
          <mesh geometry={geo.sphere(0.045, 10, 8)} material={toon('#e0334f')} position={[0.03, 0.02, 0]} />
          <mesh geometry={geo.cone(0.07, 0.08, 4)} material={toon('#e0334f')} position={[0, -0.035, 0]} rotation-z={Math.PI} />
        </group>
      );
    case 'knife':
      return (
        <group position={[0, -0.2, 0.06]} rotation-x={-1.2}>
          <mesh geometry={geo.box(0.03, 0.08, 0.03)} material={toon('#5a3a22')} />
          <P geo={geo.box(0.04, 0.16, 0.012)} color="#d6dde3" position={[0, 0.12, 0]} />
        </group>
      );
  }
}

/** Cigar sits in the mouth rather than the hand. */
export function MouthProp({ a }: { a: Appearance }) {
  if (a.held !== 'cigar') return null;
  return (
    <group position={[0.06, -0.115, 0.25]} rotation={[0.2, 0.4, -0.15]}>
      <mesh geometry={geo.cylinder(0.014, 0.014, 0.14, 8)} material={toon('#6b4226')} rotation-z={Math.PI / 2} position={[0.06, 0, 0]} />
      <mesh geometry={geo.sphere(0.015, 6, 4)} material={glowMaterial('#ff7a2c')} position={[0.13, 0, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------

export function Aura({ color, reducedMotion }: { color: string; reducedMotion: boolean }) {
  const ring = useRef<THREE.Group>(null!);
  const spark = useMemo(() => glowMaterial(color, 0.9), [color]);
  const floor = useMemo(() => glowMaterial(color, 0.22), [color]);
  useFrame(({ clock }) => {
    if (reducedMotion) return;
    ring.current.rotation.y = clock.elapsedTime * 1.4;
    ring.current.children.forEach((s, i) => (s.position.y = 0.35 + Math.sin(clock.elapsedTime * 2.2 + i) * 0.12));
  });
  return (
    <group>
      <mesh geometry={geo.cylinder(0.62, 0.62, 0.01, 28)} material={floor} position-y={0.03} />
      <group ref={ring}>
        {Array.from({ length: 7 }, (_, i) => {
          const t = (i / 7) * Math.PI * 2;
          return <mesh key={i} geometry={shapes.octahedron(0.045)} material={spark} position={[Math.cos(t) * 0.55, 0.35, Math.sin(t) * 0.55]} />;
        })}
      </group>
    </group>
  );
}
