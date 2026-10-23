// Live scene nodes of residents, by key, so the camera can follow a Chog or villager as it walks
// (committed positions jump a tick at a time; the rendered body moves smoothly between them).
import type * as THREE from 'three';

const nodes = new Map<string, THREE.Object3D>();

export function track(key: string, node: THREE.Object3D): () => void {
  nodes.set(key, node);
  return () => {
    if (nodes.get(key) === node) nodes.delete(key);
  };
}

export const tracked = (key: string): THREE.Object3D | undefined => nodes.get(key);
