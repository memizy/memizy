/**
 * Small Markdown helpers shared by the OQSE Markdown format and the rich text renderer.
 * They only understand ATX headings and fenced code blocks (enough for OQSE's needs).
 */

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HEADING_PREFIX_RE = /^( {0,3})(#{1,6})(?=[ \t]|$)/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Shifts the level of all ATX headings outside fenced code blocks by `offset`
 * (clamped to 1–6). Useful for renderers that embed note content into their own layout.
 */
export function shiftHeadings(markdown: string, offset: number): string {
  if (offset === 0) return markdown;
  const lines = splitLines(markdown);
  forEachTopLevelLine(lines, (line, index) => {
    lines[index] = line.replace(HEADING_PREFIX_RE, (_m, indent: string, hashes: string) =>
      indent + '#'.repeat(Math.min(6, Math.max(1, hashes.length + offset))),
    );
  });
  return lines.join('\n');
}

/** @internal Splits text into lines, normalizing line endings. */
export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** @internal Removes leading and trailing blank lines (and trailing whitespace). */
export function trimBlankLines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}

/** @internal ATX headings outside fenced code blocks. */
export function findHeadings(lines: string[]): Array<{ index: number; level: number; text: string }> {
  const out: Array<{ index: number; level: number; text: string }> = [];
  forEachTopLevelLine(lines, (line, index) => {
    const m = HEADING_RE.exec(line);
    if (m) out.push({ index, level: m[1].length, text: (m[2] ?? '').trim() });
  });
  return out;
}

/** @internal Calls `visit` for lines outside fenced code blocks. Returns `true` if a fence is left open. */
export function forEachTopLevelLine(lines: string[], visit: (line: string, index: number) => void): boolean {
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
