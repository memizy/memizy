import { describe, expect, it } from 'vitest';
import { SafeHtml, html, raw } from './html';

describe('ui.html', () => {
  it('escapes values and keeps safe HTML', () => {
    const name = '<img src=x onerror=alert(1)>';
    const out = html`<p class="who">${name}</p><div>${raw('<b>bold</b>')}</div>`;
    expect(out).toBeInstanceOf(SafeHtml);
    expect(String(out)).toBe('<p class="who">&lt;img src=x onerror=alert(1)&gt;</p><div><b>bold</b></div>');
  });

  it('joins arrays, nests templates and leaves out null, undefined and booleans', () => {
    const list = ['a&b', 'c'];
    const out = html`<ul>${list.map((x) => html`<li>${x}</li>`)}</ul>${null}${undefined}${false}${true}${0}`;
    expect(String(out)).toBe('<ul><li>a&amp;b</li><li>c</li></ul>0');
  });

  it('makes JSON payloads safe inside single-quoted attributes', () => {
    const payload = { answer: "it's \"x\"" };
    const out = String(html`<button data-payload='${JSON.stringify(payload)}'>x</button>`);
    const button = new DOMParser().parseFromString(out, 'text/html').querySelector('button')!;
    expect(JSON.parse(button.getAttribute('data-payload')!)).toEqual(payload);
  });

  it('works in plain template literals too (it is a String)', () => {
    expect(`<div>${html`<i>${'x'}</i>`}</div>`).toBe('<div><i>x</i></div>');
  });
});
