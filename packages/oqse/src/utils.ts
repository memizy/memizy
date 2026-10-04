import type { ZodError } from 'zod';
import { v7 as uuidv7, validate as uuidValidate } from 'uuid';

export type UUID = string;

/**
 * Validates if the given string is a syntactically valid UUID (any version).
 * Uses the robust validator from the 'uuid' package.
 */
export function isValidUUID(id: string): boolean {
  return uuidValidate(id);
}

/**
 * Generates a new UUIDv7.
 * UUIDv7 is required by the OQSE specification for new items 
 * because it is time-sortable and optimized for database indexing.
 */
export function generateUUID(): UUID {
  return uuidv7();
}

/**
 * Checks if an object exceeds the maximum allowed nesting depth.
 * OQSE specification requires a limit of 10 levels for customData and appSpecific.
 */
export function validateJsonDepth(
  data: unknown,
  maxDepth: number = 10,
  currentDepth: number = 0
): void {
  if (currentDepth > maxDepth) {
    throw new Error(
      `OQSE Security Error: Maximum nesting depth exceeded limit of ${maxDepth} levels.`
    );
  }

  if (data !== null && typeof data === 'object') {
    const values = Array.isArray(data) ? data : Object.values(data);
    for (const value of values) {
      validateJsonDepth(value, maxDepth, currentDepth + 1);
    }
  }
}

/**
 * Formats a ZodError into a flat array of human-readable string messages.
 * Useful for displaying validation issues in UI lists or console logs.
 */
export function formatOQSEErrors(error: ZodError): string[] {
  return error.issues.map(err => {
    let pathStr = '';
    err.path.forEach((part, index) => {
      if (typeof part === 'number') {
        pathStr += `[${part}]`;
      } else {
        const isFirstOrAfterNumber = index === 0 || typeof err.path[index - 1] === 'number';
        pathStr += (isFirstOrAfterNumber ? '' : '.') + String(part);
      }
    });
    return pathStr ? `${pathStr}: ${err.message}` : err.message;
  });
}