import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { OQSEAnyItem } from '@memizy/oqse';
import { startGame, type GameHandle } from './defineGame';
import { checkAnswer } from '../checkAnswer';
import { LocalRouter, wait } from '../test/localRouter';
import type { GameDefinition } from '../types';

const items = [
  { id: 'q1', type: 'mcq-single', question: 'Hlavní město **Česka**?', options: [{ id: 'brno', text: 'Brno' }, { id: 'praha', text: 'Praha' }], correctId: 'praha' },
  { id: 'q2', type: 'true-false', question: 'Měsíc je planeta.', correctAnswer: false },
] as OQSEAnyItem[];

beforeAll(() => {
  const manifest = document.createElement('script');
  manifest.type = 'application/oqse-manifest+json';
  manifest.textContent = JSON.stringify({
    version: '0.2',
    id: 'https://example.com/plugins/e2e',
    appName: 'E2E',
    pluginVersion: '1.0.0',
    capabilities: { actions: ['render'], types: ['mcq-single', 'true-false'] },
    appSpecific: {
      memizy: {
        protocol: '1.0',
        modes: { solo: {}, multiplayer: { players: { min: 1, max: 40 }, hostAs: ['presenter', 'player'] } },
        settings: [
          { id: 'questionTime', type: 'number', label: 'Time', default: 20, min: 5, max: 120 },
          { id: 'mode', type: 'select', label: 'Mode', default: 'classic', options: [{ value: 'classic', label: 'C' }, { value: 'fast', label: 'F' }] },
        ],
        settingsScreen: { size: 'compact' },
      },
    },
  });
  document.head.appendChild(manifest);
});

const handles: GameHandle[] = [];
afterEach(() => {
  handles.splice(0).forEach((h) => h.destroy());
  document.body.innerHTML = '';
});

interface State {
  round: number;
  answers: Record<string, string | boolean>;
  scores: Record<string, number>;
}

const quiz: Omit<GameDefinition<State>, 'root'> = {
  initialState: () => ({ round: 0, answers: {}, scores: {} }),
  actions: {
    answer(state, payload, ctx) {
      if (!ctx.playerId || ctx.playerId in state.answers) return;
      const item = ctx.item(['q1', 'q2'][state.round])!;
      const correct = checkAnswer(item, payload.answer);
      state.answers[ctx.playerId] = payload.answer;
      if (correct) state.scores[ctx.playerId] = (state.scores[ctx.playerId] ?? 0) + 1;
      ctx.recordAnswer(item.id, correct);
    },
  },
  render(state, ui) {
    const item = ui.item(['q1', 'q2'][state.round]) as any;
    const answered = Object.keys(state.answers).length;
    if (ui.view === 'board') return `<h1>${ui.text(item.question, { inline: true })}</h1><p class="count">${answered}/${ui.players.length}</p>`;
    const mine = ui.self && ui.self.id in state.answers;
    return `<p class="who">${ui.html`${ui.self?.name}`}</p>${item.options
      .map((o: { id: string; text: string }) => `<button data-act="answer" data-payload='${JSON.stringify({ answer: o.id })}' ${mine ? 'disabled' : ''}>${ui.text(o.text, { inline: true })}</button>`)
      .join('')}<p class="score">${state.scores[ui.self!.id] ?? 0}</p>`;
  },
};

function mount(router: LocalRouter, address: string, def: Omit<GameDefinition<any>, 'root'> = quiz): HTMLElement {
  const root = document.createElement('div');
  root.id = `root-${address}`;
  document.body.appendChild(root);
  handles.push(startGame({ ...def, root }, { connector: router.connector(address) }));
  return root;
}

describe('defineGame end to end', () => {
  it('ui.setLocal re-renders with device-only state; ui.html escapes', async () => {
    const router = new LocalRouter({ items });
    const root = mount(router, 'anna', {
      initialState: () => ({ n: 0 }),
      actions: {},
      render: (_state, ui) => ui.html`<p class="tab">${ui.local.tab ?? 'none'}</p><p class="name">${'<b>x</b>'}</p>`,
      afterRender(_state, ui) {
        if (!ui.local.done) ui.setLocal({ done: true, tab: 'map' });
      },
    });
    mount(router, 'board', { initialState: () => ({ n: 0 }), actions: {}, render: () => '' });
    await Promise.all(handles.map((h) => h.ready));
    await router.start();
    await wait(150);
    expect(root.querySelector('.tab')!.textContent).toBe('map');
    expect(root.querySelector('.name')!.innerHTML).toBe('&lt;b&gt;x&lt;/b&gt;');
  });

  it('data-local runs a device-only handler and re-renders; unknown handlers are reported', async () => {
    const router = new LocalRouter({ items, mode: 'solo' });
    const seen: unknown[] = [];
    const root = mount(router, 'me', {
      initialState: () => ({ n: 0 }),
      actions: { bump(state: { n: number }) { state.n += 1; } },
      localActions: {
        tab(local, payload, ui) {
          local.tab = payload;
          seen.push(ui.view);
        },
        broken() {
          throw new Error('nope');
        },
      },
      render: (state: { n: number }, ui) =>
        ui.html`<p class="tab">${ui.local.tab ?? 'none'}</p><p class="n">${state.n}</p>
          <button class="map" data-local="tab" data-payload='"map"'>Map</button>
          <button class="off" data-local="tab" data-payload='"x"' disabled>Off</button>
          <button class="bad" data-local="broken">Bad</button>
          <button class="missing" data-local="nothing">?</button>`,
    });
    await handles[0].ready;
    await router.start();
    await wait();
    (root.querySelector('.map') as HTMLButtonElement).click();
    (root.querySelector('.off') as HTMLButtonElement).click();
    await wait();
    expect(root.querySelector('.tab')!.textContent).toBe('map');
    expect(root.querySelector('.n')!.textContent).toBe('0'); // no action was sent
    expect(seen).toEqual(['solo']);
    (root.querySelector('.bad') as HTMLButtonElement).click();
    (root.querySelector('.missing') as HTMLButtonElement).click();
    await wait();
    expect(router.errors).toEqual(['me LOCAL_FAILED: localActions.broken: nope', expect.stringMatching(/^me UNKNOWN_LOCAL: data-local="nothing"/)]);
  });

  it('re-renders timed phases without tickMs (countdowns) and stops when the phase has no deadline', async () => {
    const router = new LocalRouter({ items, mode: 'solo' });
    let renders = 0;
    mount(router, 'me', {
      initialState: (ctx) => {
        ctx.goto('question');
        return {};
      },
      actions: { stop(_state, _payload, ctx) { ctx.goto('done'); } },
      phases: { question: { seconds: 30, actions: ['stop'] }, done: {} },
      render: (_state, ui) => {
        renders++;
        return ui.html`<p>${Math.ceil(ui.timeLeft() / 1000)}</p>`;
      },
    });
    await handles[0].ready;
    await router.start();
    await wait(100);
    const before = renders;
    await wait(700);
    expect(renders - before).toBeGreaterThanOrEqual(2);
    handles[0].act('stop');
    await wait(100);
    const after = renders;
    await wait(600);
    expect(renders).toBe(after);
  });

  it('ui.now is a number like ctx.now, fresh on every read', async () => {
    const router = new LocalRouter({ items, mode: 'solo' });
    let ui: any;
    mount(router, 'me', { initialState: () => ({}), actions: {}, render: (_s, u) => { ui = u; return ''; } });
    await handles[0].ready;
    await router.start();
    await wait();
    expect(typeof ui.now).toBe('number');
    const first = ui.now;
    await wait(30);
    expect(ui.now).toBeGreaterThan(first);
  });

  it('ui.question: itemId in the payload, styling hooks, a sent answer shown as chosen until confirmed', async () => {
    const router = new LocalRouter({ items });
    const got: unknown[] = [];
    const def: Omit<GameDefinition<{ answers: Record<string, string> }>, 'root'> = {
      initialState: () => ({ answers: {} }),
      actions: {
        answer(state, payload, ctx) {
          got.push(payload);
          state.answers[ctx.playerId!] = payload.answer;
        },
      },
      render: (state, ui) => ui.html`${ui.question(ui.item('q1')!, { payload: { round: 1 }, chosen: ui.self ? state.answers[ui.self.id] : undefined, disabled: !ui.self })}`,
    };
    mount(router, 'board', def);
    const anna = mount(router, 'anna', def);
    await Promise.all(handles.map((h) => h.ready));
    await router.start();
    await wait();
    const root = anna.querySelector('.mz-q')!;
    expect(root.getAttribute('data-type')).toBe('mcq-single');
    const praha = anna.querySelector('[data-option="praha"]') as HTMLButtonElement;
    expect(praha.style.getPropertyValue('--mz-q-index')).toBe('1');
    router.hold('board'); // a slow network: the answer is on the way
    praha.click();
    await wait();
    expect(praha.className).toContain('mz-q-chosen');
    expect(praha.disabled).toBe(true);
    router.release('board');
    await wait(150);
    expect(got).toEqual([{ itemId: 'q1', round: 1, answer: 'praha' }]);
    expect((anna.querySelector('[data-option="praha"]') as HTMLElement).className).toContain('mz-q-chosen');
    expect(router.errors).toEqual([]);
  });

  it('warns when ui.question reveals on a device without the answer (ctx.reveal missing)', async () => {
    // What a player's device has in multiplayer before ctx.reveal: the item without its answer.
    const router = new LocalRouter({ items: [{ id: 'q1', type: 'mcq-single', question: 'Q', options: [{ id: 'a', text: 'A' }], answerHidden: true } as unknown as OQSEAnyItem] });
    const def: Omit<GameDefinition<{}>, 'root'> = { initialState: () => ({}), actions: {}, render: (_s, ui) => ui.question(ui.item('q1')!, { reveal: true, disabled: true }) };
    mount(router, 'board', def);
    mount(router, 'anna', def);
    await Promise.all(handles.map((h) => h.ready));
    await router.start();
    await wait();
    expect(router.errors).toContainEqual(expect.stringMatching(/^anna REVEAL_WITHOUT_ANSWER: .*ctx\.reveal/));
  });

  it('a double click on the board does not skip two phases', async () => {
    const router = new LocalRouter({ items });
    const def: Omit<GameDefinition<{ phase?: string; n: number }>, 'root'> = {
      initialState: (ctx) => { ctx.goto('a'); return { n: 0 }; },
      phases: { a: {}, b: {}, c: {} },
      actions: { next(state, _p, ctx) { state.n += 1; ctx.goto(state.phase === 'a' ? 'b' : 'c'); } },
      render: (state) => `<p class="phase">${state.phase}</p><button data-act="next">next</button>`,
    };
    const board = mount(router, 'board', def);
    await handles[0].ready;
    await router.start();
    await wait();
    const button = board.querySelector('button')!;
    button.click();
    button.click(); // before the screen re-renders
    await wait();
    expect(board.querySelector('.phase')!.textContent).toBe('b');
    (board.querySelector('button') as HTMLButtonElement).click();
    await wait();
    expect(board.querySelector('.phase')!.textContent).toBe('c');
  });

  it('ui has no escape any more (ui.html escapes)', async () => {
    const router = new LocalRouter({ items, mode: 'solo' });
    let keys: string[] = [];
    mount(router, 'me', { initialState: () => ({}), actions: {}, render: (_s, ui) => { keys = Object.keys(ui); return ''; } });
    await handles[0].ready;
    await router.start();
    await wait();
    expect(keys).toContain('html');
    expect(keys).not.toContain('escape');
  });

  it('runs a presenter game across board and controllers', async () => {
    const router = new LocalRouter({ items });
    const board = mount(router, 'board');
    const anna = mount(router, 'anna');
    const ben = mount(router, 'ben');
    await Promise.all(handles.map((h) => h.ready));
    expect(anna.textContent).toContain('Čekáme na začátek hry');

    await router.start();
    await wait();
    expect(board.querySelector('h1')!.innerHTML).toBe('Hlavní město <strong>Česka</strong>?');
    expect(board.querySelector('.count')!.textContent).toBe('0/2');
    expect(anna.querySelector('.who')!.textContent).toBe('ANNA');

    (anna.querySelectorAll('button')[1] as HTMLButtonElement).click();
    (ben.querySelectorAll('button')[0] as HTMLButtonElement).click();
    await wait(150);

    expect(board.querySelector('.count')!.textContent).toBe('2/2');
    expect(anna.querySelector('.score')!.textContent).toBe('1');
    expect(ben.querySelector('.score')!.textContent).toBe('0');
    expect((anna.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(router.records).toEqual([
      { playerId: 'anna', itemId: 'q1', isCorrect: true },
      { playerId: 'ben', itemId: 'q1', isCorrect: false },
    ]);
    expect(router.errors).toEqual([]);
  });

  it('calls afterRender after renders and accepts actions from the handle (canvas / 3D games)', async () => {
    const router = new LocalRouter({ items });
    const updates: { view: string; answered: number }[] = [];
    const def: Omit<GameDefinition<State>, 'root'> = {
      ...quiz,
      render: (state) => `<p class="count">${Object.keys(state.answers).length}</p><div id="scene" data-keep></div>`,
      afterRender(state, ui) {
        updates.push({ view: ui.view, answered: Object.keys(state.answers).length });
        const scene = ui.view === 'board' ? board.querySelector('#scene')! : null;
        if (scene && !scene.firstChild) scene.appendChild(document.createElement('canvas'));
      },
    };
    const board = mount(router, 'board', def);
    const annaRoot = document.createElement('div');
    document.body.appendChild(annaRoot);
    const anna = startGame({ ...def, root: annaRoot }, { connector: router.connector('anna') });
    handles.push(anna);
    anna.act('answer', { answer: 'praha' }); // before the start: ignored with a warning
    await Promise.all(handles.map((h) => h.ready));
    await router.start();
    await wait();
    const canvas = board.querySelector('#scene canvas');
    expect(canvas).not.toBeNull();

    anna.act('answer', { answer: 'praha' }); // e.g. a tap in a 3D scene
    await wait(150);
    expect(board.querySelector('.count')!.textContent).toBe('1');
    expect(board.querySelector('#scene canvas')).toBe(canvas); // the scene survived re-rendering
    expect(updates.some((u) => u.view === 'board' && u.answered === 1)).toBe(true);
    expect(router.records).toEqual([{ playerId: 'anna', itemId: 'q1', isCorrect: true }]);
    expect(router.errors).toEqual([]);
  });

  it('shows a render error instead of a blank screen and reports it', async () => {
    const router = new LocalRouter({ items, mode: 'solo' });
    const root = mount(router, 'me', { ...quiz, render: () => { throw new Error('oops'); } });
    await handles[0].ready;
    await router.start();
    await wait();
    expect(root.querySelector('.mz-error')!.textContent).toContain('oops');
    expect(router.errors).toEqual(['me RENDER_FAILED: oops']);
  });

  it('saves plugin data (debounced) and refuses it on the board', async () => {
    const router = new LocalRouter({ items });
    let saveFromRender = true;
    const def = {
      ...quiz,
      render(state: State, ui: any) {
        if (saveFromRender && state) ui.save('set', { level: 3 });
        return '<p>x</p>';
      },
    };
    mount(router, 'board', def);
    mount(router, 'anna', def);
    await Promise.all(handles.map((h) => h.ready));
    await router.start();
    await wait(1200);
    saveFromRender = false;
    expect(router.saved).toEqual([{ address: 'anna', scope: 'set', value: { level: 3 } }]);
    expect(router.errors.some((e) => e.startsWith('board NOT_ALLOWED_IN_VIEW'))).toBe(true);
  });

  it('lobby settings screen reports typed values and validity', async () => {
    const router = new LocalRouter({ items, view: 'settings', settings: { questionTime: 20, mode: 'classic' } });
    const root = mount(router, 'board', {
      ...quiz,
      renderSettings: (settings) =>
        `<input type="number" data-setting="questionTime" value="${settings.questionTime}"><select data-setting="mode"><option value="classic">C</option><option value="fast">F</option></select>`,
      validateSettings: (settings) => (settings.mode === 'fast' && (settings.questionTime as number) > 60 ? 'Fast mode needs ≤ 60 s' : undefined),
    });
    await handles[0].ready;
    expect(router.settingsUpdates[0]).toEqual({ values: { questionTime: 20, mode: 'classic' }, valid: true });

    const input = root.querySelector('input')!;
    input.value = '90';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const select = root.querySelector('select')!;
    select.value = 'fast';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(router.settingsUpdates.at(-1)).toEqual({ values: { questionTime: 90, mode: 'fast' }, valid: false, message: 'Fast mode needs ≤ 60 s' });

    input.value = '500';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(router.settingsUpdates.at(-1)).toMatchObject({ valid: false, message: 'questionTime: must be at most 120' });
  });

  it('rejects an invalid definition with a clear message', async () => {
    const router = new LocalRouter({ items, mode: 'solo' });
    const handle = startGame({ actions: {}, render: () => '' } as any, { connector: router.connector('me') });
    await expect(handle.ready).rejects.toThrow(/initialState must be a function/);
    const bad = startGame({ initialState: () => ({}), actions: {}, render: () => '', localActions: { tab: 'map' } } as any, { connector: router.connector('me') });
    await expect(bad.ready).rejects.toThrow(/localActions.tab must be a function/);
  });
});
