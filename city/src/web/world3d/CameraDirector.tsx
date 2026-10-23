// The camera's director: frames the village around the interface, glides to shots, and follows a
// resident as it walks. The player can always orbit and zoom; dragging the map lets go of a follow.
//
// Framing: the HUD (goals card, journal panel, phone bottom sheet) covers part of the screen, so the
// projection is shifted (setViewOffset) to centre the view in what is actually visible. Orbiting then
// turns around the middle of the visible world, not a point hidden behind a panel.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { tracked } from './tracking';

/** `free`: the player has the camera (after letting go of a follow); nothing moves it. */
export type CameraShot = { kind: 'village'; n: number } | { kind: 'follow'; key: string; n: number } | { kind: 'free'; n: number };

/** The village heart: plots, Plaza, tavern and workshop. The opening shot and "Village view" frame it. */
const VILLAGE = { centre: new THREE.Vector3(0.6, 0, 0.6), width: 21, depth: 16 };
export const VILLAGE_CENTRE: [number, number, number] = [VILLAGE.centre.x, VILLAGE.centre.y, VILLAGE.centre.z];

/** The ground the town covers right now: the village view frames it, and the camera never wanders far off it. */
export interface TownFrame {
  x: [number, number];
  z: [number, number];
}
/** The village heart alone, before any district has grown. */
export const VILLAGE_FRAME: TownFrame = {
  x: [VILLAGE.centre.x - VILLAGE.width / 2, VILLAGE.centre.x + VILLAGE.width / 2],
  z: [VILLAGE.centre.z - VILLAGE.depth / 2, VILLAGE.centre.z + VILLAGE.depth / 2],
};
/** How far past the town's edge the camera may look, and Newcomers' Row's far side (always in reach). */
const ROAM = 2;
const NEWCOMERS_NORTH = -19;

const centreOf = (f: TownFrame) => new THREE.Vector3((f.x[0] + f.x[1]) / 2, 0, (f.z[0] + f.z[1]) / 2);
/** The opening shot starts this much farther out and glides in. */
const INTRO_PULL = 1.55;
/** The follow cam frames this much ground around the resident (it and its neighbours); the player may zoom from there. */
const FOLLOW_AREA = { width: 7, depth: 6, nearest: 9, farthest: 30 };
/** Looking down at about 52 degrees: faces stay readable, roofs don't hide the streets. */
const POLAR = 0.92;
/** A panel covers a side when it spans this much of the screen's height; anything at least `BAR` wide is a top or bottom bar. */
const SPAN = 0.35;
const BAR = 0.6;
const NEAR_ENOUGH = 0.02;

interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What the HUD covers, from elements marked `data-occluder`, in CSS pixels. */
export function measureInsets(canvas: HTMLElement): Insets {
  const box = canvas.getBoundingClientRect();
  const insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  document.querySelectorAll<HTMLElement>('[data-occluder]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (r.height >= box.height * SPAN && r.width < box.width * BAR) {
      if (r.left + r.width / 2 < box.left + box.width / 2) insets.left = Math.max(insets.left, r.right - box.left);
      else insets.right = Math.max(insets.right, box.right - r.left);
    } else if (r.width >= box.width * BAR) {
      if (r.top + r.height / 2 > box.top + box.height / 2) insets.bottom = Math.max(insets.bottom, box.bottom - r.top);
      else insets.top = Math.max(insets.top, r.bottom - box.top);
    }
  });
  return insets;
}

/** Distance at which a ground area of `width` x `depth` fills the visible part of the screen. */
export function fitDistance(camera: THREE.PerspectiveCamera, size: { width: number; height: number }, insets: Insets, width: number, depth: number): number {
  const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / size.height; // world units per px, per unit of distance
  const visibleW = Math.max(160, size.width - insets.left - insets.right);
  const visibleH = Math.max(160, size.height - insets.top - insets.bottom);
  const byWidth = width / (visibleW * perPx);
  const byDepth = (depth * Math.cos(POLAR)) / (visibleH * perPx);
  return Math.max(byWidth, byDepth);
}

const offsetFor = (distance: number, azimuth: number) => new THREE.Vector3().setFromSphericalCoords(distance, POLAR, azimuth);

interface Goal {
  target: THREE.Vector3 | null;
  distance: number | null;
  azimuth: number | null;
  polar: number | null;
  speed: number;
}
const idle = (): Goal => ({ target: null, distance: null, azimuth: null, polar: null, speed: 3 });

/** `from` moved towards `to` by `k` the short way round. */
function turn(from: number, to: number, k: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d * k;
}

export function CameraDirector({ shot, reducedMotion, onLetGo, town = VILLAGE_FRAME }: { shot: CameraShot; reducedMotion: boolean; onLetGo: () => void; town?: TownFrame }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // Development handle for inspecting the scene from the console (kept from the previous camera rig).
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__city3d = { scene, camera, controls };

  const insets = useRef<Insets>({ left: 0, right: 0, top: 0, bottom: 0 });
  const shown = useRef({ x: 0, y: 0 });
  /** Where the current shot is heading. Each part is released (null) once reached, so the view is the player's again. */
  const goal = useRef<Goal>(idle());
  const following = useRef<string | null>(null);
  const interacting = useRef(false);
  const lastTarget = useRef(new THREE.Vector3());
  const opened = useRef(false);
  const letGo = useRef(onLetGo);
  letGo.current = onLetGo;
  const townRef = useRef(town);
  townRef.current = town;

  // Keep the HUD measurements fresh: on resize, and whenever a marked panel changes size.
  useEffect(() => {
    const measure = () => {
      insets.current = measureInsets(gl.domElement);
      // Lets HUD pieces centre on the visible world and sit above a phone's bottom sheet.
      const game = gl.domElement.closest<HTMLElement>('.game');
      for (const side of ['left', 'right', 'top', 'bottom'] as const) game?.style.setProperty(`--hud-${side}`, `${Math.round(insets.current[side])}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    document.querySelectorAll('[data-occluder]').forEach((el) => observer.observe(el));
    const rescan = new MutationObserver(() => {
      document.querySelectorAll('[data-occluder]').forEach((el) => observer.observe(el));
      measure();
    });
    rescan.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      rescan.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [gl]);

  // A drag that moves the view (pan) lets go of a follow; rotating and zooming keep it.
  useEffect(() => {
    if (!controls) return;
    const start = () => {
      interacting.current = true;
      lastTarget.current.copy(controls.target);
    };
    const end = () => void (interacting.current = false);
    controls.addEventListener('start', start);
    controls.addEventListener('end', end);
    return () => {
      controls.removeEventListener('start', start);
      controls.removeEventListener('end', end);
    };
  }, [controls]);

  // New shots.
  useEffect(() => {
    if (!controls) return;
    if (shot.kind === 'village') {
      following.current = null;
      const frame = townRef.current;
      const centre = centreOf(frame);
      const distance = THREE.MathUtils.clamp(fitDistance(camera, size, insets.current, frame.x[1] - frame.x[0], frame.z[1] - frame.z[0]), 14, 90);
      if (!opened.current) {
        // Opening shot: start wide over the island and glide down into the village.
        opened.current = true;
        controls.target.copy(centre);
        camera.position.copy(centre).add(offsetFor(distance * (reducedMotion ? 1 : INTRO_PULL), 0));
        controls.update();
        goal.current = reducedMotion ? idle() : { ...idle(), target: centre.clone(), distance, speed: 1.1 };
        return;
      }
      // Back to the village: squared up with its front, at the framing distance.
      goal.current = { target: centre.clone(), distance, azimuth: 0, polar: POLAR, speed: 2.6 };
      return;
    }
    if (shot.kind === 'free') {
      following.current = null;
      goal.current = idle();
      return;
    }
    following.current = shot.key;
    const framed = THREE.MathUtils.clamp(fitDistance(camera, size, insets.current, FOLLOW_AREA.width, FOLLOW_AREA.depth), FOLLOW_AREA.nearest, FOLLOW_AREA.farthest);
    goal.current = { ...idle(), distance: Math.min(camera.position.distanceTo(controls.target), framed), speed: 2.8 };
  }, [controls, shot.kind, shot.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, rawDt) => {
    if (!controls) return;
    const dt = Math.min(rawDt, 0.05);
    const t = controls.target;
    const release = () => {
      following.current = null;
      goal.current = idle();
      letGo.current();
    };

    // The player panned since the last frame (OrbitControls applies drags in its own update): stop following.
    if (interacting.current && following.current && t.distanceToSquared(lastTarget.current) > 1e-6) release();
    // Grabbing the camera mid-glide hands it straight to the player (a follow keeps tracking).
    if (interacting.current) Object.assign(goal.current, { target: null, distance: null, azimuth: null, polar: null });

    // Projection offset towards the centre of what the HUD leaves visible.
    const want = { x: (insets.current.right - insets.current.left) / 2, y: (insets.current.bottom - insets.current.top) / 2 };
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 6);
    shown.current.x += (want.x - shown.current.x) * k;
    shown.current.y += (want.y - shown.current.y) * k;
    if (Math.abs(shown.current.x) > 0.5 || Math.abs(shown.current.y) > 0.5) {
      camera.setViewOffset(size.width, size.height, shown.current.x, shown.current.y, size.width, size.height);
    } else if (camera.view?.enabled) {
      camera.clearViewOffset();
    }

    // Where to look: the followed resident's live body, or the shot's fixed point.
    const g = goal.current;
    const node = following.current ? tracked(following.current) : undefined;
    const aim = node ? new THREE.Vector3(node.position.x, 0.55, node.position.z) : g.target;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * g.speed);
    if (aim) {
      const delta = aim.clone().sub(t).multiplyScalar(node ? (reducedMotion ? 1 : 1 - Math.exp(-dt * 6)) : ease);
      t.add(delta);
      camera.position.add(delta);
      if (!node && g.target && g.target.distanceTo(t) < NEAR_ENOUGH) g.target = null;
    }

    // Distance and angle, eased together on a sphere around the target.
    if (g.distance !== null || g.azimuth !== null || g.polar !== null) {
      const view = new THREE.Spherical().setFromVector3(camera.position.clone().sub(t));
      if (g.distance !== null) {
        view.radius += (g.distance - view.radius) * ease;
        if (Math.abs(view.radius - g.distance) < g.distance * NEAR_ENOUGH) g.distance = null;
      }
      if (g.azimuth !== null) {
        view.theta = turn(view.theta, g.azimuth, ease);
        if (Math.abs(Math.atan2(Math.sin(view.theta - g.azimuth), Math.cos(view.theta - g.azimuth))) < 0.004) g.azimuth = null;
      }
      if (g.polar !== null) {
        view.phi += (g.polar - view.phi) * ease;
        if (Math.abs(view.phi - g.polar) < 0.004) g.polar = null;
      }
      camera.position.copy(t).add(new THREE.Vector3().setFromSpherical(view));
    }

    // Keep the view anchored over the islands.
    const f = townRef.current;
    const clamped = new THREE.Vector3(
      THREE.MathUtils.clamp(t.x, f.x[0] - ROAM, f.x[1] + ROAM),
      THREE.MathUtils.clamp(t.y, 0, 2),
      THREE.MathUtils.clamp(t.z, Math.min(NEWCOMERS_NORTH, f.z[0] - ROAM), f.z[1] + ROAM),
    );
    if (!clamped.equals(t)) {
      camera.position.add(clamped.clone().sub(t));
      t.copy(clamped);
    }
    const ours = t.clone();
    controls.update();
    // A pan applied inside this update is the player's too.
    if (interacting.current && following.current && t.distanceToSquared(ours) > 1e-6) release();
    lastTarget.current.copy(t);
  });

  return null;
}
