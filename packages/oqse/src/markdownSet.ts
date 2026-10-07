/**
 * OQSE Markdown – a whole study set of `note` items written as one Markdown document.
 *
 * ```markdown
 * ---
 * oqse: "0.3"
 * language: cs
 * ---
 * # Termodynamika                         ← level L-2: set title (`meta.title`)
 * Text before the first chapter is the set description.
 *
 * ## Základní zákony                      ← level L-1: chapter = `topic`
 *
 * ### První zákon                         ← level L (default 3): note `title`
 * <!-- oqse: {id: 0192f0c4-…, tags: [fyzika]} -->
 * Note content: $\Delta U = Q - W$, Mermaid, code – no escaping.
 *
 * #### Odvození                           ← headings inside a note are relative to the note
 *
 * > [!hidden]-
 * > Revealed on demand (`hiddenContent`).
 * ```
 *
 * Heading levels inside note content are relative to the note: in JSON the note
 * title corresponds to level 1, so content headings start at `##`. In Markdown
 * they are shifted by `noteHeadingLevel - 1` (e.g., `##` in JSON is `####` under a `###` note).
 *
 * Missing `id`, `createdAt` and `updatedAt` are generated when parsing and reported
 * in `generated`, so authors (and AI) never have to invent UUIDs.
 * Only sets that contain nothing but `note` items have a Markdown representation.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { NoteItem, OQSEFile, OQSEMeta } from './oqse';
import { safeValidateOQSEFile, formatOQSEIssues, type OQSEIssue } from './fileValidation';
import { generateUUID } from './utils';
import { findHeadings, forEachTopLevelLine, shiftHeadings, splitLines, trimBlankLines } from './markdownUtils';

/** Callout marker that introduces `hiddenContent` (case-insensitive when parsing). */
export const HIDDEN_CALLOUT_MARKER = '[!hidden]';

/** Default heading level of notes: `#` set title, `##` chapters, `###` notes. */
export const DEFAULT_NOTE_HEADING_LEVEL = 3;

export interface MarkdownSetParseResult {
  file: OQSEFile;
  /** Paths of values generated because they were missing (e.g. `meta.id`, `items[3].id`). */
  generated: string[];
}

export interface MarkdownSetSerializeOptions {
  /**
   * Heading level of notes (1–6). Default `'auto'`: the highest of 3, 2, 1 that can
   * represent all note content (content headings are shifted and must stay ≤ level 6).
   */
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
const HIDDEN_CALLOUT_RE = /^>\s?\[!hidden\][+-]?(?:\s.*)?$/i;
const META_COMMENT_START_RE = /^<!--\s*oqse:(.*)$/;
const BLANK_RE = /^\s*$/;
const BOM = String.fromCharCode(0xfeff);

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
  const source = markdown.startsWith(BOM) ? markdown.slice(1) : markdown;
  const all = splitLines(source).map((text, i) => ({ text, no: i + 1 }));
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
    throw new MarkdownSetError('Frontmatter must contain the OQSE version, e.g. oqse: "0.3".', { line: 2 });
  }
  const level = front.noteHeadingLevel ?? DEFAULT_NOTE_HEADING_LEVEL;
  if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 6) {
    throw new MarkdownSetError('noteHeadingLevel must be an integer from 1 to 6.', { line: 2 });
  }
  const noteLevel = level as number;
  const chapterLevel = noteLevel - 1; // 0 = no chapters
  const titleLevel = noteLevel - 2; // ≤ 0 = no title heading
  if ('description' in front) {
    throw new MarkdownSetError('Write the set description as text after the title, not in the frontmatter.', { line: 2 });
  }

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(front)) {
    if (!(FORMAT_KEYS as readonly string[]).includes(key)) meta[key] = value;
  }

  // --- Body structure ----------------------------------------------------------
  const body = all.slice(closing + 1);
  const structural = findHeadings(body.map((l) => l.text)).filter((h) => h.level <= noteLevel);
  const lineOf = (h: { index: number }) => body[h.index].no;

  for (const h of structural) {
    if (h.level < Math.max(1, titleLevel)) {
      throw new MarkdownSetError(
        `Heading level ${h.level} is not allowed with noteHeadingLevel ${noteLevel} (${describeLevels(noteLevel)}).`,
        { line: lineOf(h) },
      );
    }
  }

  // Optional set title heading: at most one, before any chapter or note.
  let rest = structural;
  let descriptionStart = 0;
  if (titleLevel >= 1 && structural.some((h) => h.level === titleLevel)) {
    const titleHeading = structural[0];
    if (titleHeading.level !== titleLevel) {
      throw new MarkdownSetError('The set title heading must come before all chapters and notes.', { line: lineOf(structural.find((h) => h.level === titleLevel)!) });
    }
    const second = structural.slice(1).find((h) => h.level === titleLevel);
    if (second) throw new MarkdownSetError('Only one set title heading is allowed.', { line: lineOf(second) });
    const before = body.slice(0, titleHeading.index).find((l) => !BLANK_RE.test(l.text));
    if (before) throw new MarkdownSetError('Text before the set title heading is not allowed.', { line: before.no });
    if (meta.title !== undefined && meta.title !== titleHeading.text) {
      throw new MarkdownSetError(`The title heading "${titleHeading.text}" differs from "title" in the frontmatter.`, { line: lineOf(titleHeading) });
    }
    meta.title = titleHeading.text;
    rest = structural.slice(1);
    descriptionStart = titleHeading.index + 1;
  }

  if (!rest.some((h) => h.level === noteLevel) && rest.length > 0) {
    throw new MarkdownSetError(
      `No note headings found (${describeLevels(noteLevel)}). Set noteHeadingLevel in the frontmatter if your notes use a different level.`,
      { line: lineOf(rest[0]) },
    );
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const key of ['id', 'createdAt', 'updatedAt'] as const) {
    if (meta[key] === undefined) {
      meta[key] = key === 'id' ? generateUUID() : now;
      generated.push(`meta.${key}`);
    }
  }

  const descriptionEnd = rest[0]?.index ?? body.length;
  const description = trimBlankLines(body.slice(descriptionStart, descriptionEnd).map((l) => l.text).join('\n'));
  if (description !== '') meta.description = description;

  // --- Chapters and notes --------------------------------------------------------
  const items: Record<string, unknown>[] = [];
  const noteLines: number[] = [];
  let topic: string | undefined;

  rest.forEach((heading, n) => {
    const end = rest[n + 1]?.index ?? body.length;
    const section = body.slice(heading.index + 1, end);

    if (heading.level === chapterLevel) {
      const stray = section.find((l) => !BLANK_RE.test(l.text));
      if (stray) {
        throw new MarkdownSetError('Text under a chapter heading must belong to a note (add a note heading).', { line: stray.no });
      }
      topic = heading.text || undefined;
      return;
    }

    const note = parseNoteSection(section, heading.text, noteLevel, lineOf(heading));
    if (topic !== undefined && chapterLevel >= 1) note.topic = topic;
    if (note.id === undefined) {
      note.id = generateUUID();
      generated.push(`items[${items.length}].id`);
    }
    items.push(note);
    noteLines.push(lineOf(heading));
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
  const body = section.slice(start);
  const scan = scanTopLevel(body.map((l) => l.text));
  let contentLines = body;
  let hiddenLines: string[] | undefined;

  if (scan.hiddenCallouts.length > 1) {
    throw new MarkdownSetError(`Only one "> ${HIDDEN_CALLOUT_MARKER}" callout is allowed per note.`, { line: body[scan.hiddenCallouts[1]].no });
  }
  if (scan.hiddenCallouts.length === 1) {
    const at = scan.hiddenCallouts[0];
    if (at > 0 && !BLANK_RE.test(body[at - 1].text)) {
      throw new MarkdownSetError(`The "> ${HIDDEN_CALLOUT_MARKER}" callout must be preceded by a blank line.`, { line: body[at].no });
    }
    let end = body.length;
    while (end > at + 1 && BLANK_RE.test(body[end - 1].text)) end--;
    for (let i = at + 1; i < end; i++) {
      if (!body[i].text.startsWith('>')) {
        throw new MarkdownSetError(
          `The "> ${HIDDEN_CALLOUT_MARKER}" callout must be the last block of the note and every line in it must start with ">".`,
          { line: body[i].no },
        );
      }
    }
    contentLines = body.slice(0, at);
    hiddenLines = body.slice(at + 1, end).map((l) => l.text.replace(/^> ?/, ''));
  }

  // Headings inside the note are relative to it (JSON: note title = level 1).
  const shift = -(noteLevel - 1);
  const { id, type: _type, ...other } = fields;
  const note: Record<string, unknown> = { id, type: 'note' };
  if (title !== '') note.title = title;
  Object.assign(note, other);
  note.content = shiftHeadings(trimBlankLines(contentLines.map((l) => l.text).join('\n')), shift);
  const hidden = hiddenLines === undefined ? '' : shiftHeadings(trimBlankLines(hiddenLines.join('\n')), shift);
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

  // Content headings are relative to the note (title = level 1), so they must start at level 2.
  const noteHeadingLevels = notes.flatMap((n, i) => {
    const levels = [n.content, n.hiddenContent ?? ''].flatMap((t) => findHeadings(splitLines(t)).map((h) => h.level));
    if (levels.includes(1)) {
      throw new MarkdownSetError(`items[${i}] contains a level-1 heading; headings inside a note must start at level 2 (the note title is level 1).`);
    }
    return levels;
  });
  const maxContentLevel = Math.max(1, ...noteHeadingLevels);
  const descriptionLevels = findHeadings(splitLines(description ?? '')).map((h) => h.level);
  const fits = (level: number) => maxContentLevel + level - 1 <= 6 && descriptionLevels.every((d) => d > level);

  let noteLevel: number;
  if (options.noteHeadingLevel === undefined || options.noteHeadingLevel === 'auto') {
    const candidate = [3, 2, 1].find(fits);
    if (candidate === undefined) throw new MarkdownSetError('Note content or description headings are too deep to be represented.');
    noteLevel = candidate;
  } else {
    noteLevel = options.noteHeadingLevel;
    if (!Number.isInteger(noteLevel) || noteLevel < 1 || noteLevel > 6) throw new MarkdownSetError('noteHeadingLevel must be an integer from 1 to 6.');
    if (!fits(noteLevel)) throw new MarkdownSetError(`noteHeadingLevel ${noteLevel} cannot represent the headings in the content; use a lower level.`);
  }
  const chapterLevel = noteLevel - 1;
  const titleLevel = noteLevel - 2;
  const shift = noteLevel - 1;

  // Frontmatter (the title goes to a heading when the level allows it).
  const front: Record<string, unknown> = { oqse: file.version };
  if (noteLevel !== DEFAULT_NOTE_HEADING_LEVEL) front.noteHeadingLevel = noteLevel;
  const { id, title, language, ...restMeta } = meta;
  Object.assign(front, titleLevel >= 1 ? { id, language } : { id, title, language }, restMeta);
  let out = `${FRONTMATTER_DELIMITER}\n${stringifyYaml(front, { lineWidth: 0 })}${FRONTMATTER_DELIMITER}\n`;
  if (titleLevel >= 1) {
    assertSingleLine(title, 'meta.title');
    out += `${'#'.repeat(titleLevel)} ${title}\n`;
  }
  if (description) out += `${titleLevel >= 1 ? '\n' : ''}${trimBlankLines(description)}\n`;

  let topic: string | undefined;
  notes.forEach((note, i) => {
    const where = `items[${i}]`;
    const { id: noteId, type: _t, title: noteTitle, content, hiddenContent, topic: noteTopic, ...restNote } = note;

    if (chapterLevel >= 1 && noteTopic !== topic) {
      assertSingleLine(noteTopic, `${where}.topic`);
      out += `\n${'#'.repeat(chapterLevel)}${noteTopic ? ` ${noteTopic}` : ''}\n`;
      topic = noteTopic;
    }

    assertSingleLine(noteTitle, `${where}.title`);
    if (noteTitle && /(^|\s)#+\s*$/.test(noteTitle)) throw new MarkdownSetError(`${where}.title must not end with "#".`);
    out += `\n${'#'.repeat(noteLevel)}${noteTitle ? ` ${noteTitle}` : ''}\n`;

    const fields: Record<string, unknown> = { id: noteId, ...restNote };
    if (chapterLevel < 1 && noteTopic !== undefined) fields.topic = noteTopic;
    out += `${metadataComment(fields, where)}\n`;

    const contentLines = splitLines(shiftHeadings(trimBlankLines(content), shift));
    const scan = scanTopLevel(contentLines);
    if (scan.hiddenCallouts.length > 0) {
      throw new MarkdownSetError(`${where}.content must not contain a top-level "> ${HIDDEN_CALLOUT_MARKER}" callout; use hiddenContent.`);
    }
    if (scan.unclosedFence) throw new MarkdownSetError(`${where}.content ends inside an unclosed code fence.`);
    out += `${contentLines.join('\n')}\n`;

    const hidden = hiddenContent === undefined ? '' : shiftHeadings(trimBlankLines(hiddenContent), shift);
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

function describeLevels(noteLevel: number): string {
  const h = (level: number) => '#'.repeat(level);
  const parts = [];
  if (noteLevel >= 3) parts.push(`${h(noteLevel - 2)} set title`);
  if (noteLevel >= 2) parts.push(`${h(noteLevel - 1)} chapters`);
  parts.push(`${h(noteLevel)} notes`);
  return parts.join(', ');
}

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

/** Top-level `> [!hidden]` callout lines and whether the text ends inside an open fence. */
function scanTopLevel(lines: string[]): { hiddenCallouts: number[]; unclosedFence: boolean } {
  const hiddenCallouts: number[] = [];
  const unclosedFence = forEachTopLevelLine(lines, (line, index) => {
    if (HIDDEN_CALLOUT_RE.test(line)) hiddenCallouts.push(index);
  });
  return { hiddenCallouts, unclosedFence };
}
