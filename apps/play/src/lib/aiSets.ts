/**
 * Custom study sets written by an AI chat: Memizy Play builds the prompt, the user
 * pastes the answer back, and we normalize it into a valid OQSE file (fresh ids,
 * our own meta), so the model only has to get the questions right.
 */

/** Item types an AI can write well without assets. */
export const AI_TYPES = ['mcq-single', 'mcq-multi', 'true-false', 'short-answer', 'match-pairs', 'sort-items', 'flashcard'] as const;
export type AiType = (typeof AI_TYPES)[number];

const SHAPES: Record<AiType, string> = {
  'mcq-single': '{"type":"mcq-single","question":"…","options":[{"id":"a","text":"…"},{"id":"b","text":"…"},{"id":"c","text":"…"},{"id":"d","text":"…"}],"correctId":"b","explanation":"…"}  (one correct option; 4 options, all different; vary which one is correct)',
  'mcq-multi': '{"type":"mcq-multi","question":"…","options":[{"id":"a","text":"…"},{"id":"b","text":"…"},{"id":"c","text":"…"},{"id":"d","text":"…"}],"correctIds":["a","c"],"explanation":"…"}  (two or more correct options)',
  'true-false': '{"type":"true-false","question":"A statement …","correctAnswer":true,"explanation":"…"}',
  'short-answer': '{"type":"short-answer","question":"…","correctAnswers":["answer","other accepted spelling"]}  (an answer of one or two words)',
  'match-pairs': '{"type":"match-pairs","question":"…","prompts":[{"id":"p1","text":"…"},{"id":"p2","text":"…"},{"id":"p3","text":"…"}],"matches":[{"id":"m1","text":"…"},{"id":"m2","text":"…"},{"id":"m3","text":"…"}],"pairs":{"p1":"m1","p2":"m2","p3":"m3"}}  (pairs: prompt id → its match id)',
  'sort-items': '{"type":"sort-items","question":"Sort from … to …","items":[{"id":"i1","text":"…"},{"id":"i2","text":"…"},{"id":"i3","text":"…"},{"id":"i4","text":"…"}],"correctOrder":["i3","i1","i4","i2"]}  (correctOrder: item ids in the right order)',
  flashcard: '{"type":"flashcard","front":"term","back":"definition"}',
};

const LANGUAGES: Record<string, string> = { cs: 'Czech', en: 'English', sk: 'Slovak', de: 'German' };

/** The types to offer first: those the plugin plays (all of ours if it plays everything). */
export function defaultAiTypes(pluginTypes: readonly string[] | null | undefined): AiType[] {
  if (!pluginTypes || pluginTypes.includes('*')) return ['mcq-single', 'true-false'];
  const ours = AI_TYPES.filter((t) => pluginTypes.includes(t));
  return ours.length ? ours : ['mcq-single'];
}

export interface AiRequest {
  topic: string;
  count: number;
  language: string;
  types: AiType[];
}

export function buildAiPrompt(r: AiRequest): string {
  const language = LANGUAGES[r.language] ?? r.language;
  return [
    `Write ${r.count} quiz questions about this topic for high-school students: ${r.topic.trim()}`,
    '',
    `Write all the text in ${language}. Mix these question types (use only these):`,
    ...r.types.map((t) => `- ${SHAPES[t]}`),
    '',
    'Rules:',
    '- Facts must be correct; if you are not sure about something, leave it out.',
    '- Wrong options must be plausible but clearly wrong.',
    '- Keep questions short (they are read on a phone during a game).',
    '- Add a "topic" (a subtopic of two or three words) to every item.',
    '',
    'Answer with the JSON only, in this shape:',
    '{"title":"A short title of the set","items":[ …the items… ]}',
    'Put the whole JSON in one code block (```json … ```) so it can be copied with one click; no comments inside the JSON.',
    'If you edit files directly (an IDE or coding agent), save it as `questions.json` and still show it in the code block: it is pasted into the Lab.',
  ].join('\n');
}

export type NormalizeResult = { success: true; json: string; count: number; dropped: number } | { success: false; error: string };

type Raw = Record<string, unknown>;
const letter = (i: number) => String.fromCharCode(97 + i);
/** Plain strings become choices `{ id, text }` (chats sometimes answer in the older style). */
const toChoices = (list: unknown, id: (i: number) => string): Raw[] | null =>
  Array.isArray(list) && list.every((x) => typeof x === 'string') ? list.map((text, i) => ({ id: id(i), text })) : null;

/** Accepts the older shape (texts and positions) and turns it into OQSE 0.3 (choices and IDs). */
function upgradeItem(it: Raw): Raw {
  const out = { ...it };
  const opts = toChoices(it.options, letter);
  if (opts && (it.type === 'mcq-single' || it.type === 'mcq-multi')) {
    out.options = opts;
    if (typeof it.correctIndex === 'number') { out.correctId = opts[it.correctIndex]?.id; delete out.correctIndex; }
    if (Array.isArray(it.correctIndices)) { out.correctIds = it.correctIndices.map((i) => opts[Number(i)]?.id); delete out.correctIndices; }
  }
  const items = toChoices(it.items, (i) => `i${i + 1}`);
  if (items && it.type === 'sort-items') {
    out.items = items;
    out.correctOrder ??= items.map((c) => c.id); // listed in the right order
  }
  const prompts = toChoices(it.prompts, (i) => `p${i + 1}`);
  const matches = toChoices(it.matches, (i) => `m${i + 1}`);
  if (prompts && matches && it.type === 'match-pairs') {
    out.prompts = prompts;
    out.matches = matches;
    out.pairs ??= Object.fromEntries(prompts.map((p, i) => [p.id, matches[i]?.id]));
  }
  return out;
}

/** Turns what the chat answered into an OQSE 0.3 file (as JSON text). */
export function normalizeAiAnswer(text: string, r: Pick<AiRequest, 'topic' | 'language'>): NormalizeResult {
  let body = text.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (start === -1 || end < start) return { success: false, error: 'no-json' };
  body = body.slice(start, end + 1);
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
  const obj = (Array.isArray(data) ? { items: data } : data) as { title?: unknown; meta?: { title?: unknown }; items?: unknown };
  const raw = Array.isArray(obj?.items) ? obj.items : [];
  const items = raw
    .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object' && typeof (it as { type?: unknown }).type === 'string')
    .map((it) => ({ ...upgradeItem(it), id: crypto.randomUUID() }));
  if (!items.length) return { success: false, error: 'no-items' };
  const title = [obj.title, obj.meta?.title].find((t): t is string => typeof t === 'string' && t.trim().length > 0) ?? r.topic.trim();
  const now = new Date().toISOString();
  const file = {
    $schema: 'https://cdn.jsdelivr.net/npm/@memizy/oqse@0.3/schemas/oqse-v0.3.json',
    version: '0.3',
    meta: {
      id: crypto.randomUUID(),
      language: r.language,
      title: title.slice(0, 200),
      description: r.topic.trim().slice(0, 1000),
      createdAt: now,
      updatedAt: now,
      tags: ['ai'],
    },
    items,
  };
  return { success: true, json: JSON.stringify(file, null, 2), count: items.length, dropped: raw.length - items.length };
}
