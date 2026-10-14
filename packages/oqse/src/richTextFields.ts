/**
 * The Rich Content fields of a set (texts, choices, hints, explanations, media
 * captions…), used by validation (raw HTML, assets) and by feature detection.
 */

import type { MediaObject, OQSEAnyItem, OQSEMeta } from './oqse';

type Path = (string | number)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ============================================================================
// Rich Content field extraction
// ============================================================================

/** A Rich Content field: its path (relative to the item, or from the root for meta) and its text. */
export type TextEntry = [Path, string];

function pushText(out: TextEntry[], path: Path, value: unknown) {
  if (typeof value === 'string') out.push([path, value]);
}

function pushTexts(out: TextEntry[], path: Path, values: unknown) {
  if (Array.isArray(values)) values.forEach((value, i) => pushText(out, [...path, i], value));
}

/** Texts (and explanations) of a list of choices. */
function pushChoices(out: TextEntry[], path: Path, choices: unknown) {
  if (!Array.isArray(choices)) return;
  choices.forEach((choice, i) => {
    if (!isRecord(choice)) return;
    pushText(out, [...path, i, 'text'], choice.text);
    pushText(out, [...path, i, 'explanation'], choice.explanation);
  });
}

function pushMediaTexts(out: TextEntry[], path: Path, assets: Record<string, MediaObject> | undefined) {
  for (const [key, media] of Object.entries(assets ?? {})) {
    pushText(out, [...path, key, 'transcript'], media.transcript);
    pushText(out, [...path, key, 'caption'], media.caption);
  }
}

export function metaRichText(meta: OQSEMeta): TextEntry[] {
  const out: TextEntry[] = [];
  pushText(out, ['meta', 'description'], meta.description);
  pushMediaTexts(out, ['meta', 'assets'], meta.assets);
  return out;
}

/** All Rich Content fields of an item, as `[path relative to the item, text]`. */
export function itemRichText(item: OQSEAnyItem): TextEntry[] {
  const out: TextEntry[] = [];
  pushTexts(out, ['hints'], item.hints);
  pushText(out, ['explanation'], item.explanation);
  pushText(out, ['incorrectFeedback'], item.incorrectFeedback);
  item.sources?.forEach((source, i) => pushText(out, ['sources', i, 'quote'], source.quote));
  pushMediaTexts(out, ['assets'], item.assets);
  if ('question' in item) pushText(out, ['question'], item.question);

  switch (item.type) {
    case 'note':
      pushText(out, ['content'], item.content);
      pushText(out, ['hiddenContent'], item.hiddenContent);
      break;
    case 'flashcard':
      pushText(out, ['front'], item.front);
      pushText(out, ['back'], item.back);
      break;
    case 'mcq-single':
    case 'mcq-multi':
      pushChoices(out, ['options'], item.options);
      break;
    case 'fill-in-blanks':
      pushText(out, ['text'], item.text);
      break;
    case 'fill-in-select':
      pushText(out, ['text'], item.text);
      for (const [token, blank] of Object.entries(item.blanks)) pushChoices(out, ['blanks', token, 'options'], blank.options);
      break;
    case 'match-pairs':
      pushChoices(out, ['prompts'], item.prompts);
      pushChoices(out, ['matches'], item.matches);
      break;
    case 'match-complex':
      pushChoices(out, ['prompts'], item.prompts);
      pushChoices(out, ['matches'], item.matches);
      break;
    case 'sort-items':
      pushChoices(out, ['items'], item.items);
      break;
    case 'categorize':
      pushChoices(out, ['categories'], item.categories);
      item.items.forEach((entry, i) => pushText(out, ['items', i, 'text'], entry.text));
      break;
    case 'timeline':
      item.events.forEach((event, i) => pushText(out, ['events', i, 'text'], event.text));
      break;
    case 'diagram-label':
      pushChoices(out, ['labels'], item.labels);
      break;
    case 'matrix':
      pushChoices(out, ['rows'], item.rows);
      pushChoices(out, ['columns'], item.columns);
      break;
    case 'open-ended':
      pushText(out, ['sampleAnswer'], item.sampleAnswer);
      break;
  }
  return out;
}
