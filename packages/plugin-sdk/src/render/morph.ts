/**
 * Minimal DOM morphing: updates `root` to match an HTML string while keeping
 * existing elements (focus, caret, typed text, scroll position, running media).
 *
 * Rules:
 *  - children are matched by `id` / `data-key` when present, otherwise by position and tag;
 *  - what the user typed or checked is kept unless the plugin changes the `value` / `checked`
 *    attribute in its HTML (and a focused field is never overwritten);
 *  - elements already enhanced (`data-mz-rendered` === new `data-mz-src`) are kept as they are;
 *  - an element with `data-keep` (in both the page and the new HTML) is kept as it is, with
 *    everything the plugin put into it (a canvas, a WebGL scene…).
 */

export function morph(root: Element, html: string): void {
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = html;
  morphChildren(root, template.content);
}

function keyOf(node: Node): string | null {
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  return el.getAttribute('data-key') ?? (el.id || null);
}

function sameKind(a: Node, b: Node): boolean {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);
}

function morphChildren(from: ParentNode & Node, to: ParentNode & Node): void {
  const target = [...to.childNodes];
  const targetKeys = new Set(target.map(keyOf).filter((key): key is string => key !== null));

  // Keyed children that disappear are removed first, so the ones after them stay where
  // they are (moving a node in the DOM takes the focus away from an input inside it).
  for (const child of [...from.childNodes]) {
    const key = keyOf(child);
    if (key !== null && !targetKeys.has(key)) from.removeChild(child);
  }

  // Existing keyed children, so they can be moved instead of recreated.
  const keyed = new Map<string, Node>();
  for (const child of from.childNodes) {
    const key = keyOf(child);
    if (key !== null) keyed.set(key, child);
  }

  for (let i = 0; i < target.length; i++) {
    const wanted = target[i];
    const key = keyOf(wanted);
    let current: Node | null = from.childNodes[i] ?? null;

    if (key !== null) {
      const match = keyed.get(key);
      if (match && match !== current && sameKind(match, wanted)) {
        // Moving a node takes the focus away from an input inside it. When the match is
        // further on and only nodes that are not needed elsewhere are in the way
        // (whitespace, unkeyed elements), remove them instead.
        let between: Node | null = current;
        while (between && between !== match && !(keyOf(between) !== null && targetKeys.has(keyOf(between)!))) between = between.nextSibling;
        if (between === match) {
          while (from.childNodes[i] !== match) from.removeChild(from.childNodes[i]);
        } else {
          from.insertBefore(match, current);
        }
        current = match;
      }
    }

    if (!current) {
      from.appendChild(adopt(from, wanted));
    } else if (sameKind(current, wanted)) {
      morphNode(current, wanted);
    } else if (keyOf(current) !== null && targetKeys.has(keyOf(current)!)) {
      // A new element appears before a keyed one that stays: insert it, do not replace.
      from.insertBefore(adopt(from, wanted), current);
    } else {
      from.replaceChild(adopt(from, wanted), current);
    }
  }

  while (from.childNodes.length > target.length) from.removeChild(from.lastChild!);
}

function adopt(parent: Node, node: Node): Node {
  return (parent.ownerDocument ?? (parent as Document)).importNode(node, true);
}

function morphNode(from: Node, to: Node): void {
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  if (from.nodeType !== 1) return;
  const fromEl = from as HTMLElement;
  const toEl = to as HTMLElement;

  // Enhanced content (math, diagrams) that has not changed.
  const src = toEl.getAttribute('data-mz-src');
  if (src !== null && fromEl.getAttribute('data-mz-rendered') === src) return;
  // Content owned by the plugin's own code (canvas, 3D scene).
  if (fromEl.hasAttribute('data-keep') && toEl.hasAttribute('data-keep')) return;

  const previous = { value: fromEl.getAttribute('value'), checked: fromEl.hasAttribute('checked'), selected: fromEl.hasAttribute('selected'), text: fromEl.tagName === 'TEXTAREA' ? fromEl.textContent : null };
  morphAttributes(fromEl, toEl);
  morphFormState(fromEl, toEl, previous);

  if (fromEl.tagName === 'TEXTAREA') return; // its content is its value
  morphChildren(fromEl, toEl);
}

function morphAttributes(from: Element, to: Element): void {
  for (const attr of [...from.attributes]) {
    if (!to.hasAttribute(attr.name) && attr.name !== 'data-mz-rendered') from.removeAttribute(attr.name);
  }
  for (const attr of [...to.attributes]) {
    if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
  }
}

function morphFormState(from: HTMLElement, to: HTMLElement, previous: { value: string | null; checked: boolean; selected: boolean; text: string | null }): void {
  const focused = from.ownerDocument.activeElement === from;
  if (from instanceof HTMLInputElement && to instanceof HTMLInputElement) {
    if (from.type === 'checkbox' || from.type === 'radio') {
      const checked = to.hasAttribute('checked');
      if (checked !== previous.checked) from.checked = checked;
    } else {
      const value = to.getAttribute('value');
      if (value !== previous.value && !focused) from.value = value ?? '';
    }
  } else if (from instanceof HTMLTextAreaElement && to instanceof HTMLTextAreaElement) {
    const text = to.textContent ?? '';
    if (text !== previous.text) {
      from.textContent = text;
      if (!focused) from.value = text;
    }
  } else if (from instanceof HTMLOptionElement && to instanceof HTMLOptionElement) {
    const selected = to.hasAttribute('selected');
    if (selected !== previous.selected) from.selected = selected;
  }
}
