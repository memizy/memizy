/**
 * `ui.question(item, options)` – ready-made answering controls for OQSE items.
 *
 * Every control dispatches `options.action` (default "answer") with
 * `{ ...options.payload, answer }`, where `answer` is in the `checkAnswer` format
 * (choice IDs). Picking several things (multi choice, sorting, pairs…) is kept on this
 * device until "Submit"; the SDK handles those clicks itself (`data-mzq`).
 *
 * The look comes from CSS variables (see styles.ts): --mz-q-accent, --mz-q-bg,
 * --mz-q-fg, --mz-q-border, --mz-q-radius, --mz-q-gap, --mz-q-right, --mz-q-wrong.
 */

import type { OQSEAnyItem } from '@memizy/oqse';
import { escapeHtml } from '../text/richText';

export interface QuestionOptions {
  /** Action to call with the answer (default "answer"). */
  action?: string;
  /** Extra fields of the action payload (e.g. `{ round: 3 }`). */
  payload?: Record<string, unknown>;
  /** The player's answer so far (e.g. from the state or `ui.pending`): marked as chosen and locks the controls. */
  chosen?: unknown;
  /** Show which answers are right (only when the item has its answer, see `ctx.reveal`). */
  reveal?: boolean;
  /** Disable the controls (e.g. on the board, or when the time is up). */
  disabled?: boolean;
  /** Show the question text above the controls (default true). */
  showQuestion?: boolean;
  /** Label of the submit button. */
  submitLabel?: string;
  /**
   * How many players chose each option (choice types: `mcq-single`, `mcq-multi`,
   * `true-false`), shown as a badge on the option, e.g. on the board after the reveal.
   * Keys are option IDs (`true` / `false` for true-false); a missing key counts as 0.
   */
  counts?: Record<string, number>;
}

/** What the SDK keeps on this device while the player assembles an answer. */
export interface QuestionLocal {
  picked?: string[];
  sel?: Record<string, string>;
  flipped?: boolean;
  points?: { x: number; y: number }[];
}

/** A click or change on `[data-mzq]` (handled by the SDK, not by the game). */
export interface QuestionEvent {
  q: string;
  op: 'toggle' | 'push' | 'remove' | 'reset' | 'select' | 'flip' | 'pin';
  id?: string;
  key?: string;
  value?: string;
  x?: number;
  y?: number;
}

const TEXTS = {
  cs: { submit: 'Odeslat', truth: 'Pravda', lie: 'Nepravda', reset: 'Znovu', flip: 'Otočit', again: 'Nevím', good: 'Vím', easy: 'Snadné', read: 'Přečteno', pick: '— vyber —', pin: 'Klepni do obrázku', yours: 'Tvoje pořadí', unsupported: 'Tento typ otázky zatím nemá hotové ovládání.' },
  en: { submit: 'Submit', truth: 'True', lie: 'False', reset: 'Reset', flip: 'Flip', again: 'Again', good: 'I know it', easy: 'Easy', read: 'Done', pick: '— choose —', pin: 'Tap the picture', yours: 'Your order', unsupported: 'This question type has no ready-made controls yet.' },
};

type Choice = { id: string; text: string };

export interface QuestionContext {
  /** Rich text renderer (`ui.text`). */
  text(markdown: string | undefined | null, options?: { inline?: boolean; item?: OQSEAnyItem }): string;
  local: QuestionLocal;
  locale: string;
  /** URL of an asset of the item (for pin-on-image), if it can be shown. */
  assetUrl?(key: string): string | null;
}

export function renderQuestion(item: OQSEAnyItem, options: QuestionOptions, qc: QuestionContext): string {
  const t = qc.locale.startsWith('cs') ? TEXTS.cs : TEXTS.en;
  const it = item as any;
  const action = options.action ?? 'answer';
  const locked = options.disabled === true || options.chosen !== undefined;
  const reveal = options.reveal === true && !it.answerHidden;
  const local = qc.local;
  const inline = (s: unknown) => qc.text(String(s ?? ''), { inline: true, item });
  const payload = (answer: unknown) => escapeHtml(JSON.stringify({ ...(options.payload ?? {}), answer }));
  const act = (answer: unknown, enabled = true) => `data-act="${escapeHtml(action)}" data-payload="${payload(answer)}"${!enabled || locked ? ' disabled' : ''}`;
  const mzq = (event: Omit<QuestionEvent, 'q'>) => `data-mzq="${escapeHtml(JSON.stringify({ q: item.id, ...event }))}"${locked ? ' disabled' : ''}`;
  const submit = (answer: unknown, enabled: boolean) => `<button type="button" class="mz-q-submit" ${act(answer, enabled)}>${escapeHtml(options.submitLabel ?? t.submit)}</button>`;
  const head = options.showQuestion === false ? '' : questionHead(it, qc);
  const wrap = (body: string, extra = '') => `<div class="mz-q mz-q-${escapeHtml(it.type)}${extra}" data-mzq-root="${escapeHtml(item.id)}">${head}${body}</div>`;
  const isChosen = (id: unknown) => options.chosen !== undefined && (Array.isArray(options.chosen) ? options.chosen.includes(id) : options.chosen === id);
  const count = (id: unknown) => {
    if (!options.counts || typeof options.counts !== 'object') return '';
    const n = Number(options.counts[String(id)] ?? 0);
    const value = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return `<span class="mz-q-count${value === 0 ? ' mz-q-count-0' : ''}">${value}</span>`;
  };
  const mark = (id: unknown, right: boolean) => `${isChosen(id) ? ' mz-q-chosen' : ''}${reveal ? (right ? ' mz-q-right' : isChosen(id) ? ' mz-q-wrong' : ' mz-q-dim') : ''}`;
  const textForm = (kind: 'text' | 'number' | 'textarea', attrs = '') => {
    const id = `mzq-${item.id}`;
    const field =
      kind === 'textarea'
        ? `<textarea id="${escapeHtml(id)}" class="mz-q-input" name="answer" rows="4"${locked ? ' disabled' : ''}></textarea>`
        : `<input id="${escapeHtml(id)}" class="mz-q-input" name="answer" autocomplete="off" ${kind === 'number' ? 'inputmode="decimal"' : ''} ${attrs}${locked ? ' disabled' : ''}>`;
    const shown = options.chosen !== undefined ? `<div class="mz-q-given">${escapeHtml(String(options.chosen))}</div>` : '';
    return `<form class="mz-q-form" data-mzq-form>${field}<button type="submit" class="mz-q-submit" data-act="${escapeHtml(action)}" data-payload="${payload(null)}" data-answer-from="${kind === 'number' ? 'number' : 'text'}"${locked ? ' disabled' : ''}>${escapeHtml(options.submitLabel ?? t.submit)}</button></form>${shown}`;
  };

  switch (it.type) {
    case 'mcq-single':
      return wrap(`<div class="mz-q-options">${(it.options as Choice[]).map((o, i) => `<button type="button" class="mz-q-opt${mark(o.id, o.id === it.correctId)}" ${act(o.id)}><span class="mz-q-key">${'ABCDEFGHIJ'[i] ?? i + 1}</span><span class="mz-q-label">${inline(o.text)}</span>${count(o.id)}</button>`).join('')}</div>`);

    case 'true-false':
      return wrap(`<div class="mz-q-options mz-q-two">${[true, false].map((v) => `<button type="button" class="mz-q-opt mz-q-${v ? 'yes' : 'no'}${mark(v, v === it.correctAnswer)}" ${act(v)}><span class="mz-q-label">${v ? t.truth : t.lie}</span>${count(v)}</button>`).join('')}</div>`);

    case 'mcq-multi': {
      const picked = locked && Array.isArray(options.chosen) ? (options.chosen as string[]) : local.picked ?? [];
      const right = new Set<string>(it.correctIds ?? []);
      return wrap(
        `<div class="mz-q-options">${(it.options as Choice[]).map((o, i) => `<button type="button" class="mz-q-opt${picked.includes(o.id) ? ' mz-q-picked' : ''}${mark(o.id, right.has(o.id))}" ${mzq({ op: 'toggle', id: o.id })} aria-pressed="${picked.includes(o.id)}"><span class="mz-q-key">${'ABCDEFGHIJ'[i] ?? i + 1}</span><span class="mz-q-label">${inline(o.text)}</span>${count(o.id)}</button>`).join('')}</div>` +
          submit(picked, picked.length > 0),
      );
    }

    case 'short-answer':
    case 'math-input':
      return wrap(textForm('text'));
    case 'numeric-input':
      return wrap(textForm('number') + (it.unit ? `<span class="mz-q-unit">${escapeHtml(it.unit)}</span>` : ''));
    case 'open-ended':
      return wrap(textForm('textarea'));
    case 'slider': {
      const value = local.sel?.value ?? String(it.min);
      return wrap(
        `<div class="mz-q-slider"><input type="range" class="mz-q-range" min="${it.min}" max="${it.max}" step="${it.step}" value="${escapeHtml(value)}" ${mzq({ op: 'select', key: 'value' })}><output class="mz-q-value">${escapeHtml(value)}${it.unit ? ` ${escapeHtml(it.unit)}` : ''}</output></div>` +
          submit(Number(value), true),
      );
    }

    case 'sort-items':
    case 'timeline': {
      const list: Choice[] = it.type === 'timeline' ? (it.events as Choice[]) : (it.items as Choice[]);
      const picked = (locked && Array.isArray(options.chosen) ? (options.chosen as string[]) : local.picked ?? []).filter((id) => list.some((c) => c.id === id));
      const rest = list.filter((c) => !picked.includes(c.id));
      const byId = new Map(list.map((c) => [c.id, c]));
      return wrap(
        `<ol class="mz-q-order">${picked.map((id) => `<li><button type="button" class="mz-q-opt mz-q-placed" ${mzq({ op: 'remove', id })}><span class="mz-q-label">${inline(byId.get(id)!.text)}</span></button></li>`).join('')}</ol>` +
          `<div class="mz-q-options">${rest.map((c) => `<button type="button" class="mz-q-opt" ${mzq({ op: 'push', id: c.id })}><span class="mz-q-label">${inline(c.text)}</span></button>`).join('')}</div>` +
          `<div class="mz-q-row">${picked.length ? `<button type="button" class="mz-q-reset" ${mzq({ op: 'reset' })}>${t.reset}</button>` : ''}${submit(picked, rest.length === 0)}</div>`,
      );
    }

    case 'match-pairs':
      return wrap(selects(it.prompts as Choice[], it.matches as Choice[], (sel) => sel));
    case 'categorize':
      return wrap(selects(it.items as Choice[], it.categories as Choice[], (sel) => sel));
    case 'diagram-label': {
      const zones = (it.zones as { id: string; label?: string }[]).map((z, i) => ({ id: z.id, text: z.label ?? `${i + 1}.` }));
      const picture = it.targetAsset && qc.assetUrl?.(it.targetAsset);
      const img = picture ? `<div class="mz-q-picture"><img src="${escapeHtml(picture)}" alt=""></div>` : '';
      return wrap(img + selects(zones, it.labels as Choice[], (sel) => sel));
    }

    case 'fill-in-select': {
      const sel = local.sel ?? {};
      const tokens = Object.keys(it.blanks ?? {});
      const body = inline(it.text).replace(/<span class="mz-blank" data-mz-blank="([^"]*)"><\/span>/g, (_m, token: string) => {
        const blank = it.blanks?.[token];
        if (!blank) return '';
        return `<select class="mz-q-select" ${mzq({ op: 'select', key: token })}><option value="">${t.pick}</option>${(blank.options as Choice[]).map((o) => `<option value="${escapeHtml(o.id)}"${sel[token] === o.id ? ' selected' : ''}>${escapeHtml(stripMarkdown(o.text))}</option>`).join('')}</select>`;
      });
      return wrap(`<div class="mz-q-text">${body}</div>` + submit(sel, tokens.every((k) => sel[k])));
    }

    case 'fill-in-blanks': {
      const body = inline(it.text).replace(/<span class="mz-blank" data-mz-blank="([^"]*)"><\/span>/g, (_m, token: string) =>
        `<input class="mz-q-input mz-q-blank" id="mzq-${escapeHtml(item.id)}-${token}" data-blank="${token}" autocomplete="off"${locked ? ' disabled' : ''}>`);
      return wrap(`<form class="mz-q-form" data-mzq-form><div class="mz-q-text">${body}</div><button type="submit" class="mz-q-submit" data-act="${escapeHtml(action)}" data-payload="${payload(null)}" data-answer-from="blanks"${locked ? ' disabled' : ''}>${escapeHtml(options.submitLabel ?? t.submit)}</button></form>`);
    }

    case 'matrix':
    case 'match-complex': {
      const rows: Choice[] = it.type === 'matrix' ? it.rows : it.leftItems;
      const cols: Choice[] = it.type === 'matrix' ? it.columns : it.rightItems;
      const picked = local.picked ?? [];
      const key = (r: string, c: string) => `${r}\u0001${c}`;
      const answer = picked.map((k) => k.split('\u0001'));
      return wrap(
        `<table class="mz-q-grid"><thead><tr><th></th>${cols.map((c) => `<th>${inline(c.text)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr><th>${inline(r.text)}</th>${cols.map((c) => `<td><button type="button" class="mz-q-cell${picked.includes(key(r.id, c.id)) ? ' mz-q-picked' : ''}" aria-pressed="${picked.includes(key(r.id, c.id))}" ${mzq({ op: 'toggle', id: key(r.id, c.id) })}></button></td>`).join('')}</tr>`)
          .join('')}</tbody></table>` + submit(answer, picked.length > 0),
      );
    }

    case 'flashcard': {
      const back = !it.answerHidden && local.flipped ? `<div class="mz-q-back">${qc.text(it.back, { item })}</div>` : '';
      const flip = it.answerHidden || local.flipped ? '' : `<button type="button" class="mz-q-reset" ${mzq({ op: 'flip' })}>${t.flip}</button>`;
      const rate = local.flipped || it.answerHidden ? `<div class="mz-q-options mz-q-three">${(['again', 'good', 'easy'] as const).map((r) => `<button type="button" class="mz-q-opt${isChosen(r) ? ' mz-q-chosen' : ''}" ${act(r)}><span class="mz-q-label">${t[r]}</span></button>`).join('')}</div>` : '';
      return `<div class="mz-q mz-q-flashcard" data-mzq-root="${escapeHtml(item.id)}"><div class="mz-q-front">${qc.text(it.front, { item })}</div>${back}${flip}${rate}</div>`;
    }

    case 'note':
      return `<div class="mz-q mz-q-note" data-mzq-root="${escapeHtml(item.id)}">${qc.text(it.content, { item })}<button type="button" class="mz-q-submit" ${act('read')}>${t.read}</button></div>`;

    case 'pin-on-image': {
      const url = it.targetAsset && qc.assetUrl?.(it.targetAsset);
      const points = local.points ?? [];
      const many = it.multipleCorrect === true;
      const pins = points.map((p) => `<span class="mz-q-pin" style="left:${p.x}%;top:${p.y}%"></span>`).join('');
      const answer = many ? points : points[0] ?? null;
      return wrap(
        `<div class="mz-q-picture mz-q-pinboard" ${mzq({ op: 'pin', key: many ? 'many' : 'one' })}>${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(t.pin)}">` : `<div class="mz-q-noimage">${t.pin}</div>`}${pins}</div>` +
          `<div class="mz-q-row">${points.length ? `<button type="button" class="mz-q-reset" ${mzq({ op: 'reset' })}>${t.reset}</button>` : ''}${submit(answer, points.length > 0)}</div>`,
      );
    }

    default:
      return wrap(`<div class="mz-q-unsupported">${t.unsupported}</div>`);
  }

  /** One select per row (prompt / entry / zone), choosing from `targets`. */
  function selects(rows: Choice[], targets: Choice[], answerOf: (sel: Record<string, string>) => unknown): string {
    const sel = local.sel ?? {};
    const body = rows
      .map((row) => `<div class="mz-q-pair"><div class="mz-q-label">${inline(row.text)}</div><select class="mz-q-select" ${mzq({ op: 'select', key: row.id })}><option value="">${t.pick}</option>${targets.map((o) => `<option value="${escapeHtml(o.id)}"${sel[row.id] === o.id ? ' selected' : ''}>${escapeHtml(stripMarkdown(o.text))}</option>`).join('')}</select></div>`)
      .join('');
    return `<div class="mz-q-pairs">${body}</div>` + submit(answerOf(sel), rows.every((r) => sel[r.id]));
  }
}

function questionHead(it: any, qc: QuestionContext): string {
  const text = it.question ?? (it.type === 'fill-in-blanks' || it.type === 'fill-in-select' ? undefined : it.text);
  return text ? `<div class="mz-q-question">${qc.text(text, { item: it })}</div>` : '';
}

/** Plain text for `<option>` (no HTML there): drops simple Markdown marks. */
function stripMarkdown(text: string): string {
  return String(text ?? '').replace(/[*_`$]/g, '');
}

/** Applies a `[data-mzq]` event to the device-local state of a question. */
export function applyQuestionEvent(local: QuestionLocal, event: QuestionEvent): void {
  switch (event.op) {
    case 'toggle': {
      const picked = new Set(local.picked ?? []);
      if (event.id === undefined) return;
      if (picked.has(event.id)) picked.delete(event.id);
      else picked.add(event.id);
      local.picked = [...picked];
      return;
    }
    case 'push':
      if (event.id !== undefined && !(local.picked ?? []).includes(event.id)) local.picked = [...(local.picked ?? []), event.id];
      return;
    case 'remove':
      local.picked = (local.picked ?? []).filter((id) => id !== event.id);
      return;
    case 'reset':
      local.picked = [];
      local.points = [];
      return;
    case 'select':
      if (event.key !== undefined) local.sel = { ...(local.sel ?? {}), [event.key]: event.value ?? '' };
      return;
    case 'flip':
      local.flipped = true;
      return;
    case 'pin':
      if (typeof event.x === 'number' && typeof event.y === 'number') {
        const point = { x: Math.round(event.x * 10) / 10, y: Math.round(event.y * 10) / 10 };
        local.points = event.key === 'many' ? [...(local.points ?? []), point] : [point];
      }
      return;
  }
}
