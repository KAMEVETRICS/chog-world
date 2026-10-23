// A cel-shaded mesh with an optional inked outline: the building block for every 3D model.
import * as THREE from 'three';
import { hullScale } from './geometry';
import { inkHull, toon } from './materials';

export function Part({
  geo: geometry,
  color,
  outline = 0,
  shadow = true,
  receive = true,
  ...props
}: {
  geo: THREE.BufferGeometry;
  color: string;
  /** Outline thickness in world units; 0 for none. */
  outline?: number;
  shadow?: boolean;
  /** Faces skip self-shadowing so hats don't smudge them. */
  receive?: boolean;
} & Omit<React.ComponentProps<'mesh'>, 'geometry'>) {
  return (
    <mesh geometry={geometry} material={toon(color)} castShadow={shadow} receiveShadow={receive} {...props}>
      {outline > 0 ? <mesh geometry={geometry} material={inkHull} scale={hullScale(geometry, outline)} /> : null}
    </mesh>
  );
}
