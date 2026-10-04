/**
 * Mounting a plugin instance into a sandboxed iframe (SPEC 4 and 8.4) and
 * connecting it to a session with Penpal. Includes a small overlay for the
 * countdown and "waiting for the host".
 */

import { WindowMessenger, connect } from 'penpal';
import { LIMITS, PLUGIN_API_METHODS, toProtocolError, type HostApi, type PluginApi } from '@memizy/protocol';
import type { LocalSession, SessionInstance } from './session';

/** Never add `allow-same-origin`: the plugin must not reach the app's origin. */
export const PLUGIN_SANDBOX = 'allow-scripts allow-forms allow-modals allow-pointer-lock';

export interface MountOptions {
  /** Text overrides (default: Czech or English by the session locale). */
  texts?: { waitingForHost?: string; countdown?: (seconds: number) => string };
  /** Show the built-in overlays (default `true`). */
  overlays?: boolean;
}

export interface MountedPlugin {
  readonly instance: SessionInstance;
  readonly iframe: HTMLIFrameElement;
  /** Removes the iframe and disconnects the instance. */
  unmount(): void;
}

/** Makes every plugin call reject with a `ProtocolError`. */
function wrapPlugin(remote: PluginApi): PluginApi {
  const wrapped = {} as Record<string, unknown>;
  for (const method of PLUGIN_API_METHODS) {
    wrapped[method] = async (...args: unknown[]) => {
      try {
        return await (remote[method] as (...a: unknown[]) => Promise<void>)(...args);
      } catch (error) {
        throw toProtocolError(error);
      }
    };
  }
  return wrapped as unknown as PluginApi;
}

export interface PluginFrame {
  readonly iframe: HTMLIFrameElement;
  /** Resolves when the plugin has connected (Penpal handshake). */
  readonly plugin: Promise<PluginApi>;
  /** Closes the connection (the caller removes the iframe). */
  destroy(): void;
}

/**
 * Creates a sandboxed iframe with the plugin HTML and connects it to `hostApi`.
 * The iframe must be inserted into the document by the caller (right away).
 */
export function createPluginFrame(html: string, title: string, hostApi: HostApi, doc: Document = document): PluginFrame {
  const iframe = doc.createElement('iframe');
  iframe.setAttribute('sandbox', PLUGIN_SANDBOX);
  iframe.setAttribute('title', title);
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
  iframe.srcdoc = html;
  let connection: ReturnType<typeof connect<PluginApi & Record<string, any>>> | null = null;
  const plugin = new Promise<PluginApi>((resolve, reject) => {
    // contentWindow exists only once the iframe is in the document.
    queueMicrotask(() => {
      if (!iframe.contentWindow) {
        reject(new Error('The plugin iframe is not in the document.'));
        return;
      }
      connection = connect<PluginApi & Record<string, any>>({
        messenger: new WindowMessenger({ remoteWindow: iframe.contentWindow, allowedOrigins: ['*'] }),
        methods: hostApi as unknown as Record<string, (...args: any[]) => any>,
        timeout: LIMITS.helloTimeoutMs,
      });
      connection.promise.then((remote) => resolve(wrapPlugin(remote as unknown as PluginApi)), reject);
    });
  });
  return {
    iframe,
    plugin,
    destroy: () => connection?.destroy(),
  };
}

/**
 * Mounts the session's plugin for `address` into `container` and connects it.
 * Calling it again for the same address replaces the instance (reload).
 */
export async function mountPlugin(session: LocalSession, address: string, container: HTMLElement, options: MountOptions = {}): Promise<MountedPlugin> {
  const doc = container.ownerDocument;
  const cs = session.config.locale.startsWith('cs');
  const texts = {
    waitingForHost: options.texts?.waitingForHost ?? (cs ? 'Čekáme na hostitele…' : 'Waiting for the host…'),
    countdown: options.texts?.countdown ?? ((s: number) => String(s)),
  };

  const wrapper = doc.createElement('div');
  wrapper.className = 'mz-host-frame';
  wrapper.style.cssText = 'position:relative;width:100%;height:100%;';
  const overlay = doc.createElement('div');
  overlay.className = 'mz-host-overlay';
  overlay.style.cssText =
    'position:absolute;inset:0;display:none;place-items:center;background:rgba(0,0,0,.55);color:#fff;font:600 1.5rem system-ui,sans-serif;text-align:center;padding:16px;';
  let iframe: HTMLIFrameElement | null = null;
  let destroyConnection: (() => void) | null = null;
  container.appendChild(wrapper);

  const show = (text: string | null) => {
    if (options.overlays === false) return;
    overlay.textContent = text ?? '';
    overlay.style.display = text ? 'grid' : 'none';
  };

  const stopListening = session.on((event) => {
    if (event.type === 'countdown') show(texts.countdown(event.secondsLeft));
    else if (event.type === 'started') show(null);
    else if (event.type === 'authority' && address !== session.authority) show(event.connected ? null : texts.waitingForHost);
    else if (event.type === 'resize' && event.address === address) wrapper.style.height = event.height === 'auto' ? '' : `${event.height}px`;
  });

  const endpoint = async (hostApi: HostApi): Promise<PluginApi> => {
    destroyConnection?.();
    iframe?.remove();
    const frame = createPluginFrame(session.plugin.html, session.plugin.manifest.appName, hostApi, doc);
    iframe = frame.iframe;
    wrapper.replaceChildren(iframe, overlay);
    destroyConnection = frame.destroy;
    return frame.plugin;
  };

  const instance = await session.connect(address, endpoint, {
    onDispose: () => {
      destroyConnection?.();
      destroyConnection = null;
    },
  });

  return {
    instance,
    get iframe() {
      return iframe!;
    },
    unmount() {
      stopListening();
      session.disconnect(address);
      wrapper.remove();
    },
  };
}
