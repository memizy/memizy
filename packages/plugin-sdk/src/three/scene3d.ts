/**
 * `createScene3d(THREE, element, options)` – the hard parts of a 3D game in a
 * classroom, learned with Pirates of Memizy. The game passes its own Three.js (any
 * recent version), so the SDK does not depend on it.
 *
 * - WebGL missing, a context that cannot start, a black frame (broken drivers) or a
 *   lost context → `onFallback(reason)`: switch to a 2D view.
 * - Low frame rate → lower quality first, then `onFallback`.
 * - The canvas follows its element (also when iOS toolbars resize the page).
 * - `nearest(targets, event)`: taps pick the nearest label on screen (what the
 *   player sees), not a tiny 3D mesh behind it.
 */

export interface Scene3dOptions {
  /** Called once when 3D cannot be used here; show a 2D view instead. */
  onFallback?(reason: string): void;
  /** Called after every frame with the seconds since the last one. */
  onFrame?(dt: number, time: number): void;
  /** Called when the size changes (width, height in CSS pixels). */
  onResize?(width: number, height: number): void;
  /** Frames per second below which the game falls back to 2D (default 12). */
  minFps?: number;
  /** Maximal device pixel ratio (default 2; phones get at most 1.5). */
  maxPixelRatio?: number;
  /** Field of view of the default camera (default 50). */
  fov?: number;
}

export interface ScreenTarget {
  /** Position on the canvas in CSS pixels (e.g. from `project`). */
  x: number;
  y: number;
  [key: string]: unknown;
}

export interface Scene3d {
  readonly renderer: any;
  readonly scene: any;
  camera: any;
  readonly canvas: HTMLCanvasElement;
  /** Width and height of the canvas in CSS pixels. */
  readonly size: { width: number; height: number };
  /** Starts the render loop (call once the scene is built). */
  start(): void;
  stop(): void;
  /** Re-measures the element; call before handling a tap. */
  syncSize(): void;
  /** Screen position (CSS pixels on the canvas) of a 3D point; `visible` false behind the camera. */
  project(point: { x: number; y: number; z: number }): { x: number; y: number; visible: boolean };
  /** The target nearest to a pointer event within `reach` pixels (default: 11 % of the smaller side, at least 48). */
  nearest<T extends ScreenTarget>(targets: readonly T[], event: { clientX: number; clientY: number }, reach?: number): T | null;
  /** Stops everything and removes the canvas. */
  dispose(): void;
}

/** Whether this browser can create a WebGL context at all. */
export function webglAvailable(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** The target nearest to (x, y) within `reach` pixels, or null. */
export function nearestTarget<T extends ScreenTarget>(targets: readonly T[], x: number, y: number, reach: number): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d <= reach && d < bestDistance) {
      best = t;
      bestDistance = d;
    }
  }
  return best;
}

/** True when the rendered frame is (almost) completely black: a broken GPU driver. */
function looksBlack(renderer: any): boolean {
  try {
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    let dark = 0;
    for (const [x, y] of [[w / 2, h / 2], [w / 4, h * 0.25], [w * 0.75, h * 0.75]]) {
      gl.readPixels(Math.floor(x), Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] + px[1] + px[2] < 24) dark++;
    }
    return dark === 3;
  } catch {
    return false;
  }
}

/**
 * Creates a renderer, a scene and a camera inside `element` (an element with
 * `data-keep`, so rendering leaves it alone). Returns null when 3D cannot be used
 * (and calls `onFallback`).
 */
export function createScene3d(THREE: any, element: HTMLElement, options: Scene3dOptions = {}): Scene3d | null {
  let fellBack = false;
  let api: Scene3d | null = null;
  const fallback = (reason: string) => {
    if (fellBack) return;
    fellBack = true;
    api?.dispose();
    options.onFallback?.(reason);
  };
  const doc = element.ownerDocument;
  if (!THREE?.WebGLRenderer) {
    fallback('the 3D library is not loaded');
    return null;
  }
  if (!webglAvailable(doc)) {
    fallback('WebGL is not available');
    return null;
  }
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let renderer: any;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !phone, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  } catch {
    fallback('the 3D scene could not start');
    return null;
  }
  const maxRatio = Math.min(options.maxPixelRatio ?? 2, phone ? 1.5 : 2);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, maxRatio));
  const canvas: HTMLCanvasElement = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
  element.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(options.fov ?? 50, 1, 0.1, 2000);

  const size = { width: 0, height: 0 };
  let raf = 0;
  let disposed = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fallback('the graphics card lost the 3D context');
  });

  const self: Scene3d = {
    renderer,
    scene,
    camera,
    canvas,
    size,
    syncSize() {
      const w = element.clientWidth;
      const h = element.clientHeight;
      if (!w || !h || (w === size.width && h === size.height)) return;
      size.width = w;
      size.height = h;
      renderer.setSize(w, h, false);
      if (self.camera?.isPerspectiveCamera) {
        self.camera.aspect = w / h;
        self.camera.updateProjectionMatrix();
      }
      options.onResize?.(w, h);
    },
    project(point) {
      const v = new THREE.Vector3(point.x, point.y, point.z).project(self.camera);
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, visible: v.z > -1 && v.z < 1 };
    },
    nearest(targets, event, reach) {
      self.syncSize();
      const rect = canvas.getBoundingClientRect();
      const r = reach ?? Math.max(48, Math.min(rect.width, rect.height) * 0.11);
      return nearestTarget(targets, event.clientX - rect.left, event.clientY - rect.top, r);
    },
    start() {
      if (raf || disposed) return;
      let last = performance.now();
      let frames = 0;
      let checkStart = last;
      let checkedBlack = false;
      let lowQuality = false;
      const loop = (now: number) => {
        if (disposed) return;
        if (!canvas.isConnected) return self.dispose();
        raf = requestAnimationFrame(loop);
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        self.syncSize();
        options.onFrame?.(dt, now / 1000);
        renderer.render(scene, self.camera);
        if (!checkedBlack) {
          checkedBlack = true;
          if (looksBlack(renderer)) return fallback('the 3D scene renders black on this device');
        }
        frames++;
        if (now - checkStart > 4000) {
          const fps = (frames * 1000) / (now - checkStart);
          frames = 0;
          checkStart = now;
          if (fps < 20 && !lowQuality) {
            lowQuality = true;
            renderer.setPixelRatio(1);
            size.width = 0; // re-apply the size with the new ratio
          } else if (fps < (options.minFps ?? 12) && lowQuality) {
            fallback(`the 3D scene is too slow here (${Math.round(fps)} fps)`);
          }
        }
      };
      raf = requestAnimationFrame(loop);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      try {
        renderer.dispose();
      } catch {
        /* already gone */
      }
      canvas.remove();
    },
  };
  api = self;
  self.syncSize();
  return self;
}
