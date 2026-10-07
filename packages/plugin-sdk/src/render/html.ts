/**
 * `ui.html` – an HTML template that escapes everything it does not know is safe.
 *
 *   ui.html`<p>${player.name}</p>`                → the name is escaped
 *   ui.html`<div>${ui.text(item.question)}</div>`  → Rich Content stays HTML
 *   ui.html`<ul>${list.map((x) => ui.html`<li>${x}</li>`)}</ul>`
 *
 * Safe values are `SafeHtml` (results of `ui.html`, `ui.text`, `ui.renderNote`,
 * `ui.question`, `ui.raw`). They extend `String`, so they also work in plain template
 * literals and string concatenation.
 */

import { escapeHtml } from '../text/richText';

export class SafeHtml extends String {}

/** Marks HTML as safe without escaping (only for HTML you wrote yourself). */
export function raw(html: unknown): SafeHtml {
  return new SafeHtml(html instanceof SafeHtml ? html.toString() : String(html ?? ''));
}

function part(value: unknown): string {
  if (value instanceof SafeHtml) return value.toString();
  if (Array.isArray(value)) return value.map(part).join('');
  if (value === null || value === undefined || value === false || value === true) return '';
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}
