import { describe, expect, it } from 'vitest';
import { OQSEHeaderSchema } from './headerValidation';

describe('OQSE Header Validation Schemas', () => {
  it('OQSEHeaderSchema: accepts a valid single header', () => {
    const result = OQSEHeaderSchema.safeParse({
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Biology - Cell Basics',
      language: 'en',
      updatedAt: '2026-04-19T10:15:00Z',
      url: 'https://cdn.example.org/sets/biology-cells.oqse.json',
      description: 'A compact intro to cells',
      tags: ['biology', 'cells'],
    });

    expect(result.success).toBe(true);
  });

  it('OQSEHeaderSchema: requires url and enforces absolute URL', () => {
    const missingUrl = OQSEHeaderSchema.safeParse({
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Biology - Cell Basics',
      language: 'en',
      updatedAt: '2026-04-19T10:15:00Z',
    });
    expect(missingUrl.success).toBe(false);

    const relativeUrl = OQSEHeaderSchema.safeParse({
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Biology - Cell Basics',
      language: 'en',
      updatedAt: '2026-04-19T10:15:00Z',
      url: '/sets/biology-cells.oqse.json',
    });
    expect(relativeUrl.success).toBe(false);
  });

  it('OQSEHeaderSchema: rejects missing required fields', () => {
    const missingId = OQSEHeaderSchema.safeParse({
      title: 'Biology - Cell Basics',
      language: 'en',
      updatedAt: '2026-04-19T10:15:00Z',
      url: 'https://cdn.example.org/sets/biology-cells.oqse.json',
    });
    expect(missingId.success).toBe(false);

    const missingTitle = OQSEHeaderSchema.safeParse({
      id: '123e4567-e89b-12d3-a456-426614174000',
      language: 'en',
      updatedAt: '2026-04-19T10:15:00Z',
      url: 'https://cdn.example.org/sets/biology-cells.oqse.json',
    });
    expect(missingTitle.success).toBe(false);
  });
});
