import { describe, it, expect } from 'vitest';
import { StatsObjectSchema, LastAnswerObjectSchema, OQSEProgressSchema, safeValidateOQSEProgress } from './progressValidation';
import { formatOQSEErrors } from './utils';

describe('Progress Validation Schemas', () => {
  it('StatsObjectSchema: incorrect cannot be higher than attempts', () => {
    // Valid case
    expect(StatsObjectSchema.safeParse({ attempts: 5, incorrect: 2, streak: 3 }).success).toBe(true);
    
    // Invalid case
    const invalidStats = { attempts: 2, incorrect: 5, streak: 0 };
    const result = StatsObjectSchema.safeParse(invalidStats);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/incorrect cannot be higher than attempts/i);
    }
  });

  it('LastAnswerObjectSchema: defaults hintsUsed to 0 when omitted', () => {
    const result = LastAnswerObjectSchema.safeParse({
      isCorrect: true,
      answeredAt: '2025-01-01T00:00:00Z',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hintsUsed).toBe(0);
    }
  });

  it('OQSEProgressSchema: rejects non-UUID record keys', () => {
    const invalidFile = {
      version: "0.1",
      meta: {
        setId: "123e4567-e89b-12d3-a456-426614174000",
        exportedAt: "2025-01-01T00:00:00Z"
      },
      records: {
        "123e4567-e89b-12d3-a456-426614174000": {
          bucket: 1,
          stats: { attempts: 1, incorrect: 0, streak: 1 }
        },
        "invalid-key": {
          bucket: 1,
          stats: { attempts: 1, incorrect: 0, streak: 1 }
        }
      }
    };
    
    const result = OQSEProgressSchema.safeParse(invalidFile);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(issue => 
          issue.message.includes('UUID') || issue.message.includes('Invalid')
        )
      ).toBe(true);
    }
  });

  it('safeValidateOQSEProgress + formatOQSEErrors: returns readable issue list', () => {
    const result = safeValidateOQSEProgress({
      version: '0.1',
      meta: {
        setId: '123e4567-e89b-12d3-a456-426614174000',
      },
      records: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatOQSEErrors(result.error);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('meta.exportedAt'))).toBe(true);
    }
  });
});

