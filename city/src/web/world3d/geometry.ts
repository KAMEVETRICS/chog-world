// Cached primitive geometries. Shared across every instance of a model, and passed to meshes as
// real objects (not JSX children) so helpers like <Outlines> see the final geometry on mount.
import * as THREE from 'three';

const cache = new Map<string, THREE.BufferGeometry>();

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = cache.get(key) as T | undefined;
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

export const geo = {
  sphere: (r: number, w = 16, h = 12) => cached(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)),
  capsule: (r: number, l: number, cap = 4, radial = 10) =>
    cached(`c${r},${l},${cap},${radial}`, () => new THREE.CapsuleGeometry(r, l, cap, radial)),
  cone: (r: number, h: number, radial = 6) => cached(`k${r},${h},${radial}`, () => new THREE.ConeGeometry(r, h, radial)),
  torus: (r: number, tube: number, radial = 8, tubular = 16, arc = Math.PI * 2) =>
    cached(`t${r},${tube},${radial},${tubular},${arc}`, () => new THREE.TorusGeometry(r, tube, radial, tubular, arc)),
  box: (w: number, h: number, d: number) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cylinder: (top: number, bottom: number, h: number, radial = 8) =>
    cached(`y${top},${bottom},${h},${radial}`, () => new THREE.CylinderGeometry(top, bottom, h, radial)),
  icosahedron: (r: number, detail = 0) => cached(`i${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail)),
  dodecahedron: (r: number) => cached(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
};

/** Uniform scale that grows a geometry outward by roughly `thickness` world units. */
export function hullScale(geometry: THREE.BufferGeometry, thickness: number): number {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  return 1 + thickness / Math.max(0.01, geometry.boundingSphere!.radius);
}

/** Gable roof: triangular prism with the ridge along X, eaves facing ±Z. Base at y=0. */
export function gable(width: number, height: number, depth: number): THREE.BufferGeometry {
  return cached(`g${width},${height},${depth}`, () => {
    const shape = new THREE.Shape();
    shape.moveTo(-depth / 2, 0);
    shape.lineTo(depth / 2, 0);
    shape.lineTo(0, height);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    g.translate(0, 0, -width / 2);
    g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}

/** Flat ribbon along a polyline in the XZ plane (roads). Not cached: built once per road. */
export function ribbon(points: [number, number][], width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  points.forEach(([x, z], i) => {
    const [px, pz] = points[Math.max(0, i - 1)]!;
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)]!;
    const dx = nx - px;
    const dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1;
    const ox = (-dz / len) * (width / 2);
    const oz = (dx / len) * (width / 2);
    positions.push(x + ox, 0, z + oz, x - ox, 0, z - oz);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  // Winding can flip per segment; force every normal up so lighting is uniform.
  const normals = g.getAttribute('normal');
  for (let i = 0; i < normals.count; i += 1) normals.setXYZ(i, 0, 1, 0);
  return g;
}

export const shapes = {
  /** Upper hemisphere, base at y=0. */
  dome: (r: number) => cached(`dome${r}`, () => new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
  octahedron: (r: number) => cached(`oct${r}`, () => new THREE.OctahedronGeometry(r, 0)),
  /** Open cylinder band (no caps). */
  band: (r: number, h: number) => cached(`band${r},${h}`, () => new THREE.CylinderGeometry(r, r, h, 16, 1, true)),
};
