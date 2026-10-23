// Growth districts in 3D: each a small island with a lane and a footbridge to the main island, drawn only
// once the town has grown into it (see world/growth.ts). Homes on it are drawn by the scene like any plot.
import { memo, useMemo } from 'react';
import * as THREE from 'three';
import { geo } from './geometry';
import { Pine, RoundTree } from './models';
import { PALETTE as C, toon } from './materials';
import { DISTRICT_SIZE, local, type DistrictLayout, type XZ } from './layout';

function islandShape(length: number, width: number, grow: number, r = 1.4): THREE.Shape {
  const [a0, a1, b0, b1] = [-length / 2 - grow, length / 2 + grow, -width / 2 - grow, width / 2 + grow];
  const s = new THREE.Shape();
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

/** A planked footbridge with rails, from `from` to `to` on the water. */
export function Footbridge({ from, to, width = 0.9 }: { from: XZ; to: XZ; width?: number }) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const yaw = Math.atan2(to[0] - from[0], to[1] - from[1]);
  const planks = Math.max(2, Math.round(length / 0.32));
  return (
    <group position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]} rotation-y={yaw}>
      {Array.from({ length: planks }, (_, i) => (
        <mesh
          key={i}
          geometry={geo.box(width, 0.06, 0.26)}
          material={toon(i % 2 ? '#b98a5a' : '#c69766')}
          position={[0, 0.06, -length / 2 + (i + 0.5) * (length / planks)]}
          castShadow
          receiveShadow
        />
      ))}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh geometry={geo.box(0.05, 0.05, length)} material={toon(C.woodDark)} position={[(side * width) / 2, 0.42, 0]} />
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} geometry={geo.box(0.06, 0.42, 0.06)} material={toon(C.woodDark)} position={[(side * width) / 2, 0.21, -length / 2 + (i / 5) * length]} castShadow />
          ))}
        </group>
      ))}
    </group>
  );
}

export const GrowthDistrict3D = memo(function GrowthDistrict3D({ district }: { district: DistrictLayout }) {
  const { length, width } = DISTRICT_SIZE;
  const [top, lower, foam] = useMemo(() => {
    const t = new THREE.ExtrudeGeometry(islandShape(length, width, 0), { depth: 0.55, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.1, bevelSegments: 1, curveSegments: 6 });
    t.rotateX(-Math.PI / 2);
    t.translate(0, -0.63, 0);
    const l = new THREE.ExtrudeGeometry(islandShape(length, width, -0.1), { depth: 1.3, bevelEnabled: false, curveSegments: 6 });
    l.rotateX(-Math.PI / 2);
    l.translate(0, -1.85, 0);
    const f = new THREE.ShapeGeometry(islandShape(length, width, 0.35), 6);
    f.rotateX(-Math.PI / 2);
    return [t, l, f];
  }, [length, width]);
  const [cx, cz] = district.centre;
  const laneEnd = local(cx, cz, district.yaw, (district.bridgeEnd * length) / 2, 0);
  return (
    <group>
      <group position={[cx, 0, cz]} rotation-y={district.yaw}>
        <mesh geometry={top} material={[toon(C.grass), toon(C.earth)]} receiveShadow />
        <mesh geometry={lower} material={toon(C.earthDeep)} />
        <mesh geometry={foam} position-y={-0.43}>
          <meshBasicMaterial color="#e9f6f4" transparent opacity={0.55} depthWrite={false} />
        </mesh>
        {/* the lane between the two rows of homes */}
        <mesh geometry={geo.box(length - 0.8, 0.02, 0.7)} material={toon(C.path)} position={[0, 0.01, 0]} receiveShadow />
        {/* a pine and a round tree at the far end, beyond the last homes */}
        <group position={[-district.bridgeEnd * (length / 2 - 0.5), 0, width / 2 - 0.75]}>
          <Pine scale={0.62} />
        </group>
        <group position={[-district.bridgeEnd * (length / 2 - 0.55), 0, -(width / 2 - 0.8)]}>
          <RoundTree scale={0.58} tint={C.leafLight} />
        </group>
      </group>
      <Footbridge from={district.bridge[0]} to={laneEnd} />
    </group>
  );
});
