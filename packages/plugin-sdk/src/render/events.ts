/**
 * Event delegation for the HTML returned by render functions:
 *  - `<button data-act="answer" data-payload='{"answer":2}'>` → action `answer` with `{ answer: 2 }`
 *  - `<form data-act="submitText">` → action `submitText` with the form fields, then the form is reset
 *  - `<input data-setting="questionTime">` → setting change (settings screen)
 */

export interface EventHandlers {
  act(name: string, payload: unknown): void;
  setting?(id: string, value: string | number | boolean): void;
  error(message: string): void;
}

export function bindEvents(root: HTMLElement, handlers: EventHandlers): () => void {
  const onClick = (event: Event) => {
    const el = (event.target as Element | null)?.closest?.('[data-act]');
    if (!el || !root.contains(el) || el.tagName === 'FORM') return;
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    const raw = el.getAttribute('data-payload');
    let payload: unknown = null;
    if (raw !== null && raw !== '') {
      try {
        payload = JSON.parse(raw);
      } catch {
        handlers.error(`data-payload of "${el.getAttribute('data-act')}" is not valid JSON: ${raw}`);
        return;
      }
    }
    handlers.act(el.getAttribute('data-act')!, payload);
  };

  const onSubmit = (event: Event) => {
    const form = event.target as HTMLFormElement;
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
