/**
 * `ui.html` – an HTML template that escapes everything it does not know is safe.
 *
 *   ui.html`<p>${player.name}</p>`                → the name is escaped
 *   ui.html`<div>${ui.text(item.question)}</div>`  → Rich Content stays HTML
 *   ui.html`<ul>${list.map((x) => ui.html`<li>${x}</li>`)}</ul>`
 *   ui.html`<button data-act="buy" data-payload=${{ item: s.id }}>` → JSON in quotes
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

const isPlainObject = (value: unknown) => Object.prototype.toString.call(value) === '[object Object]';

function part(value: unknown): string {
  if (value instanceof SafeHtml) return value.toString();
  if (Array.isArray(value)) return value.map(part).join('');
  if (value === null || value === undefined || value === false || value === true) return '';
  if (isPlainObject(value)) return escapeHtml(JSON.stringify(value)); // e.g. inside data-payload='…'
  return escapeHtml(value);
}

/**
 * A value right after `name=` (no quotes): always one quoted, escaped attribute value.
 * `data-payload` is always JSON (`data-payload=${'map'}` → the string "map"); other
 * attributes get text, objects and arrays as JSON.
 */
function attributeValue(name: string, value: unknown): string {
  let text: string;
  if (name === 'data-payload') text = value instanceof SafeHtml ? value.toString() : JSON.stringify(value ?? null);
  else if (value instanceof SafeHtml || typeof value === 'string' || typeof value === 'number') text = String(value);
  else if (value === null || value === undefined || value === false) text = '';
  else text = JSON.stringify(value);
  return `"${escapeHtml(text)}"`;
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    // An unquoted attribute value: inside a tag, right after `name=`.
    const attribute = /([^\s"'<>\/=]+)\s*=\s*$/.exec(strings[i]);
    const inTag = out.lastIndexOf('<') > out.lastIndexOf('>');
    const unquoted = attribute !== null && inTag && /^(\s|\/?>|$)/.test(strings[i + 1]);
    out += (unquoted ? attributeValue(attribute[1].toLowerCase(), values[i]) : part(values[i])) + strings[i + 1];
  }
  return new SafeHtml(out);
}
