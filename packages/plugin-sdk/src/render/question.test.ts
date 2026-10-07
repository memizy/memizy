import { afterEach, describe, expect, it } from 'vitest';
import type { OQSEAnyItem } from '@memizy/oqse';
import { startGame, type GameHandle } from '../game/defineGame';
import { checkAnswer } from '../checkAnswer';
import { LocalRouter, wait } from '../test/localRouter';
import type { GameDefinition } from '../types';

const handles: GameHandle[] = [];
afterEach(() => {
  handles.splice(0).forEach((h) => h.destroy());
  document.body.innerHTML = '';
});

const ch = (...ids: string[]) => ids.map((id) => ({ id, text: id.toUpperCase() }));
const id = (n: number) => `0192f0c4-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;

/** A solo game that shows one item with ui.question and records the answer. */
async function play(item: OQSEAnyItem, interact: (root: HTMLElement) => Promise<void> | void) {
  const router = new LocalRouter({ mode: 'solo', items: [item] });
  const def: Omit<GameDefinition<{ answer: unknown; done: boolean }>, 'root'> = {
    initialState: () => ({ answer: null, done: false }),
    actions: {
      answer(state, payload, ctx) {
        state.answer = payload.answer;
        state.done = true;
        const correct = item.type === 'flashcard' || item.type === 'note' || item.type === 'open-ended' ? true : checkAnswer(ctx.item(item.id)!, payload.answer);
        ctx.recordAnswer(item.id, correct, { answer: payload.answer });
      },
    },
    render: (state, ui) => ui.html`<div class="game">${ui.question(ui.item(item.id)!, { payload: { round: 1 }, chosen: state.done ? state.answer : undefined, reveal: state.done })}</div>`,
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  handles.push(startGame({ ...def, root }, { connector: router.connector('me') }));
  await Promise.all(handles.map((h) => h.ready));
  await router.start();
  await wait(60);
  await interact(root);
  await wait(80);
  return { root, record: router.records[0] };
}

const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('element not found');
  (el as HTMLElement).click();
  await wait(40);
};
const byText = (root: HTMLElement, selector: string, text: string) => [...root.querySelectorAll(selector)].find((e) => e.textContent?.includes(text));
const choose = async (select: Element | null | undefined, value: string) => {
  if (!select) throw new Error('select not found');
  (select as HTMLSelectElement).value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(40);
};
const type = (input: Element | null | undefined, value: string) => {
  if (!input) throw new Error('input not found');
  (input as HTMLInputElement).value = value;
};

describe('ui.question', () => {
  it('mcq-single: one tap answers with the option id; reveal marks right and wrong', async () => {
    const item = { id: id(1), type: 'mcq-single', question: 'Hlavní město?', options: [{ id: 'brno', text: 'Brno' }, { id: 'praha', text: 'Praha' }], correctId: 'praha' } as OQSEAnyItem;
    const { root, record } = await play(item, (r) => click(byText(r, '.mz-q-opt', 'Brno')));
    expect(record).toMatchObject({ isCorrect: false, answer: 'brno' });
    expect(root.querySelector('.mz-q-question')!.textContent!.trim()).toBe('Hlavní město?');
    expect(byText(root, '.mz-q-opt', 'Praha')!.className).toContain('mz-q-right');
    expect(byText(root, '.mz-q-opt', 'Brno')!.className).toContain('mz-q-wrong');
    expect((root.querySelector('.mz-q-opt') as HTMLButtonElement).disabled).toBe(true);
  });

  it('true-false and mcq-multi', async () => {
    const tf = await play({ id: id(2), type: 'true-false', question: 'Q', correctAnswer: false } as OQSEAnyItem, (r) => click(r.querySelector('.mz-q-no')));
    expect(tf.record).toMatchObject({ isCorrect: true, answer: false });
    const multi = await play({ id: id(3), type: 'mcq-multi', question: 'Q', options: ch('a', 'b', 'c'), correctIds: ['a', 'c'] } as OQSEAnyItem, async (r) => {
      expect((r.querySelector('.mz-q-submit') as HTMLButtonElement).disabled).toBe(true);
      await click(byText(r, '.mz-q-opt', 'C'));
      await click(byText(r, '.mz-q-opt', 'B'));
      await click(byText(r, '.mz-q-opt', 'B')); // toggled off again
      await click(byText(r, '.mz-q-opt', 'A'));
      await click(r.querySelector('.mz-q-submit'));
    });
    expect(multi.record).toMatchObject({ isCorrect: true });
    expect([...(multi.record.answer as string[])].sort()).toEqual(['a', 'c']);
  });

  it('sort-items and timeline by tapping in order', async () => {
    const sort = await play({ id: id(4), type: 'sort-items', question: 'Q', items: ch('x', 'y', 'z'), correctOrder: ['z', 'x', 'y'] } as OQSEAnyItem, async (r) => {
      for (const t of ['Z', 'Y']) await click(byText(r, '.mz-q-options .mz-q-opt', t));
      await click(byText(r, '.mz-q-order .mz-q-opt', 'Y')); // take it back
      for (const t of ['X', 'Y']) await click(byText(r, '.mz-q-options .mz-q-opt', t));
      await click(r.querySelector('.mz-q-submit'));
    });
    expect(sort.record).toMatchObject({ isCorrect: true, answer: ['z', 'x', 'y'] });
    const events = [{ id: 'e2', text: 'B', date: '1950-01-01' }, { id: 'e1', text: 'A', date: '1900-01-01' }];
    const tl = await play({ id: id(5), type: 'timeline', question: 'Q', events } as OQSEAnyItem, async (r) => {
      await click(byText(r, '.mz-q-options .mz-q-opt', 'A'));
      await click(byText(r, '.mz-q-options .mz-q-opt', 'B'));
      await click(r.querySelector('.mz-q-submit'));
    });
    expect(tl.record).toMatchObject({ isCorrect: true, answer: ['e1', 'e2'] });
  });

  it('match-pairs, categorize and fill-in-select with selects', async () => {
    const pairs = await play({ id: id(6), type: 'match-pairs', prompts: ch('cz', 'sk'), matches: ch('praha', 'bratislava', 'viden'), pairs: { cz: 'praha', sk: 'bratislava' } } as OQSEAnyItem, async (r) => {
      const selects = r.querySelectorAll('select');
      await choose(selects[0], 'praha');
      await choose(r.querySelectorAll('select')[1], 'bratislava');
      await click(r.querySelector('.mz-q-submit'));
    });
    expect(pairs.record).toMatchObject({ isCorrect: true, answer: { cz: 'praha', sk: 'bratislava' } });
    const cat = await play({ id: id(7), type: 'categorize', question: 'Q', categories: ch('m', 'b'), items: [{ id: 'dog', text: 'Pes', correctCategoryId: 'm' }] } as OQSEAnyItem, async (r) => {
      await choose(r.querySelector('select'), 'm');
      await click(r.querySelector('.mz-q-submit'));
    });
    expect(cat.record).toMatchObject({ isCorrect: true, answer: { dog: 'm' } });
    const select = await play({ id: id(8), type: 'fill-in-select', text: 'Praha je <blank:t />.', blanks: { t: { options: ch('mesto', 'reka'), correctId: 'mesto' } } } as OQSEAnyItem, async (r) => {
      expect(r.querySelector('.mz-q-text select')).not.toBeNull();
      await choose(r.querySelector('select'), 'mesto');
      await click(r.querySelector('.mz-q-submit'));
    });
    expect(select.record).toMatchObject({ isCorrect: true, answer: { t: 'mesto' } });
  });

  it('typed answers: short-answer (Enter), numeric-input and fill-in-blanks', async () => {
    const short = await play({ id: id(9), type: 'short-answer', question: 'Q', correctAnswers: ['Praha'] } as OQSEAnyItem, async (r) => {
      await click(r.querySelector('.mz-q-submit')); // empty: nothing happens
      type(r.querySelector('input[name="answer"]'), ' praha ');
      r.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await wait(40);
    });
    expect(short.record).toMatchObject({ isCorrect: true, answer: 'praha' });
    const num = await play({ id: id(10), type: 'numeric-input', question: 'Q', correctAnswer: 9.81, tolerance: 0.05 } as OQSEAnyItem, async (r) => {
      type(r.querySelector('input[name="answer"]'), '9,8');
      await click(r.querySelector('.mz-q-submit'));
    });
    expect(num.record).toMatchObject({ isCorrect: true, answer: '9,8' });
    const blanks = await play({ id: id(11), type: 'fill-in-blanks', text: 'Voda je <blank:a /> a <blank:b />.', blanks: { a: ['H2O'], b: ['kapalina'] } } as OQSEAnyItem, async (r) => {
      const inputs = r.querySelectorAll('input[data-blank]');
      type(inputs[0], 'h2o');
      type(inputs[1], 'Kapalina');
      await click(r.querySelector('.mz-q-submit'));
    });
    expect(blanks.record).toMatchObject({ isCorrect: true, answer: { a: 'h2o', b: 'Kapalina' } });
  });

  it('matrix toggles, flashcards flip and rate, extra payload is kept', async () => {
    const matrix = await play({ id: id(12), type: 'matrix', question: 'Q', rows: ch('r1', 'r2'), columns: ch('c1', 'c2'), correctCells: [['r1', 'c2'], ['r2', 'c1']], multiplePerRow: false } as OQSEAnyItem, async (r) => {
      const cells = r.querySelectorAll('.mz-q-cell'); // r1c1 r1c2 r2c1 r2c2
      await click(cells[1]);
      await click(r.querySelectorAll('.mz-q-cell')[2]);
      await click(r.querySelector('.mz-q-submit'));
    });
    expect(matrix.record.isCorrect).toBe(true);
    const flash = await play({ id: id(13), type: 'flashcard', front: 'Fotosyntéza', back: 'Přeměna světla' } as OQSEAnyItem, async (r) => {
      expect(r.textContent).not.toContain('Přeměna světla');
      await click(r.querySelector('.mz-q-reset'));
      expect(r.textContent).toContain('Přeměna světla');
      await click(byText(r, '.mz-q-opt', 'Vím'));
    });
    expect(flash.record).toMatchObject({ answer: 'good' });
  });

  it('says so for a type without controls', async () => {
    const router = new LocalRouter({ mode: 'solo', items: [] });
    const root = document.createElement('div');
    document.body.appendChild(root);
    handles.push(
      startGame(
        { root, initialState: () => ({}), actions: {}, render: (_s, ui) => ui.question({ id: 'c', type: 'chess-puzzle', question: 'Mat 1', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', correctAnswers: [['Ka2']] } as OQSEAnyItem) },
        { connector: router.connector('me') },
      ),
    );
    await handles[0].ready;
    await router.start();
    await wait(60);
    expect(root.querySelector('.mz-q-unsupported')).not.toBeNull();
  });
});
