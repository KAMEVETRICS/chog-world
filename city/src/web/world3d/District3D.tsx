// Newcomers' Row: the citizens' islet north of the village, joined by a footbridge. View data only: the
// simulation knows lot IDs, never coordinates.
import { memo, useMemo } from 'react';
import * as THREE from 'three';
import { geo } from './geometry';
import { PALETTE as C, toon } from './materials';
import type { XZ } from './layout';

/** Lot centres across a row: five each side of the path to the bridge. */
const COLUMNS = [-7.5, -6, -4.5, -3, -1.5, 1.5, 3, 4.5, 6, 7.5];
/**
 * Three rows of ten (c01-c30, filled front row first). Row 1 faces the front lane and the bridge; rows 2 and 3
 * face each other across the back lane. Lot IDs follow City's world file; positions are view data only.
 */
const ROWS: ReadonlyArray<{ z: number; r: number }> = [
  { z: -15.2, r: 0 },
  { z: -17.4, r: Math.PI },
  { z: -19.8, r: 0 },
];
export const LOTS: Record<string, { x: number; z: number; r: number }> = Object.fromEntries(
  ROWS.flatMap((row, ri) => COLUMNS.map((x, ci) => [`c${String(ri * COLUMNS.length + ci + 1).padStart(2, '0')}`, { x, z: row.z, r: row.r }])),
);

const ISLET = { x0: -9.2, x1: 9.2, z0: -21.2, z1: -13.0, r: 1.6 };
/** The front lane (row 1's gates), the back lane (between rows 2 and 3) and the path joining them. */
const LANES = { front: -14.0, back: -18.6 };
const BRIDGE = { z0: -13.25, z1: -9.55, width: 0.9 };

/** Where villagers cross to the village: the bridge's two ends. */
export const BRIDGE_ENDS: [XZ, XZ] = [
  [0, BRIDGE.z0 + 0.3],
  [0, BRIDGE.z1 - 0.3],
];

function isletShape(grow = 0): THREE.Shape {
  const { x0, x1, z0, z1, r } = ISLET;
  const s = new THREE.Shape();
  const [a0, a1, b0, b1] = [x0 - grow, x1 + grow, -z1 - grow, -z0 + grow]; // shape space is (x, -z)
  s.moveTo(a0 + r, b0);
  s.lineTo(a1 - r, b0);
  s.quadraticCurveTo(a1, b0, a1, b0 + r);
  s.lineTo(a1, b1 - r);
  s.quadraticCurveTo(a1, b1, a1 - r, b1);
  s.lineTo(a0 + r, b1);
  s.quadraticCurveTo(a0, b1, a0, b1 - r);
  s.lineTo(a0, b0 + r);
  s.quadraticCurveTo(a0, b0, a0 + r, b0);
  return s;
}

export const District3D = memo(function District3D() {
  const [top, lower, foam] = useMemo(() => {
    const t = new THREE.ExtrudeGeometry(isletShape(), { depth: 0.55, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.1, bevelSegments: 1, curveSegments: 6 });
    t.rotateX(-Math.PI / 2);
    t.translate(0, -0.63, 0);
    const l = new THREE.ExtrudeGeometry(isletShape(-0.1), { depth: 1.3, bevelEnabled: false, curveSegments: 6 });
    l.rotateX(-Math.PI / 2);
    l.translate(0, -1.85, 0);
    const f = new THREE.ShapeGeometry(isletShape(0.35), 6);
    f.rotateX(-Math.PI / 2);
    return [t, l, f];
  }, []);
  const length = BRIDGE.z1 - BRIDGE.z0;
  const planks = Math.round(length / 0.32);
  return (
    <group>
      <mesh geometry={top} material={[toon(C.grass), toon(C.earth)]} receiveShadow />
      <mesh geometry={lower} material={toon(C.earthDeep)} />
      <mesh geometry={foam} position-y={-0.43}>
        <meshBasicMaterial color="#e9f6f4" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {/* lanes along the rows, and the path from the bridge through the middle */}
      <mesh geometry={geo.box(16.6, 0.02, 0.7)} material={toon('#e6d4ab')} position={[0, 0.01, LANES.front]} receiveShadow />
      <mesh geometry={geo.box(16.6, 0.02, 0.6)} material={toon('#e6d4ab')} position={[0, 0.01, LANES.back]} receiveShadow />
      <mesh geometry={geo.box(0.9, 0.021, LANES.front - LANES.back)} material={toon('#e6d4ab')} position={[0, 0.01, (LANES.front + LANES.back) / 2]} receiveShadow />
      {/* the footbridge to the village's north lane */}
      <group position={[0, 0, (BRIDGE.z0 + BRIDGE.z1) / 2]}>
        {Array.from({ length: planks }, (_, i) => (
          <mesh
            key={i}
            geometry={geo.box(BRIDGE.width, 0.06, 0.26)}
            material={toon(i % 2 ? '#b98a5a' : '#c69766')}
            position={[0, 0.06, -length / 2 + (i + 0.5) * (length / planks)]}
            castShadow
            receiveShadow
          />
        ))}
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh geometry={geo.box(0.05, 0.05, length)} material={toon(C.woodDark)} position={[(side * BRIDGE.width) / 2, 0.42, 0]} />
            {Array.from({ length: 6 }, (_, i) => (
              <mesh key={i} geometry={geo.box(0.06, 0.42, 0.06)} material={toon(C.woodDark)} position={[(side * BRIDGE.width) / 2, 0.21, -length / 2 + (i / 5) * length]} castShadow />
            ))}
          </group>
        ))}
      </group>
    </group>
  );
});
