/**
 * Runs the complete example plugin from docs/ai-plugin-guide.md against the real
 * SDK (standalone mode), so the guide and the SDK cannot drift apart.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineGame, checkAnswer } from './index';
import { wait } from './test/localRouter';

const guide = readFileSync(resolve(import.meta.dirname, '../../../docs/ai-plugin-guide.md'), 'utf8').replace(/\r\n/g, '\n');
const example = /## 8\. Complete Example[\s\S]*?```html\n([\s\S]*?)```/.exec(guide)![1];

describe('AI guide example plugin', () => {
  it('imports the SDK exactly as the guide says', () => {
    expect(example).toContain("import { defineGame, checkAnswer } from 'https://cdn.jsdelivr.net/npm/@memizy/plugin-sdk@1/+esm';");
  });

  it('runs in standalone mode and plays a question', async () => {
    const doc = new DOMParser().parseFromString(example, 'text/html');
    document.head.innerHTML = doc.head.innerHTML;
    document.body.innerHTML = doc.body.querySelector('#app')!.outerHTML;

    const script = doc.querySelector('script[type="module"]')!.textContent!.replace(/^import .*$/m, '');
    new Function('defineGame', 'checkAnswer', script)(defineGame, checkAnswer);

    await wait(300);
    const app = document.getElementById('app')!;
    expect(app.textContent).toMatch(/Otázka 1 \/ \d+/);
    // Answer whatever question came first (ui.question controls).
    const option = app.querySelector<HTMLButtonElement>('.mz-q-opt[data-act="answer"]');
    if (option) option.click();
    else {
      const input = app.querySelector<HTMLInputElement>('input[name="answer"]');
      const firstToggle = app.querySelector<HTMLButtonElement>('.mz-q-opt[data-mzq]');
      if (input) input.value = '1';
      else firstToggle?.click();
      await wait(100);
      app.querySelector<HTMLButtonElement>('.mz-q-submit')!.click();
    }
    await wait(300);
    // Solo: the only player answered, so the question is revealed with the right answer marked.
    expect(app.textContent).toMatch(/Správně|Špatně/);
    expect(document.querySelector('.mz-standalone-banner')).not.toBeNull();
    expect(document.querySelector('.mz-error')).toBeNull();
  });
});
