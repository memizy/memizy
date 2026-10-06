/**
 * Custom study sets written by an AI chat: Memizy Play builds the prompt, the user
 * pastes the answer back, and we normalize it into a valid OQSE file (fresh ids,
 * our own meta), so the model only has to get the questions right.
 */

/** Item types an AI can write well without assets. */
export const AI_TYPES = ['mcq-single', 'mcq-multi', 'true-false', 'short-answer', 'match-pairs', 'sort-items', 'flashcard'] as const;
export type AiType = (typeof AI_TYPES)[number];

const SHAPES: Record<AiType, string> = {
  'mcq-single': '{"type":"mcq-single","question":"…","options":["A","B","C","D"],"correctIndex":0,"explanation":"…"}  (one correct option; 4 options, all different)',
  'mcq-multi': '{"type":"mcq-multi","question":"…","options":["A","B","C","D"],"correctIndices":[0,2],"explanation":"…"}  (two or more correct options)',
  'true-false': '{"type":"true-false","question":"A statement …","correctAnswer":true,"explanation":"…"}',
  'short-answer': '{"type":"short-answer","question":"…","correctAnswers":["answer","other accepted spelling"]}  (an answer of one or two words)',
  'match-pairs': '{"type":"match-pairs","question":"…","prompts":["left 1","left 2","left 3"],"matches":["right 1","right 2","right 3"]}  (prompts[i] belongs to matches[i])',
  'sort-items': '{"type":"sort-items","question":"Sort from … to …","items":["first","second","third","fourth"]}  (items in the correct order)',
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

/** Turns what the chat answered into an OQSE 0.2 file (as JSON text). */
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
    .map((it) => ({ ...it, id: crypto.randomUUID() }));
  if (!items.length) return { success: false, error: 'no-items' };
  const title = [obj.title, obj.meta?.title].find((t): t is string => typeof t === 'string' && t.trim().length > 0) ?? r.topic.trim();
  const now = new Date().toISOString();
  const file = {
    $schema: 'https://cdn.jsdelivr.net/npm/@memizy/oqse@0.2/schemas/oqse-v0.2.json',
    version: '0.2',
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
