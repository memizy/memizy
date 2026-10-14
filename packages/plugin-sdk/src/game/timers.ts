/**
 * A short timeout that is not slowed down in a hidden tab. Browsers run `setTimeout` of
 * a hidden page at most once a second; when the host's tab is hidden for a moment, the
 * authority's state updates would wait that long. While the page is hidden, the delay is
 * measured with MessageChannel messages, which browsers do not throttle (only for short
 * delays such as the ~16-40 ms batching of state updates). Visible pages use setTimeout.
 */

export function shortTimeout(fn: () => void, delayMs: number, doc: Document | undefined = globalThis.document): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  const timer = setTimeout(run, delayMs);
  let port: MessagePort | null = null;
  if (doc?.visibilityState === 'hidden' && typeof MessageChannel === 'function') {
    const channel = new MessageChannel();
    const due = Date.now() + delayMs;
    port = channel.port2;
    channel.port1.onmessage = () => {
      if (done) return channel.port1.close();
      if (Date.now() >= due) {
        channel.port1.close();
        run();
      } else port?.postMessage(null);
    };
    port.postMessage(null);
  }
  return () => {
    done = true;
    clearTimeout(timer);
    port?.close();
  };
}
