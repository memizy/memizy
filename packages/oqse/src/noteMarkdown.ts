/**
 * OQSE Markdown Notes – lossless Markdown serialization of `note` items.
 *
 * A note is written as a plain Markdown file so that complex content
 * (Mermaid diagrams, LaTeX) never has to be escaped inside a JSON string:
 *
 * ```markdown
 * ---
 * id: 0192f0c4-7a1e-7c3b-9a52-2f1d8e4b6a10
 * title: First Law of Thermodynamics
 * tags:
 *   - physics
 * ---
 * Energy is conserved: $\Delta U = Q - W$
 *
 * > [!hidden]-
 * > Content revealed on demand (`hiddenContent`).
 * ```
 *
 * - YAML frontmatter holds every item property except `type`, `content` and `hiddenContent`.
 * - The body is `content`.
 * - An optional trailing `> [!hidden]` callout is `hiddenContent`
 *   (rendered natively as a collapsed callout in Obsidian).
 *
 * Leading and trailing blank lines of `content` and `hiddenContent` are not significant.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { NoteItem } from './oqse';
import { NoteItemSchema } from './oqseValidation';
import { formatOQSEErrors } from './utils';

/** Callout marker that introduces `hiddenContent` (case-insensitive when parsing). */
export const HIDDEN_CALLOUT_MARKER = '[!hidden]';

/** Error thrown when a Markdown note cannot be parsed or a note cannot be serialized. */
export class NoteMarkdownError extends Error {
  /** 1-based line number in the Markdown source, when known. */
  readonly line?: number;
  /** Validation issues of the resulting item (formatted with `formatOQSEErrors`). */
  readonly issues: string[];

  constructor(message: string, options: { line?: number; issues?: string[] } = {}) {
    super(options.line ? `Line ${options.line}: ${message}` : message);
    this.name = 'NoteMarkdownError';
    this.line = options.line;
    this.issues = options.issues ?? [];
  }
}

const FRONTMATTER_DELIMITER = '---';
const RESERVED_FRONTMATTER_KEYS = ['content', 'hiddenContent'] as const;
const HIDDEN_CALLOUT_RE = /^>\s?\[!hidden\][+-]?(?:\s.*)?$/i;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const BLANK_RE = /^\s*$/;

// ============================================================================
// Public API
// ============================================================================

/**
 * Serializes a `note` item to OQSE Markdown.
 * @throws {NoteMarkdownError} if the content cannot be represented losslessly.
 */
export function serializeNoteMarkdown(item: NoteItem): string {
  const { type: _type, content, hiddenContent, id, title, ...rest } = item;

  const contentLines = splitLines(trimBlankLines(content));
  const scan = scanTopLevel(contentLines);
  if (scan.hiddenCallouts.length > 0) {
    throw new NoteMarkdownError(
      `Content must not contain a top-level "> ${HIDDEN_CALLOUT_MARKER}" callout; use hiddenContent instead.`,
    );
  }
  if (scan.unclosedFence) {
    throw new NoteMarkdownError('Content ends inside an unclosed code fence.');
  }

  const frontmatter: Record<string, unknown> = { id };
  if (title !== undefined) frontmatter.title = title;
  Object.assign(frontmatter, rest);

  let markdown = `${FRONTMATTER_DELIMITER}\n${stringifyYaml(frontmatter, { lineWidth: 0 })}${FRONTMATTER_DELIMITER}\n`;
  if (contentLines.length > 0) markdown += `${contentLines.join('\n')}\n`;

  const hidden = hiddenContent === undefined ? '' : trimBlankLines(hiddenContent);
  if (hidden !== '') {
    const quoted = splitLines(hidden).map((line) => (line === '' ? '>' : `> ${line}`));
    markdown += `\n> ${HIDDEN_CALLOUT_MARKER}-\n${quoted.join('\n')}\n`;
  }

  return markdown;
}

/**
 * Parses OQSE Markdown into a validated `note` item.
 * @throws {NoteMarkdownError} on malformed Markdown or an invalid resulting item.
 */
export function parseNoteMarkdown(markdown: string): NoteItem {
  const lines = splitLines(markdown.replace(/^﻿/, ''));

  // --- Frontmatter -----------------------------------------------------------
  if (lines[0] !== FRONTMATTER_DELIMITER) {
    throw new NoteMarkdownError('Missing YAML frontmatter (the file must start with "---").', { line: 1 });
  }
  const closing = lines.indexOf(FRONTMATTER_DELIMITER, 1);
  if (closing === -1) {
    throw new NoteMarkdownError('Unterminated YAML frontmatter (missing closing "---").', { line: 1 });
  }

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(lines.slice(1, closing).join('\n'));
  } catch (e) {
    throw new NoteMarkdownError(`Invalid YAML frontmatter: ${(e as Error).message}`, { line: 2 });
  }
  if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new NoteMarkdownError('Frontmatter must be a YAML mapping (key: value).', { line: 2 });
  }
  const fields = frontmatter as Record<string, unknown>;
  for (const key of RESERVED_FRONTMATTER_KEYS) {
    if (key in fields) {
      throw new NoteMarkdownError(`"${key}" must not be in the frontmatter; it is taken from the Markdown body.`, { line: 2 });
    }
  }
  if ('type' in fields && fields.type !== 'note') {
    throw new NoteMarkdownError(`Only "note" items can be written as Markdown (got type "${String(fields.type)}").`, { line: 2 });
  }

  // --- Body ------------------------------------------------------------------
  const bodyStart = closing + 1;
  const body = lines.slice(bodyStart);
  const scan = scanTopLevel(body);
  const lineNo = (bodyIndex: number) => bodyStart + bodyIndex + 1;

  let contentLines = body;
  let hiddenLines: string[] | undefined;

  if (scan.hiddenCallouts.length > 1) {
    throw new NoteMarkdownError(`Only one "> ${HIDDEN_CALLOUT_MARKER}" callout is allowed.`, { line: lineNo(scan.hiddenCallouts[1]) });
  }
  if (scan.hiddenCallouts.length === 1) {
    const start = scan.hiddenCallouts[0];
    if (start > 0 && !BLANK_RE.test(body[start - 1])) {
      throw new NoteMarkdownError(`The "> ${HIDDEN_CALLOUT_MARKER}" callout must be preceded by a blank line.`, { line: lineNo(start) });
    }

    let end = body.length;
    while (end > start + 1 && BLANK_RE.test(body[end - 1])) end--;
    for (let i = start + 1; i < end; i++) {
      if (!body[i].startsWith('>')) {
        throw new NoteMarkdownError(
          `The "> ${HIDDEN_CALLOUT_MARKER}" callout must be the last block and every line in it must start with ">".`,
          { line: lineNo(i) },
        );
      }
    }

    contentLines = body.slice(0, start);
    hiddenLines = body.slice(start + 1, end).map((line) => line.replace(/^> ?/, ''));
  }

  const { id, ...rest } = fields;
  const item: Record<string, unknown> = { id, ...rest, type: 'note', content: trimBlankLines(contentLines.join('\n')) };
  const hidden = hiddenLines === undefined ? '' : trimBlankLines(hiddenLines.join('\n'));
  if (hidden !== '') item.hiddenContent = hidden;

  const result = NoteItemSchema.safeParse(item);
  if (!result.success) {
    const issues = formatOQSEErrors(result.error);
    throw new NoteMarkdownError(`Invalid note: ${issues.join('; ')}`, { issues });
  }
  return result.data as NoteItem;
}

/** Non-throwing variant of {@link parseNoteMarkdown}. */
export function safeParseNoteMarkdown(
  markdown: string,
): { success: true; data: NoteItem } | { success: false; error: NoteMarkdownError } {
  try {
    return { success: true, data: parseNoteMarkdown(markdown) };
  } catch (e) {
    if (e instanceof NoteMarkdownError) return { success: false, error: e };
    throw e;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Removes leading and trailing blank lines (and trailing whitespace). */
function trimBlankLines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}

/**
 * Finds top-level (outside fenced code blocks) `> [!hidden]` callout lines
 * and reports whether the text ends inside an open code fence.
 */
function scanTopLevel(lines: string[]): { hiddenCallouts: number[]; unclosedFence: boolean } {
  const hiddenCallouts: number[] = [];
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
    if (HIDDEN_CALLOUT_RE.test(line)) hiddenCallouts.push(index);
  });

  return { hiddenCallouts, unclosedFence: fence !== null };
}
