/**
 * OQSE Markdown – a whole study set of `note` items written as one Markdown document.
 *
 * ```markdown
 * ---
 * oqse: "0.2"
 * id: 0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a00
 * title: Termodynamika
 * language: cs
 * ---
 * Text before the first heading is the set description.
 *
 * # Základní zákony                       ← chapter heading (level L-1) = `topic`
 *
 * ## První zákon                          ← note heading (level L) = `title`
 * <!-- oqse: {id: 0192f0c4-…, tags: [fyzika]} -->
 * Note content: $\Delta U = Q - W$, Mermaid, code – no escaping.
 *
 * > [!hidden]-
 * > Revealed on demand (`hiddenContent`).
 * ```
 *
 * - Frontmatter: `oqse` (version), optional `noteHeadingLevel` (L, default 2), all other keys are `meta`.
 * - Missing `id`, `createdAt` and `updatedAt` are generated when parsing and reported in `generated`,
 *   so authors (and AI) never have to invent UUIDs.
 * - Only sets that contain nothing but `note` items have a Markdown representation.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { NoteItem, OQSEFile, OQSEMeta } from './oqse';
import { safeValidateOQSEFile, formatOQSEIssues, type OQSEIssue } from './fileValidation';
import { generateUUID } from './utils';

/** Callout marker that introduces `hiddenContent` (case-insensitive when parsing). */
export const HIDDEN_CALLOUT_MARKER = '[!hidden]';

/** Default heading level of notes (chapters/topics use the level above). */
export const DEFAULT_NOTE_HEADING_LEVEL = 2;

export interface MarkdownSetParseResult {
  file: OQSEFile;
  /** Paths of values generated because they were missing (e.g. `meta.id`, `items[3].id`). */
  generated: string[];
}

export interface MarkdownSetSerializeOptions {
  /** Heading level of notes (1–6). Default `'auto'`: 2, or lower if note content uses H2 headings. */
  noteHeadingLevel?: number | 'auto';
}

/** Error thrown when a Markdown set cannot be parsed or a set cannot be serialized. */
export class MarkdownSetError extends Error {
  /** 1-based line number in the Markdown source, when known. */
  readonly line?: number;
  /** Validation issues of the resulting set. */
  readonly issues: OQSEIssue[];

  constructor(message: string, options: { line?: number; issues?: OQSEIssue[] } = {}) {
    super(options.line ? `Line ${options.line}: ${message}` : message);
    this.name = 'MarkdownSetError';
    this.line = options.line;
    this.issues = options.issues ?? [];
  }
}

// ============================================================================
// Parsing
// ============================================================================

const FRONTMATTER_DELIMITER = '---';
const FORMAT_KEYS = ['oqse', 'noteHeadingLevel'] as const;
const RESERVED_NOTE_KEYS = ['type', 'title', 'content', 'hiddenContent'] as const;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HIDDEN_CALLOUT_RE = /^>\s?\[!hidden\][+-]?(?:\s.*)?$/i;
const META_COMMENT_START_RE = /^<!--\s*oqse:(.*)$/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const BLANK_RE = /^\s*$/;

interface Line {
  text: string;
  /** 1-based line number in the source. */
  no: number;
}

/**
 * Parses an OQSE Markdown document into a strictly validated set.
 * @throws {MarkdownSetError} on malformed Markdown or an invalid resulting set.
 */
export function parseMarkdownSet(markdown: string): MarkdownSetParseResult {
  const all = splitLines(markdown.replace(/^﻿/, '')).map((text, i) => ({ text, no: i + 1 }));
  const generated: string[] = [];

  // --- Frontmatter -----------------------------------------------------------
  if (all[0]?.text !== FRONTMATTER_DELIMITER) {
    throw new MarkdownSetError('Missing YAML frontmatter (the file must start with "---").', { line: 1 });
  }
  const closing = all.findIndex((line, i) => i > 0 && line.text === FRONTMATTER_DELIMITER);
  if (closing === -1) throw new MarkdownSetError('Unterminated YAML frontmatter (missing closing "---").', { line: 1 });

  const front = parseYamlMapping(all.slice(1, closing).map((l) => l.text).join('\n'), 2, 'Frontmatter');
  const version = front.oqse;
  if (typeof version !== 'string' && typeof version !== 'number') {
    throw new MarkdownSetError('Frontmatter must contain the OQSE version, e.g. oqse: "0.2".', { line: 2 });
  }
  const level = front.noteHeadingLevel ?? DEFAULT_NOTE_HEADING_LEVEL;
  if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 6) {
    throw new MarkdownSetError('noteHeadingLevel must be an integer from 1 to 6.', { line: 2 });
  }
  const noteLevel = level as number;
  const topicLevel = noteLevel - 1;
  if ('description' in front) {
    throw new MarkdownSetError('Write the set description as text before the first heading, not in the frontmatter.', { line: 2 });
  }

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(front)) {
    if (!(FORMAT_KEYS as readonly string[]).includes(key)) meta[key] = value;
  }
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const key of ['id', 'createdAt', 'updatedAt'] as const) {
    if (meta[key] === undefined) {
      meta[key] = key === 'id' ? generateUUID() : now;
      generated.push(`meta.${key}`);
    }
  }

  // --- Body ------------------------------------------------------------------
  const body = all.slice(closing + 1);
  const headings = findHeadings(body.map((l) => l.text));
  const structural = headings.filter((h) => h.level <= noteLevel);

  for (const h of structural) {
    if (h.level < topicLevel || (h.level === topicLevel && topicLevel < 1)) {
      throw new MarkdownSetError(
        `Heading level ${h.level} is not allowed with noteHeadingLevel ${noteLevel} ` +
          `(notes use level ${noteLevel}${topicLevel >= 1 ? `, chapters level ${topicLevel}` : ''}).`,
        { line: body[h.index].no },
      );
    }
  }

  const firstStructural = structural[0]?.index ?? body.length;
  const description = trimBlankLines(body.slice(0, firstStructural).map((l) => l.text).join('\n'));
  if (description !== '') meta.description = description;

  const items: Record<string, unknown>[] = [];
  const noteLines: number[] = [];
  let topic: string | undefined;

  structural.forEach((heading, n) => {
    const end = structural[n + 1]?.index ?? body.length;
    const section = body.slice(heading.index + 1, end);

    if (heading.level === topicLevel) {
      const stray = section.find((l) => !BLANK_RE.test(l.text));
      if (stray) {
        throw new MarkdownSetError('Text under a chapter heading must belong to a note (add a note heading).', { line: stray.no });
      }
      topic = heading.text || undefined;
      return;
    }

    const note = parseNoteSection(section, heading.text, noteLevel, body[heading.index].no);
    if (topic !== undefined && noteLevel > 1) note.topic = topic;
    if (note.id === undefined) {
      note.id = generateUUID();
      generated.push(`items[${items.length}].id`);
    }
    items.push(note);
    noteLines.push(body[heading.index].no);
  });

  // --- Validation ------------------------------------------------------------
  const file = { version: String(version), meta, items };
  const result = safeValidateOQSEFile(file);
  if (!result.success) {
    const first = result.errors[0];
    const match = /^items\[(\d+)\]/.exec(first.path);
    throw new MarkdownSetError(`Invalid set: ${formatOQSEIssues(result.errors).join('; ')}`, {
      line: match ? noteLines[Number(match[1])] : undefined,
      issues: result.errors,
    });
  }
  return { file: result.data!, generated };
}

/** Non-throwing variant of {@link parseMarkdownSet}. */
export function safeParseMarkdownSet(
  markdown: string,
): { success: true; data: MarkdownSetParseResult } | { success: false; error: MarkdownSetError } {
  try {
    return { success: true, data: parseMarkdownSet(markdown) };
  } catch (e) {
    if (e instanceof MarkdownSetError) return { success: false, error: e };
    throw e;
  }
}

function parseNoteSection(section: Line[], title: string, noteLevel: number, headingLine: number): Record<string, unknown> {
  let start = 0;
  while (start < section.length && BLANK_RE.test(section[start].text)) start++;

  // Optional metadata comment right below the heading.
  let fields: Record<string, unknown> = {};
  const commentStart = section[start] && META_COMMENT_START_RE.exec(section[start].text);
  if (commentStart) {
    const parts = [commentStart[1]];
    let i = start;
    while (!parts[parts.length - 1].includes('-->')) {
      i++;
      if (i >= section.length) throw new MarkdownSetError('Unterminated "<!-- oqse:" comment (missing "-->").', { line: section[start].no });
      parts.push(section[i].text);
    }
    const last = parts[parts.length - 1];
    if (!BLANK_RE.test(last.slice(last.indexOf('-->') + 3))) {
      throw new MarkdownSetError('Nothing may follow "-->" on the metadata comment line.', { line: section[i].no });
    }
    parts[parts.length - 1] = last.slice(0, last.indexOf('-->'));
    fields = parseYamlMapping(parts.join('\n'), section[start].no, 'Note metadata');
    start = i + 1;
  }

  for (const key of RESERVED_NOTE_KEYS) {
    if (key in fields && !(key === 'type' && fields.type === 'note')) {
      throw new MarkdownSetError(`"${key}" must not be in the note metadata (it comes from the Markdown itself).`, { line: headingLine });
    }
  }
  if ('topic' in fields && noteLevel > 1) {
    throw new MarkdownSetError('"topic" comes from the chapter heading; remove it from the note metadata.', { line: headingLine });
  }

  // Content and the optional trailing hidden callout.
  const rest = section.slice(start);
  const scan = scanTopLevel(rest.map((l) => l.text));
  let contentLines = rest;
  let hiddenLines: string[] | undefined;

  if (scan.hiddenCallouts.length > 1) {
    throw new MarkdownSetError(`Only one "> ${HIDDEN_CALLOUT_MARKER}" callout is allowed per note.`, { line: rest[scan.hiddenCallouts[1]].no });
  }
  if (scan.hiddenCallouts.length === 1) {
    const at = scan.hiddenCallouts[0];
    if (at > 0 && !BLANK_RE.test(rest[at - 1].text)) {
      throw new MarkdownSetError(`The "> ${HIDDEN_CALLOUT_MARKER}" callout must be preceded by a blank line.`, { line: rest[at].no });
    }
    let end = rest.length;
    while (end > at + 1 && BLANK_RE.test(rest[end - 1].text)) end--;
    for (let i = at + 1; i < end; i++) {
      if (!rest[i].text.startsWith('>')) {
        throw new MarkdownSetError(
          `The "> ${HIDDEN_CALLOUT_MARKER}" callout must be the last block of the note and every line in it must start with ">".`,
          { line: rest[i].no },
        );
      }
    }
    contentLines = rest.slice(0, at);
    hiddenLines = rest.slice(at + 1, end).map((l) => l.text.replace(/^> ?/, ''));
  }

  const { id, type: _type, ...other } = fields;
  const note: Record<string, unknown> = { id, type: 'note' };
  if (title !== '') note.title = title;
  Object.assign(note, other);
  note.content = trimBlankLines(contentLines.map((l) => l.text).join('\n'));
  const hidden = hiddenLines === undefined ? '' : trimBlankLines(hiddenLines.join('\n'));
  if (hidden !== '') note.hiddenContent = hidden;
  return note;
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serializes a set of `note` items to OQSE Markdown.
 * @throws {MarkdownSetError} if the set cannot be represented losslessly.
 */
export function serializeMarkdownSet(file: OQSEFile, options: MarkdownSetSerializeOptions = {}): string {
  const extraRootKeys = Object.keys(file).filter((k) => !['$schema', 'version', 'meta', 'items'].includes(k));
  if (extraRootKeys.length > 0) throw new MarkdownSetError(`Unsupported root keys: ${extraRootKeys.join(', ')}.`);

  const notes = file.items.map((item, i) => {
    if (item.type !== 'note') {
      throw new MarkdownSetError(`Only sets of "note" items can be written as Markdown (items[${i}] is "${item.type}").`);
    }
    return item as NoteItem;
  });
  const { description, ...meta } = file.meta as OQSEMeta;

  // Content headings must stay below the note level, so pick the level accordingly.
  const texts = [description ?? '', ...notes.map((n) => n.content)];
  const minContentLevel = Math.min(7, ...texts.flatMap((t) => findHeadings(splitLines(t)).map((h) => h.level)));
  let noteLevel: number;
  if (options.noteHeadingLevel === undefined || options.noteHeadingLevel === 'auto') {
    noteLevel = Math.min(DEFAULT_NOTE_HEADING_LEVEL, minContentLevel - 1);
    if (noteLevel < 1) throw new MarkdownSetError('Note content contains level-1 headings, so notes cannot be split by headings.');
  } else {
    noteLevel = options.noteHeadingLevel;
    if (!Number.isInteger(noteLevel) || noteLevel < 1 || noteLevel > 6) throw new MarkdownSetError('noteHeadingLevel must be an integer from 1 to 6.');
    if (minContentLevel <= noteLevel) throw new MarkdownSetError(`Note content contains level-${minContentLevel} headings; use a noteHeadingLevel below ${minContentLevel}.`);
  }
  const topicLevel = noteLevel - 1;

  // Frontmatter.
  const front: Record<string, unknown> = { oqse: file.version };
  if (noteLevel !== DEFAULT_NOTE_HEADING_LEVEL) front.noteHeadingLevel = noteLevel;
  const { id, title, language, ...restMeta } = meta;
  Object.assign(front, { id, title, language }, restMeta);
  let out = `${FRONTMATTER_DELIMITER}\n${stringifyYaml(front, { lineWidth: 0 })}${FRONTMATTER_DELIMITER}\n`;
  if (description) out += `${trimBlankLines(description)}\n`;

  let topic: string | undefined;
  notes.forEach((note, i) => {
    const where = `items[${i}]`;
    const { id: noteId, type: _t, title: noteTitle, content, hiddenContent, topic: noteTopic, ...restNote } = note;

    if (topicLevel >= 1 && noteTopic !== topic) {
      assertSingleLine(noteTopic, `${where}.topic`);
      out += `\n${'#'.repeat(topicLevel)}${noteTopic ? ` ${noteTopic}` : ''}\n`;
      topic = noteTopic;
    }

    assertSingleLine(noteTitle, `${where}.title`);
    if (noteTitle && /(^|\s)#+\s*$/.test(noteTitle)) throw new MarkdownSetError(`${where}.title must not end with "#".`);
    out += `\n${'#'.repeat(noteLevel)}${noteTitle ? ` ${noteTitle}` : ''}\n`;

    const fields: Record<string, unknown> = { id: noteId, ...restNote };
    if (topicLevel < 1 && noteTopic !== undefined) fields.topic = noteTopic;
    out += `${metadataComment(fields, where)}\n`;

    const contentLines = splitLines(trimBlankLines(content));
    const scan = scanTopLevel(contentLines);
    if (scan.hiddenCallouts.length > 0) {
      throw new MarkdownSetError(`${where}.content must not contain a top-level "> ${HIDDEN_CALLOUT_MARKER}" callout; use hiddenContent.`);
    }
    if (scan.unclosedFence) throw new MarkdownSetError(`${where}.content ends inside an unclosed code fence.`);
    out += `${contentLines.join('\n')}\n`;

    const hidden = hiddenContent === undefined ? '' : trimBlankLines(hiddenContent);
    if (hidden !== '') {
      const quoted = splitLines(hidden).map((line) => (line === '' ? '>' : `> ${line}`));
      out += `\n> ${HIDDEN_CALLOUT_MARKER}-\n${quoted.join('\n')}\n`;
    }
  });

  return out;
}

function metadataComment(fields: Record<string, unknown>, where: string): string {
  const flow = stringifyYaml(fields, { collectionStyle: 'flow', lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  const yaml = flow.includes('\n') ? `\n${stringifyYaml(fields, { lineWidth: 0 })}` : ` ${flow} `;
  if (yaml.includes('-->')) throw new MarkdownSetError(`${where} metadata must not contain "-->".`);
  return `<!-- oqse:${yaml}-->`;
}

// ============================================================================
// Helpers
// ============================================================================

function parseYamlMapping(text: string, line: number, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (e) {
    throw new MarkdownSetError(`${what}: invalid YAML (${(e as Error).message.split('\n')[0]}).`, { line });
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new MarkdownSetError(`${what} must be a YAML mapping (key: value).`, { line });
  }
  return value as Record<string, unknown>;
}

function assertSingleLine(value: string | undefined, where: string) {
  if (value !== undefined && /[\r\n]/.test(value)) throw new MarkdownSetError(`${where} must be a single line.`);
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Removes leading and trailing blank lines (and trailing whitespace). */
function trimBlankLines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}

/** ATX headings outside fenced code blocks. */
function findHeadings(lines: string[]): Array<{ index: number; level: number; text: string }> {
  const out: Array<{ index: number; level: number; text: string }> = [];
  forEachTopLevelLine(lines, (line, index) => {
    const m = HEADING_RE.exec(line);
    if (m) out.push({ index, level: m[1].length, text: (m[2] ?? '').trim() });
  });
  return out;
}

/** Top-level `> [!hidden]` callout lines and whether the text ends inside an open fence. */
function scanTopLevel(lines: string[]): { hiddenCallouts: number[]; unclosedFence: boolean } {
  const hiddenCallouts: number[] = [];
  const unclosedFence = forEachTopLevelLine(lines, (line, index) => {
    if (HIDDEN_CALLOUT_RE.test(line)) hiddenCallouts.push(index);
  });
  return { hiddenCallouts, unclosedFence };
}

/** Calls `visit` for lines outside fenced code blocks. Returns `true` if a fence is left open. */
function forEachTopLevelLine(lines: string[], visit: (line: string, index: number) => void): boolean {
  let fence: { char: string; length: number } | null = null;
  lines.forEach((line, index) => {
    if (fence) {
      const close = FENCE_CLOSE_RE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      return;
    }
    const open = FENCE_OPEN_RE.exec(line);
    if (open) {
      fence = { char: open[1][0], length: open[1].length };
      return;
    }
    visit(line, index);
  });
  return fence !== null;
}
