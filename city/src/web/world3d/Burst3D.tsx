// A burst of confetti in the village palette: thrown up from a home, a project or the Plaza, tumbling down
// under gravity, gone in a couple of seconds. One instanced mesh per burst, so even a big one is cheap.
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

const COLOURS = ['#7b5ce0', '#f0c22e', '#ee8db6', '#3fb5de', '#9cc66b', '#ffffff', '#e07a5f'];
const LIFE = 2.4;
const GRAVITY = 6.5;

interface Piece {
  p: THREE.Vector3;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  r: THREE.Euler;
}

export function Burst3D({ at, big, seed, onDone }: { at: [number, number, number]; big: boolean; seed: number; onDone: () => void }) {
  const count = big ? 90 : 30;
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const age = useRef(0);
  const finished = useRef(false);
  const pieces = useMemo<Piece[]>(() => {
    // Seeded so a burst looks the same however often the frame re-renders.
    let s = seed * 9301 + 49297;
    const rnd = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    return Array.from({ length: count }, () => {
      const a = rnd() * Math.PI * 2;
      const out = (big ? 2.6 : 1.5) * (0.4 + rnd() * 0.6);
      return {
        p: new THREE.Vector3(0, 0, 0),
        v: new THREE.Vector3(Math.cos(a) * out, (big ? 7 : 4.4) * (0.7 + rnd() * 0.5), Math.sin(a) * out),
        spin: new THREE.Vector3(rnd() * 9 - 4.5, rnd() * 9 - 4.5, rnd() * 9 - 4.5),
        r: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6),
      };
    });
  }, [count, big, seed]);

  useLayoutEffect(() => {
    const colour = new THREE.Color();
    pieces.forEach((_, i) => mesh.current.setColorAt(i, colour.set(COLOURS[i % COLOURS.length]!)));
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [pieces]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    age.current += dt;
    const fade = Math.max(0, 1 - Math.max(0, age.current - LIFE * 0.6) / (LIFE * 0.4));
    pieces.forEach((piece, i) => {
      piece.v.y -= GRAVITY * dt;
      piece.v.multiplyScalar(1 - dt * 0.9); // air drag, so confetti drifts rather than drops
      piece.p.addScaledVector(piece.v, dt);
      piece.r.x += piece.spin.x * dt;
      piece.r.y += piece.spin.y * dt;
      piece.r.z += piece.spin.z * dt;
      dummy.position.copy(piece.p);
      dummy.rotation.copy(piece.r);
      dummy.scale.setScalar(fade);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (age.current > LIFE && !finished.current) {
      finished.current = true;
      onDone();
    }
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} position={at} frustumCulled={false}>
      {/* sized to read from the village view, not just close up */}
      <planeGeometry args={[0.24, 0.14]} />
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  );
}
