/**
 * Prompts the Lab copies for the student's AI assistant: the plugin guide plus
 * the game idea, and a "fix it" prompt built from failed tests.
 */

import type { OQSEFile } from '@memizy/oqse';
import { AI_GUIDE } from './plugins';
import type { LabTestResult } from './labTests';

export function describeSetTypes(file: OQSEFile): string {
  const counts = new Map<string, number>();
  for (const item of file.items) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  return [...counts].map(([type, n]) => `${type} (${n}×)`).join(', ');
}

export function buildCreatePrompt(idea: string, set: OQSEFile | null): string {
  const parts = [AI_GUIDE.trim(), '---', '## My game idea', idea.trim() || '(Invent a fun learning game for a class.)'];
  if (set) {
    parts.push(
      '## Study set used for testing',
      `The game will be tested with the set "${set.meta.title}" (language: ${set.meta.language}). It contains these item types: ${describeSetTypes(set)}.`,
      'Declare in the manifest `types` only the item types your game really handles.',
    );
  }
  parts.push('## Output', 'Answer with the complete `index.html` file only.');
  return parts.join('\n\n');
}

export function buildFixPrompt(html: string, results: LabTestResult[]): string {
  const problems = results.filter((r) => r.status === 'fail' || r.status === 'warn');
  const lines = problems.map((r) => `- [${r.status.toUpperCase()}] ${r.summary}${r.details.length ? `\n  ${r.details.join('\n  ')}` : ''}`);
  return [
    'The Memizy Plugin Lab tested my plugin and found these problems:',
    lines.join('\n'),
    'Fix them and answer with the complete corrected `index.html` file only. Keep everything else working.',
    '```html',
    html.trim(),
    '```',
  ].join('\n\n');
}
