import { describe, expect, it } from 'vitest';
import { createScene3d, nearestTarget } from './scene3d';

describe('createScene3d', () => {
  it('falls back to 2D without the library or without WebGL', () => {
    const reasons: string[] = [];
    const el = document.createElement('div');
    expect(createScene3d(null, el, { onFallback: (r) => reasons.push(r) })).toBeNull();
    expect(createScene3d({ WebGLRenderer: class {} }, el, { onFallback: (r) => reasons.push(r) })).toBeNull(); // jsdom has no WebGL
    expect(reasons).toEqual(['the 3D library is not loaded', 'WebGL is not available']);
    expect(el.children).toHaveLength(0);
  });
});

describe('nearestTarget', () => {
  const targets = [{ x: 100, y: 100, id: 'ammo' }, { x: 160, y: 110, id: 'cannon' }, { x: 400, y: 400, id: 'far' }];
  it('picks the nearest label within reach', () => {
    expect(nearestTarget(targets, 150, 108, 60)?.id).toBe('cannon');
    expect(nearestTarget(targets, 105, 95, 60)?.id).toBe('ammo');
    expect(nearestTarget(targets, 300, 300, 60)).toBeNull();
  });
});
