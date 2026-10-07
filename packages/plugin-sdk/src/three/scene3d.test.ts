import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScene3d, nearestTarget, resetScene3dChecks, type Scene3dFallbackKind } from './scene3d';

/** A Three.js stand-in: a renderer whose frames are black or not, and a frame clock we drive. */
function fakeThree(options: { black?: boolean } = {}) {
  const ratios: number[] = [];
  class WebGLRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio(r: number) {
      ratios.push(r);
    }
    setSize() {}
    render() {}
    dispose() {}
    getContext() {
      return {
        drawingBufferWidth: 100,
        drawingBufferHeight: 100,
        RGBA: 0,
        UNSIGNED_BYTE: 0,
        readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, px: Uint8Array) => px.set(options.black ? [0, 0, 0, 255] : [90, 140, 200, 255]),
      };
    }
  }
  class PerspectiveCamera {
    isPerspectiveCamera = true;
    aspect = 1;
    fov: number;
    near: number;
    far: number;
    constructor(fov: number, _aspect: number, near: number, far: number) {
      this.fov = fov;
      this.near = near;
      this.far = far;
    }
    updateProjectionMatrix() {}
  }
  return { THREE: { WebGLRenderer, Scene: class {}, PerspectiveCamera }, ratios };
}

let frames: FrameRequestCallback[] = [];
let clock = 0;
/** Runs `count` frames `ms` apart. */
function runFrames(count: number, ms: number) {
  for (let i = 0; i < count; i++) {
    clock += ms;
    const queued = frames;
    frames = [];
    queued.forEach((cb) => cb(clock));
  }
}

beforeEach(() => {
  resetScene3dChecks();
  frames = [];
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({})) as any);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('createScene3d', () => {
  it('falls back to 2D without the library or without WebGL', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation((() => null) as any);
    const seen: [string, Scene3dFallbackKind][] = [];
    const el = mount();
    const onFallback = (r: string, info: { kind: Scene3dFallbackKind }) => seen.push([r, info.kind]);
    expect(createScene3d(null, el, { onFallback })).toBeNull();
    expect(createScene3d(fakeThree().THREE, el, { onFallback })).toBeNull();
    expect(seen).toEqual([['the 3D library is not loaded', 'unsupported'], ['WebGL is not available', 'unsupported']]);
    expect(el.children).toHaveLength(0);
  });

  it('a game without a 2D view gets a message when 3D cannot run', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation((() => null) as any);
    document.documentElement.lang = 'cs';
    const el = mount();
    expect(createScene3d(fakeThree().THREE, el)).toBeNull();
    expect(el.querySelector('.mz-no3d')!.textContent).toContain('Toto zařízení neumí zobrazit 3D');
    document.documentElement.lang = '';
  });

  it('the camera takes fov, near and far', () => {
    const scene = createScene3d(fakeThree().THREE, mount(), { fov: 52, near: 0.5, far: 400 })!;
    expect(scene.camera).toMatchObject({ fov: 52, near: 0.5, far: 400 });
    expect(createScene3d(fakeThree().THREE, mount())!.camera).toMatchObject({ fov: 50, near: 0.1, far: 2000 });
  });

  it('a black scene switches to 2D once; when the player returns to 3D it stays', () => {
    const seen: Scene3dFallbackKind[] = [];
    const { THREE } = fakeThree({ black: true });
    const first = mount();
    createScene3d(THREE, first, { onFallback: (_r, i) => seen.push(i.kind) })!.start();
    runFrames(2, 16);
    expect(seen).toEqual(['black']);
    expect(first.querySelector('canvas')).toBeNull(); // disposed

    const again = mount(); // the player pressed "3D"
    createScene3d(THREE, again, { onFallback: (_r, i) => seen.push(i.kind) })!.start();
    runFrames(5, 16);
    expect(seen).toEqual(['black']);
    expect(again.querySelector('canvas')).not.toBeNull();
  });

  it('a slow scene lowers the quality, then switches once; afterwards only the quality drops', () => {
    const seen: Scene3dFallbackKind[] = [];
    const { THREE, ratios } = fakeThree();
    createScene3d(THREE, mount(), { onFallback: (_r, i) => seen.push(i.kind) })!.start();
    runFrames(45, 100); // 10 fps for 4.5 s → lower quality
    expect(ratios.at(-1)).toBe(1);
    expect(seen).toEqual([]);
    runFrames(45, 100); // still 10 fps → 2D
    expect(seen).toEqual(['slow']);

    const again = mount();
    createScene3d(THREE, again, { onFallback: (_r, i) => seen.push(i.kind) })!.start();
    runFrames(100, 100);
    expect(seen).toEqual(['slow']);
    expect(again.querySelector('canvas')).not.toBeNull();
  });

  it('without a 2D view a black or slow scene stays 3D; a lost context always switches', () => {
    const { THREE } = fakeThree({ black: true });
    const el = mount();
    createScene3d(THREE, el)!.start();
    runFrames(100, 100);
    expect(el.querySelector('canvas')).not.toBeNull();

    const seen: Scene3dFallbackKind[] = [];
    const lost = mount();
    resetScene3dChecks();
    const scene = createScene3d(fakeThree().THREE, lost, { onFallback: (_r, i) => seen.push(i.kind) })!;
    scene.canvas.dispatchEvent(new Event('webglcontextlost'));
    const back = createScene3d(fakeThree().THREE, mount(), { onFallback: (_r, i) => seen.push(i.kind) })!;
    back.canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(seen).toEqual(['lost', 'lost']);
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
