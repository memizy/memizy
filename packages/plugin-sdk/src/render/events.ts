/**
 * Event delegation for the HTML returned by render functions:
 *  - `<button data-act="answer" data-payload='{"answer":2}'>` → action `answer` with `{ answer: 2 }`
 *  - `<form data-act="submitText">` → action `submitText` with the form fields, then the form is reset
 *  - `<button data-local="tab" data-payload='"map"'>` → device-only handler `local.tab` with `"map"`
 *  - `<input data-setting="questionTime">` → setting change (settings screen)
 */

export interface EventHandlers {
  act(name: string, payload: unknown): void;
  /** A `data-local` click (device-only handler). */
  local?(name: string, payload: unknown): void;
  setting?(id: string, value: string | number | boolean): void;
  /** A click / change inside `ui.question` controls (`data-mzq`), or `clear` after its answer was sent. */
  question?(event: Record<string, unknown>): void;
  error(message: string): void;
}

/** The answer typed into a `ui.question` form (`data-answer-from`). */
function typedAnswer(button: Element): unknown {
  const root = button.closest('[data-mzq-root]') ?? button.closest('form') ?? button.parentElement;
  const from = button.getAttribute('data-answer-from');
  if (!root) return null;
  if (from === 'blanks') {
    const blanks: Record<string, string> = {};
    root.querySelectorAll<HTMLInputElement>('[data-blank]').forEach((input) => (blanks[input.getAttribute('data-blank')!] = input.value));
    return blanks;
  }
  const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>('[name="answer"]');
  return field ? field.value.trim() : '';
}

export function bindEvents(root: HTMLElement, handlers: EventHandlers): () => void {
  const questionEvent = (el: Element, extra: Record<string, unknown> = {}) => {
    try {
      handlers.question?.({ ...JSON.parse(el.getAttribute('data-mzq')!), ...extra });
    } catch {
      /* not ours */
    }
  };

  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    const q = target?.closest?.('[data-mzq]');
    if (q && root.contains(q) && q.tagName !== 'SELECT' && q.tagName !== 'INPUT') {
      if ((q as HTMLButtonElement).disabled || q.hasAttribute('disabled')) return;
      event.preventDefault();
      if (q.classList.contains('mz-q-pinboard')) {
        const rect = q.getBoundingClientRect();
        const e = event as MouseEvent;
        if (!rect.width || !rect.height) return;
        questionEvent(q, { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 });
      } else questionEvent(q);
      return;
    }
    const el = target?.closest?.('[data-act],[data-local]');
    if (!el || !root.contains(el) || el.tagName === 'FORM') return;
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    if (el.hasAttribute('data-local')) {
      const payload = readPayload(el, el.getAttribute('data-local')!);
      if (payload !== INVALID) handlers.local?.(el.getAttribute('data-local')!, payload);
      return;
    }
    dispatch(el);
  };

  const INVALID = Symbol('invalid');
  /** The JSON of `data-payload` (null without it). */
  const readPayload = (el: Element, name: string): unknown => {
    const raw = el.getAttribute('data-payload');
    if (raw === null || raw === '') return null;
    try {
      return JSON.parse(raw);
    } catch {
      handlers.error(`data-payload of "${name}" is not valid JSON: ${raw}`);
      return INVALID;
    }
  };

  /** Runs the action of a `data-act` element (also the submit button of a question form). */
  const dispatch = (el: Element) => {
    let payload = readPayload(el, el.getAttribute('data-act')!);
    if (payload === INVALID) return;
    if (el.hasAttribute('data-answer-from')) {
      const answer = typedAnswer(el);
      if (answer === '' || answer === null) return; // nothing typed yet
      payload = { ...((payload as Record<string, unknown>) ?? {}), answer };
    }
    handlers.act(el.getAttribute('data-act')!, payload);
    const questionRoot = el.closest('[data-mzq-root]');
    if (questionRoot) handlers.question?.({ q: questionRoot.getAttribute('data-mzq-root'), op: 'clear' });
  };

  const onSubmit = (event: Event) => {
    const form = event.target as HTMLFormElement;
    if (form instanceof HTMLFormElement && form.hasAttribute('data-mzq-form') && root.contains(form)) {
      event.preventDefault();
      const button = form.querySelector('[data-act]');
      if (button && !(button as HTMLButtonElement).disabled) dispatch(button);
      return;
    }
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-act') || !root.contains(form)) return;
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const [name, value] of new FormData(form)) {
      if (typeof value !== 'string') continue;
      if (name in payload) {
        const existing = payload[name];
        payload[name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        payload[name] = value;
      }
    }
    handlers.act(form.getAttribute('data-act')!, payload);
    form.reset();
  };

  const onInput = (event: Event) => {
    const el = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (el?.hasAttribute?.('data-mzq') && root.contains(el)) {
      // Selects on change, sliders while moving.
      if (el instanceof HTMLSelectElement ? event.type === 'change' : event.type === 'input') questionEvent(el, { value: el.value });
      return;
    }
    const id = el?.getAttribute?.('data-setting');
    if (!id || !handlers.setting || !root.contains(el)) return;
    const isToggle = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio');
    // Text-like inputs update on every keystroke; toggles and selects on change.
    if (event.type === 'input' && (isToggle || el instanceof HTMLSelectElement)) return;
    if (event.type === 'change' && !isToggle && !(el instanceof HTMLSelectElement)) return;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') handlers.setting(id, el.checked);
    else if (el instanceof HTMLInputElement && el.type === 'radio') {
      if (el.checked) handlers.setting(id, el.value);
    } else if (el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'range')) {
      if (el.value !== '') handlers.setting(id, Number(el.value));
    } else handlers.setting(id, el.value);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('submit', onSubmit);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onInput);
  };
}
