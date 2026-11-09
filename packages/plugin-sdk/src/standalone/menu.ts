/**
 * The menu of a game opened outside Memizy: which set it plays (the sample, a file, a link),
 * the game's settings and the progress. Plain DOM next to the game (never inside its root).
 */

import { localize, type SettingDefinition } from '@memizy/protocol';
import { escapeHtml } from '../text/richText';

/** `tab` (the default): a tiny handle at the top centre, like the app's menu tab on phones. */
export type MenuPosition = 'tab' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface MenuState {
  locale: string;
  title: string;
  count: number;
  sample: boolean;
  /** A problem to show at once (e.g. `?set=` could not be loaded). */
  error: string | null;
  settings: SettingDefinition[];
  values: Record<string, unknown>;
}

export interface MenuActions {
  /** Resolves an error text, or `null` when the set was taken (the game starts again). */
  chooseFile(text: string, name: string): Promise<string | null>;
  chooseUrl(url: string): Promise<string | null>;
  chooseSample(): void;
  applySettings(values: Record<string, unknown>): void;
  resetProgress(): void;
}

const TEXTS = {
  cs: {
    button: 'Sada',
    heading: 'Hra mimo Memizy',
    playing: (title: string, count: number) => `Hraješ sadu „${title}“ (${count} ${count === 1 ? 'otázka' : count < 5 ? 'otázky' : 'otázek'}).`,
    sample: 'To je ukázková sada. Nahraj svou: soubor OQSE (.json) nebo poznámky v OQSE Markdownu (.md).',
    file: 'Vybrat soubor se sadou…',
    url: 'nebo odkaz na sadu (https://…)',
    load: 'Načíst',
    backToSample: 'Zpět na ukázkovou sadu',
    settings: 'Nastavení hry',
    apply: 'Použít a začít znovu',
    reset: 'Smazat pokrok v této sadě',
    resetConfirm: 'Opravdu? Klepni znovu – pokrok v této sadě se smaže.',
    close: 'Zavřít',
    loading: 'Načítám…',
    error: 'Sadu se nepodařilo načíst',
    memizy: 'Se třídou, s pokrokem a s AI hraj v Memizy',
  },
  en: {
    button: 'Set',
    heading: 'Playing outside Memizy',
    playing: (title: string, count: number) => `You are playing “${title}” (${count} ${count === 1 ? 'question' : 'questions'}).`,
    sample: 'This is the sample set. Load your own: an OQSE file (.json) or notes in OQSE Markdown (.md).',
    file: 'Choose a set file…',
    url: 'or a link to a set (https://…)',
    load: 'Load',
    backToSample: 'Back to the sample set',
    settings: 'Game settings',
    apply: 'Apply and start again',
    reset: 'Delete the progress in this set',
    resetConfirm: 'Sure? Tap again to delete the progress in this set.',
    close: 'Close',
    loading: 'Loading…',
    error: 'The set could not be loaded',
    memizy: 'Play with a class, your progress and AI in Memizy',
  },
};

const texts = (locale: string) => (locale.toLowerCase().startsWith('cs') ? TEXTS.cs : TEXTS.en);

/** The small button that opens the menu (replaced when the game starts again). */
export function showMenuButton(title: string, position: MenuPosition, open: () => void): void {
  document.querySelector('.mz-standalone-button')?.remove();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = position === 'tab' ? 'mz-standalone-button mz-standalone-tab' : `mz-standalone-button mz-standalone-${position}`;
  // the tab: a chevron (Heroicons chevron-down, MIT), the set's title in its label
  if (position === 'tab') button.innerHTML = '<svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/></svg>';
  else button.textContent = `☰ ${title}`;
  button.title = title;
  button.setAttribute('aria-label', `☰ ${title}`);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    open();
  });
  document.body.appendChild(button);
}

function settingField(def: SettingDefinition, value: unknown, locale: string): string {
  const label = escapeHtml(localize(def.label, locale));
  const name = `mz-s-${escapeHtml(def.id)}`;
  switch (def.type) {
    case 'number':
      return `<label>${label} <input type="number" name="${name}" value="${escapeHtml(value)}"${def.min !== undefined ? ` min="${def.min}"` : ''}${def.max !== undefined ? ` max="${def.max}"` : ''}${def.step !== undefined ? ` step="${def.step}"` : ''}></label>`;
    case 'boolean':
      return `<label class="mz-standalone-check"><input type="checkbox" name="${name}"${value ? ' checked' : ''}> ${label}</label>`;
    case 'select':
      return `<label>${label} <select name="${name}">${def.options.map((o) => `<option value="${escapeHtml(String(o.value))}"${o.value === value ? ' selected' : ''}>${escapeHtml(localize(o.label, locale))}</option>`).join('')}</select></label>`;
    case 'text':
      return `<label>${label} <input type="text" name="${name}" value="${escapeHtml(value)}"${def.maxLength ? ` maxlength="${def.maxLength}"` : ''}></label>`;
  }
}

function readSettings(form: HTMLFormElement, defs: SettingDefinition[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const def of defs) {
    const field = form.elements.namedItem(`mz-s-${def.id}`) as HTMLInputElement | HTMLSelectElement | null;
    if (!field) continue;
    if (def.type === 'boolean') values[def.id] = (field as HTMLInputElement).checked;
    else if (def.type === 'number') values[def.id] = Number(field.value);
    else if (def.type === 'select') values[def.id] = def.options.find((o) => String(o.value) === field.value)?.value ?? field.value;
    else values[def.id] = field.value;
  }
  return values;
}

/** Opens the menu (one at a time). */
export function openMenu(state: MenuState, actions: MenuActions): void {
  document.querySelector('.mz-standalone-menu')?.remove();
  const t = texts(state.locale);
  const backdrop = document.createElement('div');
  backdrop.className = 'mz-standalone-menu';
  backdrop.innerHTML = `<div class="mz-standalone-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(t.heading)}">
    <h2>${escapeHtml(t.heading)}</h2>
    <p>${escapeHtml(t.playing(state.title, state.count))}</p>
    ${state.sample ? `<p class="mz-standalone-note">${escapeHtml(t.sample)}</p>` : ''}
    <p class="mz-standalone-status" role="status">${state.error ? `${escapeHtml(t.error)}: ${escapeHtml(state.error)}` : ''}</p>
    <label class="mz-standalone-file">${escapeHtml(t.file)}<input type="file" accept=".json,.md,.markdown,application/json,text/markdown,text/plain"></label>
    <form class="mz-standalone-url"><input type="url" placeholder="${escapeHtml(t.url)}" aria-label="${escapeHtml(t.url)}" required><button type="submit">${escapeHtml(t.load)}</button></form>
    ${state.sample ? '' : `<button type="button" class="mz-standalone-sample">${escapeHtml(t.backToSample)}</button>`}
    ${state.settings.length ? `<form class="mz-standalone-settings"><h3>${escapeHtml(t.settings)}</h3>${state.settings.map((def) => settingField(def, state.values[def.id] ?? def.default, state.locale)).join('')}<button type="submit">${escapeHtml(t.apply)}</button></form>` : ''}
    <button type="button" class="mz-standalone-reset">${escapeHtml(t.reset)}</button>
    <p class="mz-standalone-note"><a href="https://memizy.com/play/" target="_blank" rel="noopener">${escapeHtml(t.memizy)}</a></p>
    <button type="button" class="mz-standalone-close">${escapeHtml(t.close)}</button>
  </div>`;
  const status = backdrop.querySelector('.mz-standalone-status') as HTMLElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  const run = async (task: Promise<string | null>) => {
    status.textContent = t.loading;
    const error = await task;
    if (error) status.textContent = `${t.error}: ${error}`;
    else close();
  };
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  backdrop.querySelector('.mz-standalone-close')!.addEventListener('click', close);
  const file = backdrop.querySelector('input[type="file"]') as HTMLInputElement;
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (chosen) void run(chosen.text().then((text) => actions.chooseFile(text, chosen.name)));
  });
  backdrop.querySelector('.mz-standalone-url')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const url = (backdrop.querySelector('.mz-standalone-url input') as HTMLInputElement).value.trim();
    if (url) void run(actions.chooseUrl(url));
  });
  backdrop.querySelector('.mz-standalone-sample')?.addEventListener('click', () => {
    close();
    actions.chooseSample();
  });
  backdrop.querySelector('.mz-standalone-settings')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = readSettings(event.target as HTMLFormElement, state.settings);
    close();
    actions.applySettings(values);
  });
  // Two taps instead of confirm(): previews in other sites may block dialogs.
  const reset = backdrop.querySelector('.mz-standalone-reset') as HTMLButtonElement;
  reset.addEventListener('click', () => {
    if (reset.dataset.armed !== '1') {
      reset.dataset.armed = '1';
      reset.textContent = t.resetConfirm;
      return;
    }
    close();
    actions.resetProgress();
  });
  document.body.appendChild(backdrop);
  (backdrop.querySelector('.mz-standalone-close') as HTMLElement).focus();
}
