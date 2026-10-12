/**
 * Protocol version handling (SPEC section 4.3).
 */

/** The protocol version implemented by this package. */
export const PROTOCOL_VERSION = '1.0';

export interface ProtocolVersion {
  major: number;
  minor: number;
}

const VERSION_RE = /^(\d+)\.(\d+)$/;

/** Parses a `MAJOR.MINOR` version. Returns `null` for anything else. */
export function parseProtocolVersion(version: string): ProtocolVersion | null {
  const match = VERSION_RE.exec(version);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

/** Compares two `MAJOR.MINOR` versions (negative: a < b, 0: equal, positive: a > b). */
export function compareProtocolVersions(a: string, b: string): number {
  const va = parseProtocolVersion(a);
  const vb = parseProtocolVersion(b);
  if (!va || !vb) throw new Error(`Invalid protocol version: ${!va ? a : b}`);
  return va.major !== vb.major ? va.major - vb.major : va.minor - vb.minor;
}

/**
 * The protocol versions a host supports: one version, or one per MAJOR it supports
 * (e.g. `['1.4', '2.1']`, SPEC 4.3).
 */
export type HostProtocolVersions = string | readonly string[];

/** The host's version for the given MAJOR, or `null` when the host does not support it. */
function hostVersionFor(major: number, host: HostProtocolVersions): ProtocolVersion | null {
  for (const version of typeof host === 'string' ? [host] : host) {
    const parsed = parseProtocolVersion(version);
    if (parsed?.major === major) return parsed;
  }
  return null;
}

/**
 * Negotiates the version both sides use: the plugin's MAJOR (which the host must
 * support), the lower MINOR. Returns `null` when the host does not support that MAJOR
 * or a version is invalid.
 */
export function negotiateProtocolVersion(plugin: string, host: HostProtocolVersions): string | null {
  const vp = parseProtocolVersion(plugin);
  const vh = vp && hostVersionFor(vp.major, host);
  if (!vp || !vh) return null;
  return `${vp.major}.${Math.min(vp.minor, vh.minor)}`;
}

/**
 * Checks before loading the iframe whether a host can run a plugin whose
 * manifest requires `required` (SPEC 4.3): the host supports its MAJOR with a MINOR ≥
 * the required one.
 */
export function isProtocolSupported(required: string, host: HostProtocolVersions = PROTOCOL_VERSION): boolean {
  const vr = parseProtocolVersion(required);
  const vh = vr && hostVersionFor(vr.major, host);
  return !!vr && !!vh && vh.minor >= vr.minor;
}
