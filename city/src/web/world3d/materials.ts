// Cel-shaded material set, matching the inked cartoon look of official Chog art.
import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** Three hard light bands: shadow, mid, lit. */
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const tones = new Uint8Array([150, 150, 150, 255, 212, 212, 212, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(tones, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

const cache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: string, doubleSided = false): THREE.MeshToonMaterial {
  const key = doubleSided ? `${color}|2` : color;
  let material = cache.get(key);
  if (!material) {
    material = new THREE.MeshToonMaterial({
      color,
      gradientMap: toonGradient(),
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    cache.set(key, material);
  }
  return material;
}

/** Shared night factor (0 day .. 1 night), written by the day cycle, read by lights. */
export const night = { value: 0 };

/** Windows and lanterns glow at night; the day cycle drives `emissiveIntensity` on these. */
export const glow = {
  window: new THREE.MeshToonMaterial({ color: '#ffe3a0', emissive: '#ffb84d', emissiveIntensity: 0, gradientMap: toonGradient() }),
  lamp: new THREE.MeshToonMaterial({ color: '#ffe7a8', emissive: '#ffc35c', emissiveIntensity: 0.2, gradientMap: toonGradient() }),
};

export const INK = '#1e1530';

/** Inverted-hull ink outline: back faces only, drawn slightly larger than the part. */
export const inkHull = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

export const PALETTE = {
  chog: '#5b36b0',
  chogDeep: '#41228f',
  chogMask: '#fbf3cd',
  chogPink: '#d4407c',
  chogPinkDeep: '#9a2463',
  eye: '#120c1c',
  grass: '#9cc66b',
  grassDeep: '#86b158',
  earth: '#a87a4c',
  earthDeep: '#7b5634',
  path: '#e8d3a2',
  pathEdge: '#cdb27c',
  wood: '#a5683a',
  woodDark: '#7a4a28',
  plaster: '#f6e8c8',
  roof: '#d0573c',
  roofDark: '#a8432d',
  slate: '#6c7b8c',
  stone: '#b6bec4',
  stoneDark: '#8c979f',
  leaf: '#5f9446',
  leafLight: '#7fb15a',
  pine: '#3f7a4a',
  wheat: '#e6c25a',
  soil: '#9c7046',
  water: '#76c2cf',
  cobble: '#e6dac0',
} as const;
