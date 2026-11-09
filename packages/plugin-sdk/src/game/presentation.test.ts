import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OQSEAnyItem } from '@memizy/oqse';
import { startPresentation, type PresentationOptions } from './presentation';
import { LocalRouter, wait } from '../test/localRouter';
import type { GameHandle } from './defineGame';

const items = [
  { id: 'q1', type: 'mcq-single', question: 'Je Pluto planeta?', options: [{ id: 'a', text: 'Ano' }, { id: 'n', text: 'Ne' }], correctId: 'n' },
] as OQSEAnyItem[];

beforeAll(() => {
  const manifest = document.createElement('script');
  manifest.type = 'application/oqse-manifest+json';
  manifest.textContent = JSON.stringify({
    version: '1.0', id: 'https://example.com/plugins/talk', appName: 'Talk', pluginVersion: '1.0.0',
    capabilities: { actions: ['render'], types: ['mcq-single'] },
    appSpecific: { memizy: { protocol: '1.1', set: 'optional', modes: { solo: {}, multiplayer: { players: { min: 1, max: 40 }, hostAs: ['presenter'] } } } },
  });
  document.head.appendChild(manifest);
});

const handles: GameHandle[] = [];
afterEach(() => {
  handles.splice(0).forEach((h) => h.destroy());
  document.body.innerHTML = '';
});

/** One device: its own copy of the page's slides (in one jsdom document). */
function device(router: LocalRouter, address: string, options: PresentationOptions = {}) {
  const page = document.createElement('div');
  page.id = 'page-' + address;
  page.innerHTML = `<section data-slide="intro"><h1>Úvod</h1></section>
    <section data-slide="opinion"><h2>Co si myslíte?</h2><div data-poll="like"></div></section>
    <section data-slide="quiz"><h2>Otázka</h2><div data-poll="pluto"></div></section>
    <section data-slide="sim"><canvas></canvas></section>`;
  document.body.appendChild(page);
  const before = new Set(document.querySelectorAll('.mz-pres'));
  const handle = startPresentation(
    {
      root: page,
      polls: { like: { question: 'Líbí se vám to?', options: ['Ano', 'Ne', 'Nevím'] }, pluto: { item: 'q1' } },
      phone: { sim: (ui) => ui.html`<input class="speed" type="range">` },
      ...options,
    },
    { connector: router.connector(address) },
  );
  handles.push(handle);
  const layer = () => [...document.querySelectorAll<HTMLElement>('.mz-pres')].find((l) => !before.has(l))!;
  const visible = () => [...page.querySelectorAll<HTMLElement>('section')].filter((s) => !s.hidden).map((s) => s.dataset.slide);
  return { page, handle, layer, visible };
}
const click = (el: Element | null | undefined) => (el as HTMLElement).click();

describe('definePresentation', () => {
  it('a class: the teacher moves the slides, the phones show only the polls and their own parts, results live on the board', async () => {
    const router = new LocalRouter({ items });
    const board = device(router, 'board');
    const anna = device(router, 'anna');
    const ben = device(router, 'ben');
    await Promise.all(handles.map((h) => h.ready));
    await router.start();
    await wait(300);
    expect(board.visible()).toEqual(['intro']);
    expect(anna.visible()).toEqual([]); // phones: no copy of the board
    expect(anna.layer().textContent).toContain('Sleduj tabuli');

    // a pupil cannot move the class
    anna.handle.act('mzPresGo', { slide: 3 });
    await wait(100);
    expect(board.visible()).toEqual(['intro']);

    click(board.layer().querySelector('.mz-pres-arrow[title="Další"]'));
    await wait(300);
    expect(board.visible()).toEqual(['opinion']);
    const options = () => [...anna.layer().querySelectorAll<HTMLButtonElement>('.mz-pres-opt')];
    expect(options().map((b) => b.textContent)).toEqual(['Ano', 'Ne', 'Nevím']);
    click(options()[0]);
    click([...ben.layer().querySelectorAll('.mz-pres-opt')][0]);
    await wait(300);
    click(options()[2]); // an opinion may change
    await wait(300);
    const bars = () => [...board.page.querySelectorAll('[data-poll="like"] .mz-pres-row')].map((r) => r.textContent?.replace(/\s+/g, ''));
    expect(bars()).toEqual(['Ano1', 'Ne0', 'Nevím1']);
    expect(anna.page.querySelector('[data-poll="like"]')!.textContent).toBe(''); // results only on the board

    // an item of the set: recorded like an answer; the teacher reveals it
    click(board.layer().querySelectorAll('.mz-pres-dot')[2]);
    await wait(300);
    click([...anna.layer().querySelectorAll<HTMLButtonElement>('.mz-q-opt')].find((b) => b.textContent?.includes('Ne')));
    await wait(300);
    expect(router.records).toEqual([expect.objectContaining({ playerId: 'anna', itemId: 'q1', isCorrect: true })]);
    click(board.page.querySelector('[data-mz-reveal]'));
    await wait(300);
    expect(board.page.querySelector('[data-poll="pluto"] .mz-pres-ok')?.textContent).toContain('Ne ✓');

    // the author's own phone part
    click(board.layer().querySelectorAll('.mz-pres-dot')[3]);
    await wait(300);
    expect(ben.layer().querySelector('input.speed')).not.toBeNull();
  });

  it("the pupils' own controls (phone + actions) reach the board's onUpdate", async () => {
    const router = new LocalRouter({ items });
    const seen: unknown[] = [];
    const opts: PresentationOptions = {
      phone: { intro: (ui) => ui.html`<button class="fast" data-act="speed" data-payload=${{ v: 5 }}>5×</button>` },
      actions: { speed(state, p, ctx) { (state.data.speed as Record<string, number> | undefined) ?? (state.data.speed = {}); (state.data.speed as Record<string, number>)[ctx.playerId!] = p.v; } },
      onUpdate: (id, _el, state, ui) => { if (ui.view === 'board') seen.push([id, state.data.speed]); },
    };
    device(router, 'board', opts);
    const anna = device(router, 'anna', opts);
    await Promise.all(handles.map((h) => h.ready));
    await router.start();
    await wait(300);
    click(anna.layer().querySelector('.fast'));
    await wait(300);
    expect(seen.at(-1)).toEqual(['intro', { anna: 5 }]);
  });

  it('alone: the pupil goes at their own pace and "Done" on the last slide ends the course step', async () => {
    const router = new LocalRouter({ items, mode: 'solo' });
    const me = device(router, 'me');
    await me.handle.ready;
    await router.start();
    await wait(300);
    expect(me.visible()).toEqual(['intro']);
    click(me.layer().querySelector('.mz-pres-arrow[title="Další"]'));
    await wait(100);
    expect(me.visible()).toEqual(['opinion']);
    click(me.layer().querySelector('.mz-pres-opt')); // the poll in a panel; the results on the slide
    await wait(100);
    expect(me.page.querySelector('[data-poll="like"] .mz-pres-row')?.textContent).toContain('1');
    click(me.layer().querySelectorAll('.mz-pres-dot')[3]);
    await wait(100);
    click(me.layer().querySelector('.mz-pres-btn'));
    await wait(100);
    expect(router.results).toEqual([expect.objectContaining({ summary: 'done' })]);
  });

  it("navigation: 'free' – every phone shows the slides and goes on its own", async () => {
    const router = new LocalRouter({ items });
    const board = device(router, 'board', { navigation: 'free' });
    const anna = device(router, 'anna', { navigation: 'free' });
    await Promise.all(handles.map((h) => h.ready));
    await router.start();
    await wait(300);
    expect(anna.visible()).toEqual(['intro']);
    click(anna.layer().querySelectorAll('.mz-pres-dot')[2]);
    await wait(100);
    expect(anna.visible()).toEqual(['quiz']);
    expect(board.visible()).toEqual(['intro']); // the board did not move
  });

  it('the teacher may end it from the app ("End and show the results")', async () => {
    const router = new LocalRouter({ items });
    device(router, 'board');
    device(router, 'anna');
    await Promise.all(handles.map((h) => h.ready));
    await router.start();
    await wait(100);
    await router.plugins.get('board')!.finishRequested!();
    await wait(100);
    expect(router.results).toEqual([expect.objectContaining({ summary: 'ended' })]);
  });
});
