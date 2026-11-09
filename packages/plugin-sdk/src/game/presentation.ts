/**
 * Presentations (SDK 1.1): a page of `<section data-slide="id">` slides that the teacher shows
 * on the projector, with polls and interactive parts on the pupils' phones. Built on
 * `defineGame` (no protocol of its own): the teacher's device holds the current slide and the
 * votes; phones show only what belongs to the current slide (a poll, the author's own phone
 * part) or "Watch the board"; alone (solo, or the file opened anywhere) the page is a
 * self-paced presentation that ends the course step on its last slide.
 *
 * The slides stay the page's own HTML (without the SDK they are just a page); the SDK only
 * shows one of them at a time and draws its controls and phone parts into a layer of its own.
 */

import { startGame, type GameHandle, type StartOptions } from './defineGame';
import { checkAnswer } from '../checkAnswer';
import { escapeHtml } from '../text/richText';
import type { GameContext, GameDefinition, GameUI, RenderResult } from '../types';

/** A poll: an item of the set (recorded like an answer; its answer revealed by the teacher) or an opinion poll. */
export type PresentationPoll = { item: string } | { question: string; options: string[]; multiple?: boolean };

export interface PresentationOptions {
  /** The element with the slides (default `document.body`). */
  root?: HTMLElement;
  /** Which elements are slides (default `section[data-slide]`; the slide's ID is `data-slide`). */
  slides?: string;
  /**
   * `'teacher'` (default): the teacher moves the slides, the phones show only the interactive
   * parts. `'free'`: every pupil goes through the slides on their phone at their own pace.
   */
  navigation?: 'teacher' | 'free';
  /** Dots to jump between slides (default true) and ‹ › arrows (default true). */
  dots?: boolean;
  arrows?: boolean;
  /** The polls by ID; put `<div data-poll="id"></div>` into a slide where its results show. */
  polls?: Record<string, PresentationPoll>;
  /** The author's own phone part of a slide (by slide ID): sliders, buttons… (`ui.html`). */
  phone?: Record<string, (ui: GameUI) => RenderResult>;
  /** Called on every device when a slide is shown (start an animation, a simulation…). */
  onSlide?: (slideId: string, element: HTMLElement, ui: GameUI) => void;
  /**
   * Called on every device after every change (votes, the pupils' controls in `state.data`):
   * e.g. the board's simulation follows what the phones set.
   */
  onUpdate?: (slideId: string, element: HTMLElement, state: PresentationState, ui: GameUI) => void;
  /** A pupil's action from the author's phone part (`data-act` other than the SDK's own). */
  actions?: GameDefinition<PresentationState>['actions'];
}

export interface PresentationState {
  /** The current slide (teacher mode; the start in free mode). */
  slide: number;
  /** Votes: poll ID → player ID → answer. */
  votes: Record<string, Record<string, unknown>>;
  /** Item polls whose answer the teacher revealed. */
  shown: Record<string, true>;
  /** The author's own data (actions of the phone parts). */
  data: Record<string, unknown>;
}

const T = {
  cs: { watch: 'Sleduj tabuli 👀', slide: 'Snímek', done: 'Hotovo ✓', reveal: 'Ukázat odpověď', votes: (n: number) => `${n} ${n === 1 ? 'hlas' : n < 5 ? 'hlasy' : 'hlasů'}`, sent: 'Odesláno ✓', prev: 'Předchozí', next: 'Další' },
  en: { watch: 'Watch the board 👀', slide: 'Slide', done: 'Done ✓', reveal: 'Show the answer', votes: (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`, sent: 'Sent ✓', prev: 'Previous', next: 'Next' },
};
const texts = (ui: GameUI) => (String(ui.locale).toLowerCase().startsWith('cs') ? T.cs : T.en);

const STYLE = `
[data-slide][hidden],.mz-pres-hide{display:none!important}
.mz-pres{position:fixed;left:0;right:0;bottom:0;z-index:50;pointer-events:none;font:15px/1.4 system-ui,sans-serif}
.mz-pres>*{pointer-events:auto}
.mz-pres-bar{display:flex;align-items:center;justify-content:center;gap:10px;padding:8px}
.mz-pres-dots{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.mz-pres-dot{width:12px;height:12px;border-radius:50%;border:0;padding:0;background:rgba(120,130,150,.45);cursor:pointer}
.mz-pres-dot.on{background:#ff7a00}
.mz-pres-arrow{border:0;border-radius:999px;padding:6px 14px;background:rgba(29,43,83,.8);color:#fff;font-size:18px;cursor:pointer}
.mz-pres-panel{margin:0 auto 8px;max-width:640px;padding:12px;border-radius:14px;background:#fff;color:#1d2b53;box-shadow:0 6px 24px rgba(0,0,0,.2)}
.mz-pres-phone{position:fixed;inset:0;overflow:auto;padding:16px;background:#f7f8fb;color:#1d2b53}
.mz-pres-phone h2{margin:0 0 4px;font-size:14px;font-weight:600;color:#5a6478}
.mz-pres-watch{display:grid;place-items:center;min-height:60vh;font-size:22px;font-weight:700;text-align:center}
.mz-pres-opt{display:block;width:100%;margin:6px 0;padding:12px;border:2px solid #c9d1e3;border-radius:12px;background:#fff;font:inherit;font-weight:600;text-align:left;cursor:pointer}
.mz-pres-opt.on{border-color:#ff7a00;background:#fff3e6}
.mz-pres-res{display:grid;gap:6px;width:min(560px,86vw);margin:0 auto;font:600 16px system-ui,sans-serif;text-align:left}
.mz-pres-row{display:grid;grid-template-columns:minmax(0,1fr) 3em;gap:8px;align-items:center}
.mz-pres-barbg{position:relative;height:28px;border-radius:8px;background:rgba(120,130,150,.18);overflow:hidden}
.mz-pres-barfill{position:absolute;inset:0 auto 0 0;background:#ff7a00;opacity:.85}
.mz-pres-barlabel{position:relative;padding:4px 8px}
.mz-pres-ok .mz-pres-barfill{background:#2e9d5b}
.mz-pres-btn{border:0;border-radius:10px;padding:8px 14px;background:#1d2b53;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}
`;

/** The slides of the page and the polls in each. */
function readSlides(container: HTMLElement, selector: string) {
  const els = [...container.querySelectorAll<HTMLElement>(selector)];
  return els.map((el, i) => ({ el, id: el.dataset.slide || `slide-${i + 1}`, polls: [...el.querySelectorAll<HTMLElement>('[data-poll]')].map((p) => p.dataset.poll!) }));
}

/** Defines and starts a presentation (call it once, after the slides are in the page). */
export function definePresentation(options: PresentationOptions = {}): GameHandle {
  return startPresentation(options);
}

export function startPresentation(options: PresentationOptions = {}, start: StartOptions = {}): GameHandle {
  const doc = start.document ?? document;
  const container = options.root ?? doc.body;
  const slides = readSlides(container, options.slides ?? 'section[data-slide]');
  const polls = options.polls ?? {};
  const free = options.navigation === 'free';
  for (const s of slides) for (const p of s.polls) if (!polls[p]) console.warn(`[memizy] data-poll="${p}" on slide "${s.id}" has no poll in definePresentation({ polls }).`);
  if (!doc.getElementById('mz-pres-style')) {
    const style = doc.createElement('style');
    style.id = 'mz-pres-style';
    style.textContent = STYLE;
    doc.head.appendChild(style);
  }
  const layer = doc.createElement('div');
  layer.className = 'mz-pres';
  doc.body.appendChild(layer);
  let shownSlide = -1;

  const clamp = (n: unknown) => Math.max(0, Math.min(slides.length - 1, Math.floor(Number(n) || 0)));
  /** The slide this device shows: the teacher's, or the pupil's own (free mode, solo). */
  const slideOf = (state: PresentationState, ui: GameUI) => (ui.view === 'solo' || (free && ui.view === 'controller') ? clamp(ui.local.slide ?? state.slide) : state.slide);
  const pollItem = (id: string) => ('item' in (polls[id] ?? {}) ? (polls[id] as { item: string }).item : null);

  /** A poll as buttons (an opinion poll) or the item's question (an item of the set). */
  function pollControls(state: PresentationState, ui: GameUI, id: string): RenderResult {
    const poll = polls[id];
    if (!poll) return '';
    const mine = ui.self ? state.votes[id]?.[ui.self.id] : undefined;
    const itemId = pollItem(id);
    if (itemId) {
      const item = ui.item(itemId);
      return item ? ui.question(item, { action: 'mzPresVote', payload: { poll: id }, chosen: mine as never, reveal: !!state.shown[id], disabled: mine !== undefined, star: true }) : '';
    }
    const opinion = poll as { question: string; options: string[]; multiple?: boolean };
    const chosen = new Set(Array.isArray(mine) ? mine : mine === undefined ? [] : [mine]);
    return ui.html`<div class="mz-pres-poll"><p><b>${opinion.question}</b></p>${opinion.options.map((text, i) => ui.html`<button type="button" class=${`mz-pres-opt ${chosen.has(i) ? 'on' : ''}`} data-act="mzPresVote" data-payload=${{ poll: id, answer: i }}>${text}</button>`)}${mine !== undefined ? ui.html`<p>${texts(ui).sent}</p>` : ''}</div>`;
  }

  /** Live results of a poll (bars), written into its data-poll element on the board. */
  function resultsHtml(state: PresentationState, ui: GameUI, id: string): string {
    const poll = polls[id];
    if (!poll) return '';
    const votes = Object.values(state.votes[id] ?? {});
    const itemId = pollItem(id);
    let rows: { label: string; n: number; ok?: boolean }[] = [];
    if (itemId) {
      const item = ui.item(itemId) as { type?: string; options?: { id: string; text: string }[]; correctId?: string; correctIds?: string[] } | undefined;
      if (item?.options) {
        const correct = new Set([item.correctId, ...(item.correctIds ?? [])].filter(Boolean));
        rows = item.options.map((o) => ({ label: o.text, n: votes.filter((v) => (Array.isArray(v) ? v.includes(o.id) : v === o.id)).length, ok: state.shown[id] && correct.has(o.id) }));
      }
    } else {
      const opinion = poll as { options: string[] };
      rows = opinion.options.map((label, i) => ({ label, n: votes.filter((v) => (Array.isArray(v) ? v.includes(i) : v === i)).length }));
    }
    const max = Math.max(1, ...rows.map((r) => r.n));
    const t = texts(ui);
    return `<div class="mz-pres-res">${rows.map((r) => `<div class="mz-pres-row ${r.ok ? 'mz-pres-ok' : ''}"><div class="mz-pres-barbg"><div class="mz-pres-barfill" style="width:${Math.round((100 * r.n) / max)}%"></div><div class="mz-pres-barlabel">${escapeHtml(r.label)}${r.ok ? ' ✓' : ''}</div></div><b>${r.n}</b></div>`).join('')}<small>${escapeHtml(t.votes(votes.length))}</small>${itemId && !state.shown[id] && ui.view === 'board' ? `<button type="button" class="mz-pres-btn" data-mz-reveal="${escapeHtml(id)}">${escapeHtml(t.reveal)}</button>` : ''}</div>`;
  }

  const def: GameDefinition<PresentationState> = {
    root: layer,
    initialState: () => ({ slide: 0, votes: {}, shown: {}, data: {} }),
    actions: {
      ...(options.actions ?? {}),
      'mzPresGo'(state, payload, ctx: GameContext) {
        if (ctx.mode !== 'solo' && !ctx.fromHost) return; // the teacher moves the class
        state.slide = clamp(payload?.slide);
      },
      'mzPresVote'(state, payload, ctx: GameContext) {
        const id = payload?.poll;
        const poll = typeof id === 'string' ? polls[id] : undefined;
        if (!poll || !ctx.playerId) return;
        const votes = (state.votes[id] ??= {});
        const itemId = pollItem(id);
        if (itemId) {
          if (ctx.playerId in votes || payload.answer === undefined) return; // an answer counts once
          const item = ctx.item(itemId);
          if (!item) return;
          let correct = false;
          try {
            correct = checkAnswer(item, payload.answer);
          } catch {
            return;
          }
          votes[ctx.playerId] = payload.answer;
          ctx.recordAnswer(item.id, correct, { answer: payload.answer });
          return;
        }
        const opinion = poll as { options: string[]; multiple?: boolean };
        const i = Number(payload?.answer);
        if (!Number.isInteger(i) || i < 0 || i >= opinion.options.length) return;
        if (opinion.multiple) {
          const had = Array.isArray(votes[ctx.playerId]) ? (votes[ctx.playerId] as number[]) : [];
          votes[ctx.playerId] = had.includes(i) ? had.filter((x) => x !== i) : [...had, i].sort();
        } else votes[ctx.playerId] = i; // an opinion may change
      },
      'mzPresReveal'(state, payload, ctx: GameContext) {
        const itemId = typeof payload?.poll === 'string' ? pollItem(payload.poll) : null;
        if (!itemId || (ctx.mode !== 'solo' && !ctx.fromHost)) return;
        state.shown[payload.poll] = true;
        ctx.reveal(itemId);
      },
      'mzPresDone'(state, _payload, ctx: GameContext) {
        if (ctx.mode !== 'solo' && !ctx.fromHost) return;
        const scores: Record<string, number> = {};
        for (const p of ctx.players) scores[p.id] = Object.values(state.votes).filter((v) => p.id in v).length;
        ctx.end({ scores, summary: 'done' });
      },
    },
    onFinish(state, ctx) {
      const scores: Record<string, number> = {};
      for (const p of ctx.players) scores[p.id] = Object.values(state.votes).filter((v) => p.id in v).length;
      ctx.end({ scores, summary: 'ended' });
    },
    localActions: {
      'pres-to'(local, slide) {
        local.slide = clamp(slide);
      },
    },
    render(state, ui) {
      const t = texts(ui);
      const at = slideOf(state, ui);
      const slide = slides[at];
      const ownPace = ui.view === 'solo' || (free && ui.view === 'controller');
      // Phones in teacher mode: only what belongs to the current slide.
      if (ui.view === 'controller' && !free) {
        const own = slide && options.phone?.[slide.id];
        const parts = slide ? [own ? own(ui) : '', ...slide.polls.map((p) => pollControls(state, ui, p))].filter((x) => x && String(x)) : [];
        return ui.html`<div class="mz-pres-phone"><h2>${t.slide} ${at + 1} / ${slides.length}</h2>${parts.length ? parts : ui.html`<div class="mz-pres-watch">${t.watch}</div>`}</div>`;
      }
      const go = (n: number) => (ownPace ? { local: 'pres-to', payload: n } : { act: 'mzPresGo', payload: { slide: n } });
      const btn = (n: number, label: string, cls: string, title?: string) => {
        const g = go(n);
        return 'local' in g
          ? ui.html`<button type="button" class=${cls} title=${title ?? ''} data-local="pres-to" data-payload=${n}>${label}</button>`
          : ui.html`<button type="button" class=${cls} title=${title ?? ''} data-act="mzPresGo" data-payload=${{ slide: n }}>${label}</button>`;
      };
      const canMove = ownPace || ui.view === 'board' || ui.self?.isHost === true;
      const polled = ownPace && slide ? slide.polls.map((p) => pollControls(state, ui, p)).filter((x) => x && String(x)) : [];
      const last = at === slides.length - 1;
      return ui.html`${polled.length ? ui.html`<div class="mz-pres-panel">${polled}</div>` : ''}
        ${canMove ? ui.html`<div class="mz-pres-bar">
          ${options.arrows !== false ? btn(Math.max(0, at - 1), '‹', 'mz-pres-arrow', t.prev) : ''}
          ${options.dots !== false ? ui.html`<div class="mz-pres-dots">${slides.map((s, i) => btn(i, '', `mz-pres-dot ${i === at ? 'on' : ''}`, s.id))}</div>` : ''}
          ${last && ui.view === 'solo' ? ui.html`<button type="button" class="mz-pres-btn" data-act="mzPresDone">${t.done}</button>` : options.arrows !== false ? btn(Math.min(slides.length - 1, at + 1), '›', 'mz-pres-arrow', t.next) : ''}
        </div>` : ''}`;
    },
    afterRender(state, ui) {
      const at = slideOf(state, ui);
      const phoneOnly = ui.view === 'controller' && !free;
      slides.forEach((s, i) => {
        s.el.hidden = phoneOnly || i !== at;
      });
      // Live results into the slide's data-poll elements (the board, and own-pace devices after voting).
      for (const s of slides) {
        for (const el of s.el.querySelectorAll<HTMLElement>('[data-poll]')) {
          const id = el.dataset.poll!;
          const ownPace = ui.view === 'solo' || (free && ui.view === 'controller');
          el.innerHTML = ui.view === 'board' || ui.view === 'solo' || (ownPace && ui.self && state.votes[id]?.[ui.self.id] !== undefined) ? resultsHtml(state, ui, id) : '';
          el.querySelector<HTMLButtonElement>('[data-mz-reveal]')?.addEventListener('click', () => ui.act('mzPresReveal', { poll: id }));
        }
      }
      if (at !== shownSlide && slides[at]) {
        shownSlide = at;
        try {
          options.onSlide?.(slides[at].id, slides[at].el, ui);
        } catch (error) {
          console.error('[memizy] onSlide failed:', error);
        }
      }
      if (slides[at]) {
        try {
          options.onUpdate?.(slides[at].id, slides[at].el, state, ui);
        } catch (error) {
          console.error('[memizy] onUpdate failed:', error);
        }
      }
      (layer as HTMLElement & { mzUi?: GameUI }).mzUi = ui; // for the keyboard
    },
  };

  // The keyboard: the board (the teacher), solo and own-pace phones.
  const onKey = (e: KeyboardEvent) => {
    const ui = (layer as HTMLElement & { mzUi?: GameUI }).mzUi;
    if (!ui || (e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable]')) return;
    const dir = ['ArrowRight', 'PageDown', ' '].includes(e.key) ? 1 : ['ArrowLeft', 'PageUp'].includes(e.key) ? -1 : 0;
    if (!dir) return;
    const ownPace = ui.view === 'solo' || (free && ui.view === 'controller');
    if (ownPace) {
      ui.setLocal((local) => {
        local.slide = clamp((local.slide ?? 0) + dir);
      });
    } else if (ui.view === 'board' || ui.self?.isHost) {
      ui.act('mzPresGo', { slide: clamp(shownSlide + dir) });
    } else return;
    e.preventDefault();
  };
  doc.addEventListener('keydown', onKey);
  const handle = startGame(def, start);
  const destroy = handle.destroy;
  handle.destroy = () => {
    doc.removeEventListener('keydown', onKey);
    destroy();
    layer.remove();
  };
  return handle;
}
