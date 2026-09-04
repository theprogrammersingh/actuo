/**
 * Pacing for a form an agent is filling in front of the user.
 *
 * The reason a tool drives the visible form instead of posting behind it is so
 * a person can watch it happen. Setting every field and submitting in the same
 * frame produces no frame in which the filled form is on screen — the result
 * looks exactly like the invisible POST it replaced. A short pause between
 * fields, and one before the save, is what makes it legible.
 *
 * Specs drive this at 0.
 */
export const AGENT_FILL_STAGGER_MS = 120;

/** A sleep that gives up promptly when the agent is stopped. */
export function agentPause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted.'));
      },
      { once: true },
    );
  });
}

/**
 * Set one control the way a person would, so the screen actually repaints.
 *
 * Both `input` and `change` are dispatched: a `<select>` and a date field need
 * `change`, and anything listening for typing needs `input`.
 */
export function setFieldValue(form: HTMLFormElement, name: string, value: string): void {
  const field = form.elements.namedItem(name);
  if (
    !(
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
    )
  ) {
    return;
  }
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
