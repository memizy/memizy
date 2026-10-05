import { describe, it, expect, vi } from 'vitest';
import type { NoteItem } from '@memizy/oqse';
import { renderRichText, renderNoteHtml, type RichTextContext } from '../text/richText';
import { morph } from './morph';
import { bindEvents } from './events';

const ctx = (overrides: Partial<RichTextContext> = {}): RichTextContext => ({
  latex: true,
  locale: 'cs',
  resolveMedia: (key) => (key === 'map' ? { type: 'image', value: 'https://example.com/map.png', altText: 'Mapa "Evropy"' } : undefined),
  ...overrides,
});

describe('rich text', () => {
  it('renders Markdown and removes dangerous HTML', () => {
    const html = renderRichText('**tučně** <img src=x onerror=alert(1)> [x](javascript:alert(1))', ctx());
    expect(html).toContain('<strong>tučně</strong>');
    expect(html).not.toMatch(/onerror|javascript:/);
  });

  it('protects LaTeX from Markdown and keeps $ literal without the latex feature', () => {
    const html = renderRichText('Vzorec $a_1 * b_2 * c$ a $$\\frac{x}{y}$$', ctx());
    expect(html).toContain('data-mz-src="a_1 * b_2 * c"');
    expect(html).toContain('class="mz-math mz-math-display" data-mz-src="\\frac{x}{y}"');
    expect(html).not.toContain('<em>');
    const plain = renderRichText('Stojí to $5 a $10', ctx({ latex: false }));
    expect(plain).toContain('$5 a $10');
    expect(renderRichText('Stojí to $5 a $10', ctx())).not.toContain('mz-math'); // currency is not math
  });

  it('renders media tags, blanks and Mermaid blocks', () => {
    const html = renderRichText('Mapa: <asset:MAP /> a <asset:nope /> <blank:b1 />\n\n```mermaid\ngraph TD; A-->B\n```', ctx());
    expect(html).toContain('<img src="https://example.com/map.png" alt="Mapa &quot;Evropy&quot;"');
    expect(html).toContain('<span class="mz-missing-asset">[nope]</span>');
    expect(html).toContain('data-mz-blank="b1"');
    expect(html).toContain('<div class="mz-mermaid" data-mz-src="graph TD; A--&gt;B">');
  });

  it('renders inline text without paragraphs', () => {
    expect(renderRichText('*a*', ctx(), { inline: true })).toBe('<em>a</em>');
  });

  it('renders notes with relative headings and a hidden part', () => {
    const note = { id: 'n', type: 'note', title: 'Zákon', content: '## Sekce\n\nText', hiddenContent: 'Tajné' } as NoteItem;
    const html = renderNoteHtml(note, ctx(), { titleLevel: 2 });
    expect(html).toContain('<h2 class="mz-note-title">Zákon</h2>');
    expect(html).toContain('<h3>Sekce</h3>');
    expect(html).toContain('<summary>Zobrazit</summary>');
  });
});

describe('morph', () => {
  it('keeps elements, focus and typed text, and updates what changed', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    morph(root, '<p>Score 1</p><input name="answer"><button>OK</button>');
    const input = root.querySelector('input')!;
    input.focus();
    input.value = 'Pra';
    morph(root, '<p>Score 2</p><input name="answer"><button disabled>OK</button>');
    expect(root.querySelector('input')).toBe(input);
    expect(input.value).toBe('Pra');
    expect(document.activeElement).toBe(input);
    expect(root.querySelector('p')!.textContent).toBe('Score 2');
    expect(root.querySelector('button')!.disabled).toBe(true);
    input.blur();
    morph(root, '<p>Score 2</p><input name="answer"><button>OK</button>');
    expect(input.value).toBe('Pra'); // not focused, but the plugin did not change `value`
    morph(root, '<p>Score 2</p><input name="answer" value="reset"><button>OK</button>');
    expect(input.value).toBe('reset');
    root.remove();
  });

  it('moves keyed elements instead of recreating them', () => {
    const root = document.createElement('div');
    morph(root, '<ul><li data-key="a">A</li><li data-key="b">B</li></ul>');
    const b = root.querySelector('[data-key="b"]');
    morph(root, '<ul><li data-key="b">B</li><li data-key="a">A</li></ul>');
    expect(root.querySelector('li')).toBe(b);
    expect(root.textContent).toBe('BA');
  });

  it('keeps rendered math and diagrams untouched', () => {
    const root = document.createElement('div');
    morph(root, '<span class="mz-math" data-mz-src="x^2">x^2</span>');
    const math = root.querySelector('span')!;
    math.innerHTML = '<b>rendered</b>';
    math.dataset.mzRendered = 'x^2';
    morph(root, '<span class="mz-math" data-mz-src="x^2">x^2</span>');
    expect(math.innerHTML).toBe('<b>rendered</b>');
    morph(root, '<span class="mz-math" data-mz-src="y^2">y^2</span>');
    expect(root.querySelector('span')!.textContent).toBe('y^2');
  });

  it('keeps data-keep elements with what the plugin put into them', () => {
    const root = document.createElement('div');
    morph(root, '<p>Score 0</p><div id="scene" data-keep></div>');
    const scene = root.querySelector('#scene')!;
    const canvas = document.createElement('canvas');
    scene.appendChild(canvas);
    morph(root, '<p>Score 5</p><div id="scene" data-keep></div>');
    expect(root.querySelector('p')!.textContent).toBe('Score 5');
    expect(root.querySelector('#scene')).toBe(scene);
    expect(scene.firstChild).toBe(canvas);
  });
});

describe('events', () => {
  it('turns data-act clicks and forms into actions', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const act = vi.fn();
    const error = vi.fn();
    const unbind = bindEvents(root, { act, error });
    root.innerHTML = `
      <button data-act="answer" data-payload='{"answer":2}'><span>B</span></button>
      <button data-act="skip" disabled>skip</button>
      <button data-act="bad" data-payload="{oops">bad</button>
      <form data-act="submitText"><input name="text" value="Praha"><input name="tag" value="a"><input name="tag" value="b"><button>OK</button></form>`;
    (root.querySelector('span') as HTMLElement).click();
    (root.querySelector('[data-act="skip"]') as HTMLElement).click();
    (root.querySelector('[data-act="bad"]') as HTMLElement).click();
    const form = root.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(act.mock.calls).toEqual([
      ['answer', { answer: 2 }],
      ['submitText', { text: 'Praha', tag: ['a', 'b'] }],
    ]);
    expect(error).toHaveBeenCalledTimes(1);
    unbind();
    root.remove();
  });

  it('reports setting inputs with typed values', () => {
    const root = document.createElement('div');
    const setting = vi.fn();
    bindEvents(root, { act: vi.fn(), error: vi.fn(), setting });
    root.innerHTML = '<input type="range" data-setting="time" value="30"><input type="checkbox" data-setting="sound"><select data-setting="map"><option value="eu">EU</option><option value="cz">CZ</option></select>';
    const range = root.querySelector('input[type="range"]') as HTMLInputElement;
    range.value = '45';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    const box = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    const select = root.querySelector('select')!;
    select.value = 'cz';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(setting.mock.calls).toEqual([
      ['time', 45],
      ['sound', true],
      ['map', 'cz'],
    ]);
  });
});
