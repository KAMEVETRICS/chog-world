// HTML labels in the 3D world that shrink with distance like the scene, but never grow past their
// designed size when the camera comes close. (drei's `distanceFactor` scales without limit, so a
// zoomed-in camera turned place names into billboards.)
//
// Labels with a `priority` also take part in decluttering: where two would overlap on screen, the more
// important one stays and the other fades out until there's room again, like the names on a good map.
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const at = new THREE.Vector3();

/** How important a label is when labels collide. Higher stays. */
export const LABEL_PRIORITY = { pop: 6, selected: 5, mine: 4, place: 3, resident: 1 } as const;

interface Entry {
  anchor: THREE.Object3D;
  inner: HTMLDivElement;
  priority: number;
  origin: [number, number];
  scale: number;
  /** Unscaled size, re-measured now and then (text can change). */
  size: [number, number];
  shown: boolean;
}

const entries = new Set<Entry>();

/** "50% 100%" -> [0.5, 1]. */
function originOf(origin: string): [number, number] {
  const [x = '50%', y = '50%'] = origin.split(/\s+/);
  return [parseFloat(x) / 100, parseFloat(y) / 100];
}

export function ScaledHtml({
  position,
  factor,
  min = 0.3,
  max = 1,
  origin = '50% 50%',
  priority,
  children,
  ...html
}: Omit<React.ComponentProps<typeof Html>, 'distanceFactor' | 'position'> & {
  position: [number, number, number];
  /** Scale is `factor / distance`, clamped to [min, max]: 1 is the CSS size. */
  factor: number;
  min?: number;
  max?: number;
  /** The point that stays put while scaling, e.g. a bubble's tail. */
  origin?: string;
  /** Joins decluttering at this importance (see LABEL_PRIORITY); without it the label always shows. */
  priority?: number;
}) {
  const anchor = useRef<THREE.Group>(null!);
  const inner = useRef<HTMLDivElement>(null);
  const entry = useRef<Entry | null>(null);
  const last = useRef(-1);

  useEffect(() => {
    if (priority === undefined || !inner.current) return;
    const e: Entry = { anchor: anchor.current, inner: inner.current, priority, origin: originOf(origin), scale: 0, size: [0, 0], shown: true };
    entry.current = e;
    entries.add(e);
    return () => {
      entries.delete(e);
      entry.current = null;
    };
  }, [priority, origin]);

  useFrame(({ camera }) => {
    if (!inner.current) return;
    const s = THREE.MathUtils.clamp(factor / camera.position.distanceTo(anchor.current.getWorldPosition(at)), min, max);
    const rounded = Math.round(s * 100) / 100;
    if (entry.current) entry.current.scale = rounded;
    if (rounded === last.current) return;
    last.current = rounded;
    inner.current.style.transform = `scale(${rounded})`;
  });

  return (
    <group ref={anchor} position={position}>
      <Html {...html}>
        <div ref={inner} className="scaled-label" style={{ transformOrigin: origin, transform: 'scale(0)' }}>
          {children}
        </div>
      </Html>
    </group>
  );
}

const MARGIN = 3;
const projected = new THREE.Vector3();

/**
 * Once per frame, lays out every prioritised label on screen, most important first, and fades any that
 * would overlap one already placed. Mount once inside the Canvas.
 */
export function Declutter() {
  const size = useThree((s) => s.size);
  const frame = useRef(0);
  useFrame(({ camera }) => {
    frame.current += 1;
    const remeasure = frame.current % 30 === 1;
    const placed: Array<[number, number, number, number]> = [];
    const ordered = [...entries].sort((a, b) => b.priority - a.priority);
    for (const e of ordered) {
      if (remeasure || !e.size[0]) e.size = [e.inner.offsetWidth, e.inner.offsetHeight];
      e.anchor.getWorldPosition(projected).project(camera);
      const onScreen = projected.z < 1 && Math.abs(projected.x) <= 1.1 && Math.abs(projected.y) <= 1.1;
      let show = onScreen;
      if (onScreen) {
        // drei centres the unscaled box on the point; the scale then pulls it towards its origin.
        const [w, h] = e.size;
        const cx = ((projected.x + 1) / 2) * size.width;
        const cy = ((1 - projected.y) / 2) * size.height;
        const left = cx - w / 2 + e.origin[0] * w * (1 - e.scale);
        const top = cy - h / 2 + e.origin[1] * h * (1 - e.scale);
        const rect: [number, number, number, number] = [left - MARGIN, top - MARGIN, left + w * e.scale + MARGIN, top + h * e.scale + MARGIN];
        show = !placed.some((p) => rect[0] < p[2] && rect[2] > p[0] && rect[1] < p[3] && rect[3] > p[1]);
        if (show) placed.push(rect);
      }
      if (show !== e.shown) {
        e.shown = show;
        e.inner.classList.toggle('is-crowded', !show);
      }
    }
  });
  return null;
}
