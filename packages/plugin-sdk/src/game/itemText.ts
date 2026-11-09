/**
 * The length of an item's text (`ctx.itemInfo(id).textLength`): for reading times, e.g. how
 * long a flashcard stays on the screen. Counts the plain text of what a player reads – the
 * question, the front and back of a card, a note, the options – without media and markup.
 */

import { toPlainText, type OQSEAnyItem } from '@memizy/oqse';

/** Longer texts count as this many characters (a reading time has its own limit anyway). */
export const MAX_TEXT_LENGTH = 100_000;

const TEXT_FIELDS = ['title', 'question', 'front', 'back', 'content', 'text', 'prompt'] as const;

export function itemTextLength(item: OQSEAnyItem): number {
  const record = item as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of TEXT_FIELDS) if (typeof record[field] === 'string') parts.push(record[field] as string);
  if (Array.isArray(record.options)) {
    for (const option of record.options) {
      const text = (option as { text?: unknown } | null)?.text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  let length = 0;
  for (const part of parts) {
    length += toPlainText(part).length; // media count as nothing
    if (length >= MAX_TEXT_LENGTH) return MAX_TEXT_LENGTH;
  }
  return length;
}
