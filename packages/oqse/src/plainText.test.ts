import { describe, it, expect } from 'vitest';
import { toPlainText } from './plainText';

describe('toPlainText', () => {
  it('removes Markdown markup', () => {
    expect(toPlainText('## Heading\n\nSome **bold**, *italic*, __strong__ and ~~old~~ text.')).toBe('Heading\n\nSome bold, italic, strong and old text.');
    expect(toPlainText('- one\n* two\n1. three\n> quoted')).toBe('• one\n• two\n1. three\nquoted');
    expect(toPlainText('A [link](https://x.org), ![a cat](cat.png) and <https://y.org>.')).toBe('A link, a cat and https://y.org.');
    expect(toPlainText('Use `const x` here.')).toBe('Use const x here.');
    expect(toPlainText('snake_case_name stays')).toBe('snake_case_name stays');
  });

  it('keeps the code of fenced blocks and table cells', () => {
    expect(toPlainText('Before\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nAfter')).toBe('Before\n\ngraph LR\n  A --> B\n\nAfter');
    expect(toPlainText('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('a | b\n1 | 2');
  });

  it('replaces OQSE tags: assets by altText, blanks by ____', () => {
    const meta = { assets: { map: { type: 'image' as const, value: 'https://x/map.png', altText: 'Map of Europe' } } };
    expect(toPlainText('Look: <asset:Map /> and <asset:none />. Fill <blank:1 />.', { meta })).toBe('Look: Map of Europe and . Fill ____.');
  });

  it('shows formulas as their source only with latex; HTML without tags', () => {
    expect(toPlainText('Area $\\pi r^2$ and $$E = mc^2$$', { latex: true })).toBe('Area \\pi r^2 and E = mc^2');
    expect(toPlainText('It costs $5 and $10.')).toBe('It costs $5 and $10.');
    expect(toPlainText('H<sub>2</sub>O<br>next <span style="color:red">red</span>')).toBe('H2O\nnext red');
  });
});
