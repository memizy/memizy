import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as oqse from '@memizy/oqse';
import { startGame, type GameHandle } from '../game/defineGame';
import { wait } from '../test/localRouter';
import type { GameDefinition } from '../types';
import { inMemizyFrame } from '../connection/connect';

const PLUGIN_ID = 'https://example.com/plugins/standalone-test';
const reader = async () => oqse as never;

beforeAll(() => {
  const manifest = document.createElement('script');
  manifest.type = 'application/oqse-manifest+json';
  manifest.textContent = JSON.stringify({
    version: '1.0',
    id: PLUGIN_ID,
    appName: 'Standalone test',
    pluginVersion: '1.0.0',
    capabilities: { actions: ['render'], types: ['mcq-single', 'note'] },
    appSpecific: { memizy: { protocol: '1.1', modes: { solo: {} }, settings: [{ id: 'rounds', type: 'number', label: 'Rounds', default: 3, min: 1, max: 9 }] } },
  });
  document.head.appendChild(manifest);
});

const handles: GameHandle[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  handles.splice(0).forEach((h) => h.destroy());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

interface S {
  round: number;
}
const game: Omit<GameDefinition<S>, 'root'> = {
  initialState: () => ({ round: 0 }),
  actions: {
    answer(state, payload, ctx) {
      ctx.recordAnswer(ctx.items[0].id, payload?.right === true);
      state.round += 1;
    },
  },
  render: (_s, ui) =>
    `<p class="set">${ui.items.length}:${ui.items.map((i: any) => i.question ?? i.title).join('|')}</p><p class="rounds">${ui.settings.rounds}</p><p class="lang">${ui.locale}</p><button class="right" data-act="answer" data-payload='{"right":true}'>ok</button>`,
};

function start(def: Partial<GameDefinition<S>> = {}): { root: HTMLElement; handle: GameHandle } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = startGame({ ...game, ...def, root } as GameDefinition<S>, { setReader: reader });
  handles.push(handle);
  return { root, handle };
}

function stopAll(): void {
  handles.splice(0).forEach((h) => h.destroy());
  document.body.innerHTML = '';
}

const ownSet = {
  version: '1.0',
  meta: { id: '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6b00', language: 'cs', title: 'Moje sada', createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:00:00Z' },
  items: [
    { id: '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6b01', type: 'mcq-single', question: 'Moje otázka?', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correctId: 'a' },
    { id: '0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6b02', type: 'flashcard', front: 'F', back: 'B' }, // not a type of this game
  ],
};

/** Chooses a file in the open menu. */
async function chooseFile(text: string, name: string): Promise<void> {
  const input = document.querySelector('.mz-standalone-menu input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File([text], name)], configurable: true });
  input.dispatchEvent(new Event('change'));
  await wait(300);
}

describe('standalone mode (the game outside Memizy)', () => {
  it('plays the sample set in the browser language and shows the menu button', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    const { root, handle } = start();
    await handle.ready;
    await wait(50);
    expect(root.querySelector('.set')!.textContent).toContain('What is the capital of **France**?');
    expect(root.querySelector('.lang')!.textContent).toBe('en-GB');
    // the tab at the top centre (default): the set's title in its label
    const tab = document.querySelector('.mz-standalone-button')!;
    expect(tab.classList.contains('mz-standalone-tab')).toBe(true);
    expect(tab.getAttribute('title')).toContain('Sample set');
  });

  it('loads the player’s own set from a file, keeps its progress apart, and remembers it', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('cs-CZ');
    const { root, handle } = start();
    await handle.ready;
    await wait(50);
    expect(root.querySelector('.set')!.textContent).toContain('Jaké je hlavní město');
    (document.querySelector('.mz-standalone-button') as HTMLButtonElement).click();
    expect(document.querySelector('.mz-standalone-menu')).not.toBeNull();

    await chooseFile('{"not": "a set"}', 'bad.json'); // refused, the menu says why
    expect(document.querySelector('.mz-standalone-status')!.textContent).toMatch(/nepodařilo/);
    await chooseFile(JSON.stringify(ownSet), 'moje.json');
    expect(document.querySelector('.mz-standalone-menu')).toBeNull();
    await wait(100);
    expect(root.querySelector('.set')!.textContent).toBe('1:Moje otázka?'); // only the types this game plays
    expect(document.querySelector('.mz-standalone-button')!.getAttribute('title')).toContain('Moje sada');

    (root.querySelector('.right') as HTMLButtonElement).click();
    await wait(100);
    const progress = JSON.parse(localStorage.getItem(`memizy:${PLUGIN_ID}:progress:${ownSet.meta.id}`)!);
    expect(progress[ownSet.items[0].id]).toMatchObject({ bucket: 2 }) // a first right answer: level 2 (1.1 rules);

    // Opened again later: the same set.
    stopAll();
    const again = start();
    await again.handle.ready;
    await wait(50);
    expect(again.root.querySelector('.set')!.textContent).toBe('1:Moje otázka?');
  });

  it('reads OQSE Markdown notes from `?set=<url>`; a link that fails opens the menu with the reason', async () => {
    const markdown = '---\noqse: "1.0"\nlanguage: cs\n---\n# Poznámky\n\n### První poznámka\n\nText.\n';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (String(url).includes('good') ? new Response(markdown) : new Response('nope', { status: 404 })));
    history.replaceState(null, '', '?set=https://example.com/good.md');
    try {
      const { root, handle } = start();
      await handle.ready;
      await wait(50);
      expect(fetchMock).toHaveBeenCalledWith('https://example.com/good.md');
      expect(root.querySelector('.set')!.textContent).toBe('1:První poznámka');
      stopAll();

      history.replaceState(null, '', '?set=https://example.com/missing.json');
      const failed = start();
      await failed.handle.ready;
      await wait(50);
      expect(document.querySelector('.mz-standalone-status')!.textContent).toMatch(/404/);
      expect(failed.root.querySelector('.set')!.textContent).toBe('1:První poznámka'); // the last set stays
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('applies the settings from the menu and starts again; the reset deletes the progress after two taps', async () => {
    const { root, handle } = start();
    await handle.ready;
    await wait(50);
    expect(root.querySelector('.rounds')!.textContent).toBe('3');
    (root.querySelector('.right') as HTMLButtonElement).click();
    await wait(100);
    expect(Object.keys(localStorage).some((k) => k.includes(':progress:'))).toBe(true);

    expect(handle.openStandaloneMenu()).toBe(true);
    (document.querySelector('input[name="mz-s-rounds"]') as HTMLInputElement).value = '7';
    (document.querySelector('.mz-standalone-settings') as HTMLFormElement).requestSubmit();
    await wait(150);
    expect(root.querySelector('.rounds')!.textContent).toBe('7');

    handle.openStandaloneMenu();
    const reset = document.querySelector('.mz-standalone-reset') as HTMLButtonElement;
    reset.click();
    expect(document.querySelector('.mz-standalone-menu')).not.toBeNull(); // asks first
    reset.click();
    await wait(150);
    expect(Object.keys(localStorage).some((k) => k.includes(':progress:'))).toBe(false);
  });

  it('controls: hidden – no button; the game opens the menu itself', async () => {
    const { handle } = start({ standalone: { controls: 'hidden' } });
    await handle.ready;
    await wait(50);
    expect(document.querySelector('.mz-standalone-button')).toBeNull();
    expect(handle.openStandaloneMenu()).toBe(true);
    expect(document.querySelector('.mz-standalone-menu')).not.toBeNull();
  });

  it('knows a Memizy plugin frame by its name (SPEC 4)', () => {
    const name = window.name;
    window.name = 'mz-plugin';
    expect(inMemizyFrame()).toBe(true);
    window.name = 'preview';
    expect(inMemizyFrame()).toBe(false);
    window.name = name;
  });
});
