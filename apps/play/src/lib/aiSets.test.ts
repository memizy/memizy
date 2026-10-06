import { describe, expect, it } from 'vitest';
import { buildAiPrompt, defaultAiTypes, normalizeAiAnswer } from './aiSets';
import { parseSetText } from './sets';

describe('AI study sets', () => {
  it('offers the types the game plays', () => {
    expect(defaultAiTypes(['mcq-single', 'sort-items', 'pin-on-image'])).toEqual(['mcq-single', 'sort-items']);
    expect(defaultAiTypes(['*'])).toEqual(['mcq-single', 'true-false']);
  });

  it('builds a prompt with the topic, language and shapes', () => {
    const prompt = buildAiPrompt({ topic: 'Fotosyntéza', count: 12, language: 'cs', types: ['true-false'] });
    expect(prompt).toContain('12 quiz questions');
    expect(prompt).toContain('Fotosyntéza');
    expect(prompt).toContain('Czech');
    expect(prompt).toContain('"type":"true-false"');
    expect(prompt).not.toContain('mcq-single');
  });

  it('turns a chat answer (fences, bad ids, an invalid item) into a valid set', () => {
    const answer = [
      'Here you go:',
      '```json',
      JSON.stringify({
        title: 'Fotosyntéza',
        items: [
          { id: '1', type: 'mcq-single', question: 'Kde probíhá?', options: ['V chloroplastech', 'V jádře', 'V ribozomech'], correctIndex: 0 },
          { id: '1', type: 'true-false', question: 'Rostliny při ní uvolňují kyslík.', correctAnswer: true },
          { type: 'mcq-single', question: 'Broken', options: ['A'], correctIndex: 3 },
          'not an item',
        ],
      }),
      '```',
    ].join('\n');
    const normalized = normalizeAiAnswer(answer, { topic: 'Fotosyntéza', language: 'cs' });
    expect(normalized.success).toBe(true);
    if (!normalized.success) return;
    expect(normalized.count).toBe(3);
    expect(normalized.dropped).toBe(1);
    const parsed = parseSetText(normalized.json, 'ai.oqse.json', 'upload');
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.set.title).toBe('Fotosyntéza');
    expect(parsed.set.file.meta.language).toBe('cs');
    const ids = parsed.set.file.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parsed.set.file.items.some((i) => i.type === 'true-false')).toBe(true);
  });

  it('accepts a bare array and reports text without JSON', () => {
    const normalized = normalizeAiAnswer('[{"type":"flashcard","front":"A","back":"B"}]', { topic: 'Pojmy', language: 'en' });
    expect(normalized.success && normalized.count).toBe(1);
    expect(normalizeAiAnswer('Sorry, I cannot.', { topic: 'x', language: 'en' })).toEqual({ success: false, error: 'no-json' });
  });
});
