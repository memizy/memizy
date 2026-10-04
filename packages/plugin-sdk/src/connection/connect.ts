/**
 * Connection to the host: Penpal over postMessage inside an iframe
 * (SPEC section 4), or the standalone mock host when the page is opened directly.
 */

import { WindowMessenger, connect } from 'penpal';
import { LIMITS, ProtocolError, toProtocolError, HOST_API_METHODS, type Handshake, type HostApi, type InitPayload, type PluginApi } from '@memizy/protocol';

export interface HostConnection {
  host: HostApi;
  init: InitPayload;
  standalone: boolean;
  destroy(): void;
}

export type Connector = (pluginApi: PluginApi, handshake: Handshake) => Promise<HostConnection>;

/** Makes every host call reject with a `ProtocolError` (codes survive Penpal). */
export function wrapHost(remote: HostApi): HostApi {
  const wrapped = {} as Record<string, unknown>;
  for (const method of HOST_API_METHODS) {
    wrapped[method] = async (...args: unknown[]) => {
      try {
        return await (remote[method] as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (error) {
        throw toProtocolError(error);
      }
    };
  }
  return wrapped as unknown as HostApi;
}

/** Connects to the parent window (the Memizy host). */
export const iframeConnector: Connector = async (pluginApi, handshake) => {
  const messenger = new WindowMessenger({ remoteWindow: window.parent, allowedOrigins: ['*'] });
  const connection = connect<HostApi & Record<string, any>>({
    messenger,
    methods: pluginApi as unknown as Record<string, (...args: any[]) => any>,
    timeout: LIMITS.helloTimeoutMs,
  });
  const remote = await connection.promise;
  const host = wrapHost(remote as unknown as HostApi);
  const init = await host.hello(handshake);
  return { host, init, standalone: false, destroy: () => connection.destroy() };
};

export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent
  }
}

/**
 * Uses the iframe connection when embedded; otherwise (or when no host answers
 * within the hello deadline) falls back to `standalone`. A host that answers but
 * rejects the plugin (e.g. `UNSUPPORTED_PROTOCOL`) is an error, not a fallback.
 */
export function autoConnector(standalone: Connector): Connector {
  return async (pluginApi, handshake) => {
    if (isEmbedded()) {
      try {
        return await iframeConnector(pluginApi, handshake);
      } catch (error) {
        if (error instanceof ProtocolError) throw error;
        console.warn('[memizy] No Memizy host answered; running in standalone preview mode.', error);
      }
    }
    return standalone(pluginApi, handshake);
  };
}
