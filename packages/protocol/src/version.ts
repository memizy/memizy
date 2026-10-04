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
 * Negotiates the version both sides use: same MAJOR, the lower MINOR.
 * Returns `null` when the versions are incompatible (different MAJOR or invalid).
 */
export function negotiateProtocolVersion(plugin: string, host: string): string | null {
  const vp = parseProtocolVersion(plugin);
  const vh = parseProtocolVersion(host);
  if (!vp || !vh || vp.major !== vh.major) return null;
  return `${vp.major}.${Math.min(vp.minor, vh.minor)}`;
}

/**
 * Checks before loading the iframe whether a host can run a plugin whose
 * manifest requires `required` (SPEC 4.3): same MAJOR and host MINOR ≥ required MINOR.
 */
export function isProtocolSupported(required: string, host: string = PROTOCOL_VERSION): boolean {
  const vr = parseProtocolVersion(required);
  const vh = parseProtocolVersion(host);
  return !!vr && !!vh && vr.major === vh.major && vh.minor >= vr.minor;
}
