/**
 * `ui.question(item, options)` – ready-made answering controls for OQSE items.
 *
 * Every control dispatches `options.action` (default "answer") with
 * `{ ...options.payload, answer }`, where `answer` is in the `checkAnswer` format
 * (choice IDs). Picking several things (multi choice, sorting, pairs…) is kept on this
 * device until "Submit"; the SDK handles those clicks itself (`data-mz-q`).
 *
 * The look comes from CSS variables (see styles.ts): --mz-q-accent, --mz-q-bg,
 * --mz-q-fg, --mz-q-border, --mz-q-radius, --mz-q-gap, --mz-q-right, --mz-q-wrong.
 */

import { checkAnswer as checkOQSEAnswer, compareTimelineEvents, textAnswerMatches, type OQSEAnyItem } from '@memizy/oqse';
import { escapeHtml } from '../text/richText';

export interface QuestionOptions {
  /** Action to call with the answer (default "answer"). */
  action?: string;
  /** Extra fields of the action payload (it always has `itemId` and `answer`). */
  payload?: Record<string, unknown>;
  /**
   * The player's answer (e.g. from the state): marked as chosen and locks the controls.
   * Not needed while the answer is on the way: the SDK shows a sent answer by itself.
   */
  chosen?: unknown;
  /**
   * Show the right answer (only when the item has its answer, see `ctx.reveal`): every type
   * marks the player's answer right or wrong and shows what was right, then the
   * explanation. Keep it as long as the game wants the answer seen.
   */
  reveal?: boolean;
  /** With `reveal`: show the item's explanation (and feedback of a wrong answer). Default true. */
  explanation?: boolean;
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
  /** Text typed so far: `answer` for the one field, a blank's token for `fill-in-blanks`. */
  typed?: Record<string, string>;
}

/** A click or change on `[data-mz-q]` (handled by the SDK, not by the game). */
export interface QuestionEvent {
  q: string;
  op: 'toggle' | 'push' | 'remove' | 'reset' | 'select' | 'flip' | 'pin' | 'type';
  id?: string;
  key?: string;
  value?: string;
  x?: number;
  y?: number;
}

const TEXTS = {
  cs: { submit: 'Odeslat', truth: 'Pravda', lie: 'Nepravda', reset: 'Znovu', flip: 'Otočit', rate1: 'Nevím', rate2: 'Povědomé', rate3: 'S námahou', rate4: 'Hned vím', read: 'Přečteno', pick: '— vyber —', pin: 'Klepni do obrázku', yours: 'Tvoje pořadí', unsupported: 'Tento typ otázky zatím nemá hotové ovládání.', correct: 'Správně:', also: 'také', order: 'Správné pořadí:', sample: 'Ukázková odpověď:' },
  en: { submit: 'Submit', truth: 'True', lie: 'False', reset: 'Reset', flip: 'Flip', rate1: 'No idea', rate2: 'Familiar', rate3: 'With effort', rate4: 'Easy', read: 'Done', pick: '— choose —', pin: 'Tap the picture', yours: 'Your order', unsupported: 'This question type has no ready-made controls yet.', correct: 'Correct:', also: 'also', order: 'Correct order:', sample: 'Sample answer:' },
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
  // The item id goes with every answer (the authority can check which question it answers).
  const payload = (answer: unknown) => escapeHtml(JSON.stringify({ itemId: item.id, ...(options.payload ?? {}), answer }));
  /** Stable styling hooks of a choice: `data-mz-option` (its id) and `--mz-q-index` (its position). */
  const hook = (id: unknown, index: number) => ` data-mz-option="${escapeHtml(String(id))}" style="--mz-q-index:${index}"`;
  const act = (answer: unknown, enabled = true) => `data-act="${escapeHtml(action)}" data-payload="${payload(answer)}"${!enabled || locked ? ' disabled' : ''}`;
  const mzq = (event: Omit<QuestionEvent, 'q'>) => `data-mz-q="${escapeHtml(JSON.stringify({ q: item.id, ...event }))}"${locked ? ' disabled' : ''}`;
  const submit = (answer: unknown, enabled: boolean) => `<button type="button" class="mz-q-submit" ${act(answer, enabled)}>${escapeHtml(options.submitLabel ?? t.submit)}</button>`;
  const head = options.showQuestion === false ? '' : questionHead(it, qc);
  /** The player's answer once it is sent (`chosen`): shown instead of the controls' device state. */
  const given: any = locked && options.chosen !== undefined && options.chosen !== null ? options.chosen : undefined;
  const givenRecord: Record<string, string> | undefined = given && typeof given === 'object' && !Array.isArray(given) ? given : undefined;
  /** Whether the shown answer is right (with `reveal` only; `undefined` without an answer). */
  const right = (): boolean | undefined => {
    if (!reveal || given === undefined) return undefined;
    try {
      return checkOQSEAnswer(item, given);
    } catch {
      return undefined;
    }
  };
  const markOf = (ok: boolean | undefined) => (ok === undefined ? '' : ok ? ' mz-q-right' : ' mz-q-wrong');
  const fix = (html: string) => `<span class="mz-q-fix">${html}</span>`;
  /** What was right, below the controls (types whose controls cannot show it themselves). */
  const solution = (html: string) => (reveal ? `<div class="mz-q-solution"><span class="mz-q-solution-label">${t.correct}</span> ${html}</div>` : '');
  /** Feedback of a wrong answer, explanations of the chosen choices and of the item. */
  const explanation = () => {
    if (!reveal || options.explanation === false) return '';
    const parts: string[] = [];
    if (right() === false && it.incorrectFeedback) parts.push(qc.text(it.incorrectFeedback, { item }));
    const choices: { id: unknown; explanation?: string }[] = Array.isArray(it.options) ? it.options : [];
    for (const c of choices) if (c.explanation && isChosen(c.id)) parts.push(qc.text(c.explanation, { item }));
    if (it.explanation) parts.push(qc.text(it.explanation, { item }));
    return parts.length ? `<div class="mz-q-explanation">${parts.join('')}</div>` : '';
  };
  const wrap = (body: string, extra = '') => `<div class="mz-q mz-q-${escapeHtml(it.type)}${extra}" data-mz-type="${escapeHtml(it.type)}" data-mz-q-root="${escapeHtml(item.id)}">${head}${body}${explanation()}</div>`;
  const isChosen = (id: unknown) => options.chosen !== undefined && (Array.isArray(options.chosen) ? options.chosen.includes(id) : options.chosen === id);
  const count = (id: unknown) => {
    if (!options.counts || typeof options.counts !== 'object') return '';
    const n = Number(options.counts[String(id)] ?? 0);
    const value = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return `<span class="mz-q-count${value === 0 ? ' mz-q-count-0' : ''}">${value}</span>`;
  };
  const mark = (id: unknown, right: boolean) => `${isChosen(id) ? ' mz-q-chosen' : ''}${reveal ? (right ? ' mz-q-right' : isChosen(id) ? ' mz-q-wrong' : ' mz-q-dim') : ''}`;
  const textForm = (kind: 'text' | 'number' | 'textarea', attrs = '', unit = '') => {
    const id = `mz-q-${item.id}`;
    // Text typed earlier comes back when the game draws the question again (another card was shown meanwhile).
    const typed = local.typed?.answer ?? '';
    const field =
      kind === 'textarea'
        ? `<textarea id="${escapeHtml(id)}" class="mz-q-input" name="answer" rows="4"${locked ? ' disabled' : ''}>${escapeHtml(typed)}</textarea>`
        : `<input id="${escapeHtml(id)}" class="mz-q-input" name="answer" autocomplete="off" ${kind === 'number' ? 'inputmode="decimal"' : ''} ${attrs}${typed ? ` value="${escapeHtml(typed)}"` : ''}${locked ? ' disabled' : ''}>`;
    const shown = options.chosen !== undefined ? `<div class="mz-q-given${markOf(right())}">${kind === 'text' && it.type === 'math-input' ? inline(`$${String(options.chosen)}$`) : escapeHtml(String(options.chosen))}${unit ? ` ${escapeHtml(unit)}` : ''}</div>` : '';
    if (given !== undefined) return shown; // answered: the answer instead of an empty field
    return `<form class="mz-q-form" data-mz-q-form>${field}<button type="submit" class="mz-q-submit" data-act="${escapeHtml(action)}" data-payload="${payload(null)}" data-mz-answer-from="${kind === 'number' ? 'number' : 'text'}"${locked ? ' disabled' : ''}>${escapeHtml(options.submitLabel ?? t.submit)}</button></form>${shown}`;
  };

  switch (it.type) {
    case 'mcq-single':
      return wrap(`<div class="mz-q-options">${(it.options as Choice[]).map((o, i) => `<button type="button" class="mz-q-opt${mark(o.id, o.id === it.correctId)}"${hook(o.id, i)} ${act(o.id)}><span class="mz-q-key">${'ABCDEFGHIJ'[i] ?? i + 1}</span><span class="mz-q-label">${inline(o.text)}</span>${count(o.id)}</button>`).join('')}</div>`);

    case 'true-false':
      return wrap(`<div class="mz-q-options mz-q-two">${[true, false].map((v, i) => `<button type="button" class="mz-q-opt mz-q-${v ? 'yes' : 'no'}${mark(v, v === it.correctAnswer)}"${hook(v, i)} ${act(v)}><span class="mz-q-label">${v ? t.truth : t.lie}</span>${count(v)}</button>`).join('')}</div>`);

    case 'mcq-multi': {
      const picked = locked && Array.isArray(options.chosen) ? (options.chosen as string[]) : local.picked ?? [];
      const right = new Set<string>(it.correctIds ?? []);
      return wrap(
        `<div class="mz-q-options">${(it.options as Choice[]).map((o, i) => `<button type="button" class="mz-q-opt${picked.includes(o.id) ? ' mz-q-picked' : ''}${mark(o.id, right.has(o.id))}"${hook(o.id, i)} ${mzq({ op: 'toggle', id: o.id })} aria-pressed="${picked.includes(o.id)}"><span class="mz-q-key">${'ABCDEFGHIJ'[i] ?? i + 1}</span><span class="mz-q-label">${inline(o.text)}</span>${count(o.id)}</button>`).join('')}</div>` +
          submit(picked, picked.length > 0),
      );
    }

    case 'short-answer':
    case 'math-input': {
      const accepted: string[] = Array.isArray(it.correctAnswers) ? it.correctAnswers.map(String) : [];
      const show = (a: string) => (it.type === 'math-input' ? inline(`$${a}$`) : escapeHtml(a));
      const others = accepted.slice(1, 4).map(show).join(', ');
      return wrap(textForm('text') + (accepted.length ? solution(`<b>${show(accepted[0])}</b>${others ? ` <span class="mz-q-also">(${t.also} ${others})</span>` : ''}`) : ''));
    }
    case 'numeric-input':
      return wrap(
        textForm('number', '', it.unit ?? '') + (it.unit && given === undefined ? `<span class="mz-q-unit">${escapeHtml(it.unit)}</span>` : '') +
          solution(`<b>${number(it.correctAnswer)}${it.tolerance ? ` ± ${number(it.tolerance)}` : ''}${it.unit ? ` ${escapeHtml(it.unit)}` : ''}</b>`),
      );
    case 'open-ended':
      return wrap(textForm('textarea') + (reveal && it.sampleAnswer ? `<div class="mz-q-solution"><span class="mz-q-solution-label">${t.sample}</span> ${qc.text(it.sampleAnswer, { item })}</div>` : ''));
    case 'slider': {
      const value = given !== undefined ? String(given) : (local.sel?.value ?? String(it.min));
      return wrap(
        `<div class="mz-q-slider"><input type="range" class="mz-q-range" min="${it.min}" max="${it.max}" step="${it.step}" value="${escapeHtml(value)}" ${mzq({ op: 'select', key: 'value' })}><output class="mz-q-value${markOf(right())}">${escapeHtml(value)}${it.unit ? ` ${escapeHtml(it.unit)}` : ''}</output></div>` +
          (given === undefined ? submit(Number(value), true) : '') +
          solution(`<b>${number(it.correctAnswer)}${it.tolerance ? ` ± ${number(it.tolerance)}` : ''}${it.unit ? ` ${escapeHtml(it.unit)}` : ''}</b>`),
      );
    }

    case 'sort-items':
    case 'timeline': {
      const list: Choice[] = it.type === 'timeline' ? (it.events as Choice[]) : (it.items as Choice[]);
      const picked = (locked && Array.isArray(options.chosen) ? (options.chosen as string[]) : local.picked ?? []).filter((id) => list.some((c) => c.id === id));
      const rest = list.filter((c) => !picked.includes(c.id));
      const byId = new Map(list.map((c) => [c.id, c]));
      const at = (id: string) => list.findIndex((c) => c.id === id);
      // The right order: sort-items has it; timeline events are ordered by their dates.
      const correct: string[] | null = !reveal ? null : it.type === 'timeline' ? timelineOrder(it.events) : Array.isArray(it.correctOrder) ? it.correctOrder : null;
      const placedOk = (id: string, i: number) => {
        if (!correct) return undefined;
        if (it.type !== 'timeline') return correct[i] === id;
        const e = byId.get(id) as any;
        const want = byId.get(correct[i]) as any;
        try {
          return !!e && !!want && compareTimelineEvents(e, want) === 0; // simultaneous events in any order
        } catch {
          return correct[i] === id;
        }
      };
      const dated = (c: any) => `${inline(c.text)}${it.type === 'timeline' && c.date ? ` <span class="mz-q-date">${escapeHtml(formatEventDate(c.date, c.precision, qc.locale))}</span>` : ''}`;
      return wrap(
        `<ol class="mz-q-order">${picked.map((id, i) => `<li><button type="button" class="mz-q-opt mz-q-placed${markOf(placedOk(id, i))}"${hook(id, at(id))} ${mzq({ op: 'remove', id })}><span class="mz-q-label">${inline(byId.get(id)!.text)}</span></button></li>`).join('')}</ol>` +
          (given === undefined
            ? `<div class="mz-q-options">${rest.map((c) => `<button type="button" class="mz-q-opt"${hook(c.id, at(c.id))} ${mzq({ op: 'push', id: c.id })}><span class="mz-q-label">${inline(c.text)}</span></button>`).join('')}</div>` +
              `<div class="mz-q-row">${picked.length ? `<button type="button" class="mz-q-reset" ${mzq({ op: 'reset' })}>${t.reset}</button>` : ''}${submit(picked, rest.length === 0)}</div>`
            : '') +
          (correct && right() !== true ? `<div class="mz-q-solution"><span class="mz-q-solution-label">${t.order}</span><ol class="mz-q-right-order">${correct.map((id) => (byId.has(id) ? `<li>${dated(byId.get(id))}</li>` : '')).join('')}</ol></div>` : ''),
      );
    }

    case 'match-pairs':
      return wrap(selects(it.prompts as Choice[], it.matches as Choice[], (row) => it.pairs?.[row]));
    case 'categorize':
      return wrap(selects(it.items as Choice[], it.categories as Choice[], (row) => (it.items as any[]).find((e) => e.id === row)?.correctCategoryId));
    case 'diagram-label': {
      const zones = (it.zones as { id: string; label?: string }[]).map((z, i) => ({ id: z.id, text: z.label ?? `${i + 1}.` }));
      const picture = it.targetAsset && qc.assetUrl?.(it.targetAsset);
      const img = picture ? `<div class="mz-q-picture"><img src="${escapeHtml(picture)}" alt=""></div>` : '';
      return wrap(img + selects(zones, it.labels as Choice[], (row) => (it.zones as any[]).find((z) => z.id === row)?.correctLabelId));
    }

    case 'fill-in-select': {
      const sel = givenRecord ?? local.sel ?? {};
      const tokens = Object.keys(it.blanks ?? {});
      const body = inline(it.text).replace(/<span class="mz-blank" data-mz-blank="([^"]*)"><\/span>/g, (_m, token: string) => {
        const blank = it.blanks?.[token];
        if (!blank) return '';
        const ok = reveal && givenRecord ? sel[token] === blank.correctId : undefined;
        const want = (blank.options as Choice[]).find((o) => o.id === blank.correctId);
        return `<select class="mz-q-select${markOf(ok)}" ${mzq({ op: 'select', key: token })}><option value="">${t.pick}</option>${(blank.options as Choice[]).map((o) => `<option value="${escapeHtml(o.id)}"${sel[token] === o.id ? ' selected' : ''}>${escapeHtml(stripMarkdown(o.text))}</option>`).join('')}</select>${ok === false && want ? fix(inline(want.text)) : ''}`;
      });
      return wrap(`<div class="mz-q-text">${body}</div>` + (given === undefined ? submit(sel, tokens.every((k) => sel[k])) : ''));
    }

    case 'fill-in-blanks': {
      const body = inline(it.text).replace(/<span class="mz-blank" data-mz-blank="([^"]*)"><\/span>/g, (_m, token: string) => {
        const value = givenRecord ? String(givenRecord[token] ?? '') : local.typed?.[token];
        const accepted: string[] = Array.isArray(it.blanks?.[token]) ? it.blanks[token].map(String) : [];
        const ok = reveal && givenRecord ? accepted.some((a) => textAnswerMatches(value ?? '', a, it)) : undefined;
        return `<input class="mz-q-input mz-q-blank${markOf(ok)}" id="mz-q-${escapeHtml(item.id)}-${token}" data-mz-q-blank="${token}" autocomplete="off"${value ? ` value="${escapeHtml(value)}"` : ''}${locked ? ' disabled' : ''}>${ok === false && accepted.length ? fix(escapeHtml(accepted[0])) : ''}`;
      });
      if (given !== undefined) return wrap(`<div class="mz-q-text">${body}</div>`);
      return wrap(`<form class="mz-q-form" data-mz-q-form><div class="mz-q-text">${body}</div><button type="submit" class="mz-q-submit" data-act="${escapeHtml(action)}" data-payload="${payload(null)}" data-mz-answer-from="blanks"${locked ? ' disabled' : ''}>${escapeHtml(options.submitLabel ?? t.submit)}</button></form>`);
    }

    case 'matrix':
    case 'match-complex': {
      const rows: Choice[] = it.type === 'matrix' ? it.rows : it.prompts;
      const cols: Choice[] = it.type === 'matrix' ? it.columns : it.matches;
      const key = (r: string, c: string) => `${r}\u0001${c}`;
      const picked = Array.isArray(given) ? (given as unknown[]).filter((p): p is [string, string] => Array.isArray(p) && p.length === 2).map(([r, c]) => key(String(r), String(c))) : local.picked ?? [];
      const answer = picked.map((k) => k.split('\u0001'));
      const correctCells = new Set<string>(reveal ? ((it.type === 'matrix' ? it.correctCells : it.connections) ?? []).map(([r, c]: [string, string]) => key(r, c)) : []);
      const cellMark = (k: string) => (!reveal || given === undefined ? '' : correctCells.has(k) ? (picked.includes(k) ? ' mz-q-right' : ' mz-q-missed') : picked.includes(k) ? ' mz-q-wrong' : '');
      return wrap(
        `<table class="mz-q-grid"><thead><tr><th></th>${cols.map((c) => `<th>${inline(c.text)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr><th>${inline(r.text)}</th>${cols.map((c) => `<td><button type="button" class="mz-q-cell${picked.includes(key(r.id, c.id)) ? ' mz-q-picked' : ''}${cellMark(key(r.id, c.id))}" aria-pressed="${picked.includes(key(r.id, c.id))}" ${mzq({ op: 'toggle', id: key(r.id, c.id) })}></button></td>`).join('')}</tr>`)
          .join('')}</tbody></table>` + (given === undefined ? submit(answer, picked.length > 0) : ''),
      );
    }

    case 'flashcard': {
      const back = !it.answerHidden && local.flipped ? `<div class="mz-q-back">${qc.text(it.back, { item })}</div>` : '';
      const flip = it.answerHidden || local.flipped ? '' : `<button type="button" class="mz-q-reset" ${mzq({ op: 'flip' })}>${t.flip}</button>`;
      const rate = local.flipped || it.answerHidden ? `<div class="mz-q-options mz-q-four">${([1, 2, 3, 4] as const).map((r, i) => `<button type="button" class="mz-q-opt${isChosen(r) ? ' mz-q-chosen' : ''}"${hook(r, i)} ${act(r)}><span class="mz-q-label">${t[`rate${r}`]}</span></button>`).join('')}</div>` : '';
      return `<div class="mz-q mz-q-flashcard" data-mz-type="flashcard" data-mz-q-root="${escapeHtml(item.id)}"><div class="mz-q-front">${qc.text(it.front, { item })}</div>${back}${flip}${rate}</div>`;
    }

    case 'note':
      return `<div class="mz-q mz-q-note" data-mz-type="note" data-mz-q-root="${escapeHtml(item.id)}">${qc.text(it.content, { item })}<button type="button" class="mz-q-submit" ${act('read')}>${t.read}</button></div>`;

    case 'pin-on-image': {
      const url = it.targetAsset && qc.assetUrl?.(it.targetAsset);
      const toPoint = (p: any) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null);
      const points = given !== undefined ? (Array.isArray(given) ? given : [given]).map(toPoint).filter((p): p is { x: number; y: number } => !!p) : local.points ?? [];
      const many = it.multipleCorrect === true;
      const pins = points.map((p) => `<span class="mz-q-pin${markOf(right())}" style="left:${p.x}%;top:${p.y}%"></span>`).join('');
      const answer = many ? points : points[0] ?? null;
      return wrap(
        `<div class="mz-q-picture mz-q-pinboard" ${mzq({ op: 'pin', key: many ? 'many' : 'one' })}>${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(t.pin)}">` : `<div class="mz-q-noimage">${t.pin}</div>`}${reveal ? hotspots(it.hotspots) : ''}${pins}</div>` +
          (given === undefined ? `<div class="mz-q-row">${points.length ? `<button type="button" class="mz-q-reset" ${mzq({ op: 'reset' })}>${t.reset}</button>` : ''}${submit(answer, points.length > 0)}</div>` : ''),
      );
    }

    default:
      return wrap(`<div class="mz-q-unsupported">${t.unsupported}</div>`);
  }

  /**
   * One select per row (prompt / entry / zone), choosing from `targets`; the answer is
   * `{ rowId: targetId }`. With `reveal`, each row is marked and a wrong one shows the right target.
   */
  function selects(rows: Choice[], targets: Choice[], correctOf: (rowId: string) => string | undefined): string {
    const sel = givenRecord ?? local.sel ?? {};
    const body = rows
      .map((row) => {
        const want = reveal && givenRecord ? correctOf(row.id) : undefined;
        const ok = want === undefined ? undefined : sel[row.id] === want;
        const target = want === undefined ? undefined : targets.find((o) => o.id === want);
        return `<div class="mz-q-pair${markOf(ok)}"><div class="mz-q-label">${inline(row.text)}</div><select class="mz-q-select" ${mzq({ op: 'select', key: row.id })}><option value="">${t.pick}</option>${targets.map((o) => `<option value="${escapeHtml(o.id)}"${sel[row.id] === o.id ? ' selected' : ''}>${escapeHtml(stripMarkdown(o.text))}</option>`).join('')}</select>${ok === false && target ? fix(inline(target.text)) : ''}</div>`;
      })
      .join('');
    return `<div class="mz-q-pairs">${body}</div>` + (given === undefined ? submit(sel, rows.every((r) => sel[r.id])) : '');
  }

  function number(value: unknown): string {
    const n = Number(value);
    return Number.isFinite(n) ? escapeHtml(n.toLocaleString(qc.locale, { maximumFractionDigits: 10 })) : escapeHtml(String(value ?? ''));
  }
}

/** The events of a timeline in their right order (by date; simultaneous ones keep the set's order). */
function timelineOrder(events: unknown): string[] | null {
  if (!Array.isArray(events)) return null;
  try {
    return [...events].sort((a, b) => compareTimelineEvents(a, b)).map((e) => String(e.id));
  } catch {
    return null;
  }
}

/** A timeline date for people: the year, the month or the day as the event's precision says. */
function formatEventDate(date: string, precision: string | undefined, locale: string): string {
  const m = /^(-?\d{1,})-(\d{2})-(\d{2})/.exec(String(date));
  if (!m) return String(date);
  const year = Number(m[1]);
  const bc = year < 0;
  const y = bc ? `${-year}${locale.startsWith('cs') ? ' př. n. l.' : ' BC'}` : String(year);
  if (precision === 'year') return y;
  if (precision === 'month') return `${Number(m[2])}/${y}`;
  return locale.startsWith('cs') ? `${Number(m[3])}. ${Number(m[2])}. ${y}` : `${y}-${m[2]}-${m[3]}`;
}

/** The right areas of a pin-on-image item, drawn over the picture (percent coordinates). */
function hotspots(list: unknown): string {
  if (!Array.isArray(list)) return '';
  const shapes = list.map((h: any) => {
    if (h?.type === 'rect') return `<span class="mz-q-hotspot" style="left:${Number(h.x)}%;top:${Number(h.y)}%;width:${Number(h.width)}%;height:${Number(h.height)}%"></span>`;
    if (h?.type === 'circle') return `<span class="mz-q-hotspot mz-q-hotspot-circle" style="left:${Number(h.x) - Number(h.radius)}%;top:${Number(h.y) - Number(h.radius)}%;width:${2 * Number(h.radius)}%;height:${2 * Number(h.radius)}%"></span>`;
    if (h?.type === 'polygon' && Array.isArray(h.points)) {
      const pts = h.points.map((p: any) => `${Number(p.x)},${Number(p.y)}`).join(' ');
      return `<svg class="mz-q-hotspot-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="${escapeHtml(pts)}"/></svg>`;
    }
    return '';
  });
  return shapes.join('');
}

function questionHead(it: any, qc: QuestionContext): string {
  const text = it.question ?? (it.type === 'fill-in-blanks' || it.type === 'fill-in-select' ? undefined : it.text);
  return text ? `<div class="mz-q-question">${qc.text(text, { item: it })}</div>` : '';
}

/** Plain text for `<option>` (no HTML there): drops simple Markdown marks. */
function stripMarkdown(text: string): string {
  return String(text ?? '').replace(/[*_`$]/g, '');
}

/** Applies a `[data-mz-q]` event to the device-local state of a question. */
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
    case 'type':
      if (event.key !== undefined) local.typed = { ...(local.typed ?? {}), [event.key]: String(event.value ?? '').slice(0, 10_000) };
      return;
    case 'pin':
      if (typeof event.x === 'number' && typeof event.y === 'number') {
        const point = { x: Math.round(event.x * 10) / 10, y: Math.round(event.y * 10) / 10 };
        local.points = event.key === 'many' ? [...(local.points ?? []), point] : [point];
      }
      return;
  }
}
