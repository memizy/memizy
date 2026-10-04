/**
 * Where the multiplayer server runs. Production sets VITE_RELAY_URL
 * (e.g. https://mp.memizy.com); in development the server runs on port 8787
 * of the same machine, so phones on the LAN reach it too.
 */
export const RELAY_URL: string = import.meta.env.VITE_RELAY_URL || `${location.protocol}//${location.hostname}:8787`;

/** The public join link for a PIN (shown as a QR code). */
export function joinUrl(pin: string): string {
  return new URL(`${import.meta.env.BASE_URL}join/${pin}`, location.origin).href;
}
