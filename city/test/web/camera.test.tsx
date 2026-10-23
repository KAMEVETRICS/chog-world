import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitDistance, measureInsets } from '../../src/web/world3d/CameraDirector';

const camera = new THREE.PerspectiveCamera(32, 1440 / 900);
const none = { left: 0, right: 0, top: 0, bottom: 0 };

function box(el: HTMLElement, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r }) as DOMRect;
  return el;
}

afterEach(() => document.body.replaceChildren());

describe('camera framing', () => {
  it('pulls back when panels leave less of the screen visible', () => {
    const open = fitDistance(camera, { width: 1440, height: 900 }, none, 21, 16);
    const behindPanels = fitDistance(camera, { width: 1440, height: 900 }, { ...none, left: 306, right: 416 }, 21, 16);
    expect(behindPanels).toBeGreaterThan(open);
  });

  it('reads a side panel, a phone bottom sheet and a top bar from marked elements, and ignores small ones', () => {
    const canvas = box(document.createElement('canvas'), { left: 0, top: 0, width: 1000, height: 800 });
    const panel = box(document.createElement('aside'), { left: 600, top: 80, width: 400, height: 700 });
    const sheet = box(document.createElement('aside'), { left: 0, top: 500, width: 1000, height: 300 });
    const bar = box(document.createElement('div'), { left: 0, top: 60, width: 1000, height: 50 });
    const chip = box(document.createElement('div'), { left: 20, top: 20, width: 200, height: 60 });
    for (const el of [panel, sheet, bar, chip]) el.setAttribute('data-occluder', '');
    document.body.append(canvas, panel, sheet, bar, chip);
    expect(measureInsets(canvas)).toEqual({ left: 0, right: 400, top: 110, bottom: 300 });
  });
});
