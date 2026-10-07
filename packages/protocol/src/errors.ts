/**
 * Protocol errors (SPEC section 8.2).
 *
 * Errors cross the iframe boundary through Penpal, which keeps only the
 * error `name` and `message`. The code is therefore also encoded in the
 * message as `[CODE] text`, and {@link toProtocolError} restores it.
 */

export const PROTOCOL_ERROR_CODES = [
  'UNSUPPORTED_PROTOCOL',
  'INVALID_ARGUMENT',
  'NOT_AUTHORITY',
  'NOT_ALLOWED_IN_VIEW',
  'AUTHORITY_UNAVAILABLE',
  'MESSAGE_TOO_LARGE',
  'SNAPSHOT_TOO_LARGE',
  'DATA_TOO_LARGE',
  'RATE_LIMITED',
  'ASSET_NOT_FOUND',
  'SESSION_ENDED',
  'INTERNAL_ERROR',
  /** RC4: the service is not offered by this host (or not declared by the plugin). */
  'SERVICE_UNAVAILABLE',
] as const;

export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

const CODE_PREFIX_RE = /^\[([A-Z_]+)\]\s?/;

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ProtocolError';
    this.code = code;
  }

  /** The message without the `[CODE]` prefix. */
  get detail(): string {
    return this.message.replace(CODE_PREFIX_RE, '');
  }
}

export function isProtocolErrorCode(value: unknown): value is ProtocolErrorCode {
  return typeof value === 'string' && (PROTOCOL_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Converts anything thrown by a remote call into a {@link ProtocolError}.
 * Unknown codes and foreign errors become `INTERNAL_ERROR` (SPEC 8.2).
 */
export function toProtocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const match = CODE_PREFIX_RE.exec(message);
  const code = match && isProtocolErrorCode(match[1]) ? match[1] : 'INTERNAL_ERROR';
  return new ProtocolError(code, match ? message.slice(match[0].length) : message);
}
