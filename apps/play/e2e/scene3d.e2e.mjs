// Browser test of the 3D rules with real WebGL (Edge with SwiftShader, no GPU needed):
// Pirates of Memizy alone, in the sandboxed iframe of a host (host-sdk), with a set
// whose right answers the test knows.
//
//   1. 3D renders (a canvas that is not black) and the 2D / 3D button switches both ways
//   2. a shot in 3D and a shot in 2D (question → cannonball → cannons → fire)
//   3. a lost WebGL context → 2D with a message; the 3D button stays
//   4. a slow scene → 2D once; after the player switches back, it stays 3D
//   5. no WebGL → 2D without the 3D button
//
// Run: bun run build:packages (once), then `cd apps/play && bun run e2e:3d`.
// Not part of `bun run test` (it needs Edge and takes about a minute).

import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(here, '../../..');
const require = createRequire(import.meta.url);

// The host page: host-sdk bundled for the browser.
const out = mkdtempSync(join(tmpdir(), 'memizy-e2e-'));
const built = spawnSync('bun', ['build', join(here, 'host-entry.ts'), '--outfile', join(out, 'host.js'), '--target', 'browser', '--define', 'process.env.NODE_ENV="production"'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (built.status !== 0) throw new Error(`bun build failed: ${built.stderr || built.stdout}`);
const hostJs = readFileSync(join(out, 'host.js'), 'utf8');
const sdk = readFileSync(join(engine, 'packages/plugin-sdk/dist/bundle/memizy-sdk.bundle.js'), 'utf8');
// The same Three.js version as the one Pirates import (three@0.160.0); its main entry is in build/.
const three = readFileSync(join(dirname(require.resolve('three')), 'three.module.min.js'), 'utf8');
const pirates = readFileSync(join(engine, 'apps/play/src/data/plugins/pirates-of-memizy.html'), 'utf8');

const RIGHT = 'Right answer';
const id = (n) => `0192f0c4-0000-7000-8000-${String(n).padStart(12, '0')}`;
const set = {
  version: '1.0',
  meta: { id: id(0), language: 'en', title: 'E2E', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' },
  items: Array.from({ length: 8 }, (_, i) => ({
    id: id(i + 1),
    type: 'mcq-single',
    question: `Question ${i + 1}?`,
    options: [{ id: 'r', text: RIGHT }, { id: 'w1', text: 'Wrong one' }, { id: 'w2', text: 'Wrong two' }],
    correctId: 'r',
  })),
};

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
let current = null; // the page of the running scenario (a screenshot when something fails)
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` – ${detail}` : ''}`);
};

// One browser context for all scenarios (requests from the sandboxed plugin iframe are
// routed reliably only in the first context); every scenario gets a new page.
const context = await browser.newContext({ viewport: { width: 900, height: 620 } });
await context.route('https://cdn.jsdelivr.net/npm/@memizy/**', (r) => r.fulfill({ body: sdk, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
await context.route('https://cdn.jsdelivr.net/npm/three@**', (r) => r.fulfill({ body: three, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
await context.route('https://host.test/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><body style="margin:0"><div id="app" style="width:100vw;height:100vh"></div><script>${hostJs.replace(/<\/script/g, '<\\/script')}</script></body></html>` }),
);

/**
 * A page with the game running; `init` runs in every frame of it before the game (e.g. slow
 * frames, no WebGL). Software WebGL keeps the CPU busy, so a plugin may miss the 10 s
 * handshake while the previous scene winds down: the page is then opened once more.
 */
async function open(init) {
  try {
    return await openOnce(init);
  } catch (error) {
    if (!/Connection timed out/.test(String(error))) throw error;
    console.log('  (the handshake timed out under load; opening the page again)');
    await current?.close().catch(() => {});
    return openOnce(init);
  }
}

async function openOnce(init) {
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => console.log('  (request failed)', r.url().slice(0, 100), r.failure()?.errorText));
  page.on('console', (m) => m.type() === 'error' && console.log('  (console)', m.text().slice(0, 200)));
  current = page;
  await page.goto('https://host.test/');
  await page.evaluate(([html, s]) => window.runGame(html, s, { timerSec: 60 }), [pirates, set]);
  const game = page.frameLocator('iframe');
  await game.locator('.mode-btn, .deck2d, #sea').first().waitFor({ timeout: 20000 });
  return { page, game, frame: () => page.frames().find((f) => f !== page.mainFrame()), errors, close: () => page.close() };
}

const hasCanvas = async (g) => (await g.locator('#sea canvas').count()) > 0;
const modeButton = (g) => g.locator('.mode-btn');
/** What the sailor carries (the chip at the top right). */
const inventory = async (g) => (await g.locator('.hud-inv').textContent({ timeout: 5000 }))?.trim();

/** Clicks the 2D / 3D button until the game shows the other view (a click during a re-render may miss). */
async function switchView(page, g, to) {
  for (let i = 0; i < 4; i++) {
    await modeButton(g).click();
    await page.waitForTimeout(700);
    if ((await hasCanvas(g)) === (to === '3D')) return true;
  }
  return false;
}

/** Whether the canvas shows something (not one flat colour). */
async function canvasHasPicture(page, g) {
  const box = await g.locator('#sea canvas').boundingBox();
  const shot = await page.screenshot({ clip: box });
  // PNG bytes vary a lot when the picture does; a flat or black frame compresses to almost nothing.
  return shot.length > 20_000;
}

/** Answers the open question with the right option. */
async function answerRight(g) {
  await g.getByRole('button', { name: RIGHT }).first().click({ timeout: 15000 });
  await g.locator('.hud-inv', { hasText: 'cannonball' }).waitFor({ timeout: 10000 });
}

/** Clicks a 3D station label (the tap goes to the canvas, which picks the nearest label). */
async function tapLabel(page, g, text) {
  const label = g.locator('.labels').getByText(text).first();
  if (!(await hasCanvas(g))) throw new Error('the game switched to 2D by itself: this machine is too slow for software WebGL (close other programs and run again)');
  await label.waitFor({ state: 'visible', timeout: 15000 }); // labels hide while a message or the aim is shown
  await page.waitForTimeout(300);
  // The labels follow the ship and are redrawn every frame: measure until one stays put.
  let box = null;
  for (let i = 0; i < 20 && !box; i++) box = await label.boundingBox().catch(() => null);
  if (!box) throw new Error(`label "${text}" could not be measured`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Fires on the aiming overlay (the shot goes out on pointerdown). */
async function fire(page, g) {
  const aim = g.locator('[data-fire]').first();
  await aim.waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const box = await aim.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await g.locator('.hud-inv', { hasText: 'empty hands' }).waitFor({ timeout: 10000 });
}

try {
  // 1 + 2: 3D renders, a shot in 3D, the switch to 2D and a shot there, back to 3D.
  {
    const t = await open();
    await t.game.locator('#sea canvas').waitFor({ timeout: 20000 });
    await t.page.waitForTimeout(1500);
    check('3D renders a picture', await canvasHasPicture(t.page, t.game));
    check('the 2D button is offered', (await modeButton(t.game).textContent())?.trim() === '2D');

    await tapLabel(t.page, t.game, 'Powder Magazine');
    await answerRight(t.game);
    await tapLabel(t.page, t.game, 'Cannons');
    await fire(t.page, t.game);
    check('a shot in 3D (question, cannonball, cannons, fire)', true, await inventory(t.game));

    check('2D button: the 2D deck replaces the canvas', (await switchView(t.page, t.game, '2D')) && (await modeButton(t.game).textContent())?.trim() === '3D');
    await t.game.locator('button.station').first().click();
    await answerRight(t.game);
    await t.game.locator('button.station:not([disabled])', { hasText: 'Fire at the enemy' }).first().click();
    await fire(t.page, t.game);
    check('a shot in 2D', true, await inventory(t.game));

    check('3D button: back to 3D', await switchView(t.page, t.game, '3D'));
    check('no page errors', t.errors.length === 0, t.errors.join('; '));
    await t.close();
  }

  // 3: the graphics card drops the context.
  {
    const t = await open();
    await t.game.locator('#sea canvas').waitFor({ timeout: 20000 });
    await t.page.waitForTimeout(1000);
    await t.frame().evaluate(() => {
      const canvas = document.querySelector('#sea canvas');
      (canvas.getContext('webgl2') ?? canvas.getContext('webgl')).getExtension('WEBGL_lose_context').loseContext();
    });
    await t.game.locator('text=/did not work well here/').first().waitFor({ timeout: 10000 });
    check('lost context → 2D with a message', !(await hasCanvas(t.game)));
    check('lost context: the 3D button stays', (await modeButton(t.game).textContent())?.trim() === '3D');
    await t.close();
  }

  // 4: a slow scene (about 5 frames per second) switches to 2D once; the player's 3D stays.
  {
    const slow = () => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 200);
    };
    const t = await open(slow);
    await t.game.locator('#sea canvas').waitFor({ timeout: 20000 });
    await t.game.locator('text=/did not work well here/').first().waitFor({ timeout: 20000 });
    check('slow scene → 2D with a message', !(await hasCanvas(t.game)));
    if (!(await switchView(t.page, t.game, '3D'))) throw new Error('could not switch back to 3D');
    await t.page.waitForTimeout(12000); // longer than the two 4-second checks
    check('slow scene: after the player chose 3D again, it stays 3D', await hasCanvas(t.game));
    await t.close();
  }

  // 5: no WebGL at all.
  {
    const noWebgl = () => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(type) ? null : get.call(this, type, ...rest);
      };
    };
    const t = await open(noWebgl);
    await t.game.locator('text=/cannot show 3D/').first().waitFor({ timeout: 15000 });
    check('no WebGL → 2D', !(await hasCanvas(t.game)) && (await t.game.locator('button.station').count()) > 0);
    check('no WebGL: no 3D button', (await modeButton(t.game).count()) === 0);
    await t.close();
  }
} catch (error) {
  const shot = join(out, 'failure.png');
  await current?.screenshot({ path: shot }).catch(() => {});
  check('unexpected failure', false, `${error.message.split('\n')[0]} (screenshot: ${shot})`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
