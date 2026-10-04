import { describe, it, expect } from 'vitest';
import {
  LanguageCodeSchema,
  ISO8601DateTimeSchema,
  MediaObjectSchema,
  OQSEFileSchema,
  MCQSingleItemSchema,
  MCQMultiItemSchema,
  CategorizeItemSchema,
  TimelineEventSchema,
  FillInBlanksItemSchema,
} from './oqseValidation';
import { formatOQSEErrors } from './utils';

describe('OQSE Validation Schemas', () => {
  it('LanguageCodeSchema: enforces standard BCP 47 locales', () => {
    expect(LanguageCodeSchema.safeParse('en').success).toBe(true);
    expect(LanguageCodeSchema.safeParse('en-US').success).toBe(true);
    expect(LanguageCodeSchema.safeParse('cs-CZ').success).toBe(true);
    
    expect(LanguageCodeSchema.safeParse('e').success).toBe(false); // Too short
    expect(LanguageCodeSchema.safeParse('english').success).toBe(false); // Invalid format
  });

  it('ISO8601DateTimeSchema: ensures strict ISO date formats', () => {
    expect(ISO8601DateTimeSchema.safeParse('2025-11-21T14:30:00Z').success).toBe(true);
    expect(ISO8601DateTimeSchema.safeParse('2025-11-21').success).toBe(true);
    expect(ISO8601DateTimeSchema.safeParse('11/21/2025').success).toBe(false);
  });

  it('MediaObjectSchema: images MUST have altText defined', () => {
    const validImage = { type: 'image', value: 'https://example.com/img.png', altText: 'An image' };
    expect(MediaObjectSchema.safeParse(validImage).success).toBe(true);

    const invalidImage = { type: 'image', value: 'https://example.com/img.png' };
    const result = MediaObjectSchema.safeParse(invalidImage);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('altText');
    }
  });

  it('MediaObjectSchema: start time must be less than end time', () => {
    const validAudio = { type: 'audio', value: 'https://example.com/audio.mp3', start: 1, end: 5 };
    expect(MediaObjectSchema.safeParse(validAudio).success).toBe(true);

    const invalidAudio = { type: 'audio', value: 'https://example.com/audio.mp3', start: 5, end: 1 };
    const result = MediaObjectSchema.safeParse(invalidAudio);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('end');
    }
  });

  it('MediaObjectSchema: subtitles must use .vtt or .srt files', () => {
    const invalidSubtitles = {
      type: 'video',
      value: 'https://example.com/video.mp4',
      subtitles: [{ lang: 'en', value: 'https://example.com/subtitles.docx' }],
    };

    const result = MediaObjectSchema.safeParse(invalidSubtitles);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('Subtitle URI must end with .vtt or .srt'))).toBe(true);
    }
  });
});

describe('Complex Constraints & Referential Integrity', () => {
  it('OQSEFileSchema: relatedItems integrity (non-existent item)', () => {
    const invalidFile = {
      version: '0.1',
      meta: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'T',
        author: { name: 'A' },
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        language: 'en'
      },
      items: [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          type: 'note',
          content: 'test',
          relatedItems: ['123e4567-e89b-12d3-a456-426614174002']
        }
      ]
    };
    
    const result = OQSEFileSchema.safeParse(invalidFile);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('non-existent relatedItems'))).toBe(true);
    }
  });

  it('OQSEFileSchema: thumbnail integrity (missing asset)', () => {
    const invalidFile = {
      version: '0.1',
      meta: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'T',
        author: { name: 'A' },
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        language: 'en',
        assets: { img: { type: 'image', value: 'a.png', altText: 'a' } },
        thumbnail: 'missing'
      },
      items: []
    };
    
    const result = OQSEFileSchema.safeParse(invalidFile);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('non-existent asset'))).toBe(true);
    }
  });

  it('OQSEFileSchema: sourceMaterials integrity (missing source)', () => {
    const invalidFile = {
      version: '0.1',
      meta: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'T',
        author: { name: 'A' },
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        language: 'en',
        sourceMaterials: [{ id: 'src1', type: 'other', value: 'a', title: 'a' }]
      },
      items: [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          type: 'note',
          content: 'test',
          sources: [{ id: 'missing' }]
        }
      ]
    };
    
    const result = OQSEFileSchema.safeParse(invalidFile);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('non-existent source material'))).toBe(true);
    }
  });

  it('MCQSingleItemSchema: bounds checking for correctIndex', () => {
    const invalidItem = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      type: 'mcq-single',
      question: 'Q?',
      options: ['A', 'B'],
      correctIndex: 2
    };
    
    const result = MCQSingleItemSchema.safeParse(invalidItem);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('non-existent option'))).toBe(true);
    }
  });

  it('MCQMultiItemSchema: minSelections must not exceed number of options', () => {
    const invalidItem = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      type: 'mcq-multi',
      question: 'Q?',
      options: ['A', 'B'],
      correctIndices: [0],
      minSelections: 3,
    };

    const result = MCQMultiItemSchema.safeParse(invalidItem);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('minSelections cannot be greater than the number of options'))).toBe(true);
    }
  });

  it('CategorizeItemSchema: rejects nested items missing id', () => {
    const invalidItem = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      type: 'categorize',
      question: 'Sort items',
      categories: ['A', 'B'],
      items: [
        {
          text: 'Alpha',
          correctCategoryIndex: 0,
        },
      ],
    };

    expect(CategorizeItemSchema.safeParse(invalidItem).success).toBe(false);
  });

  it('TimelineEventSchema: rejects event missing id', () => {
    const invalidEvent = {
      text: 'Moon landing',
      date: '1969-07-20T00:00:00Z',
      precision: 'day',
    };

    expect(TimelineEventSchema.safeParse(invalidEvent).success).toBe(false);
  });

  it('FillInBlanksItemSchema: token matching (missing key in blanks)', () => {
    const invalidItem = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      type: 'fill-in-blanks',
      text: 'Hello <blank:name />',
      blanks: { wrong_key: ['John'] }
    };
    
    const result = FillInBlanksItemSchema.safeParse(invalidItem);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('tokens in text must have definition'))).toBe(true);
    }
  });

  it('FillInBlanksItemSchema: rejects blank keys that do not match token regex', () => {
    const invalidItem = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      type: 'fill-in-blanks',
      text: 'Hello <blank:name />',
      blanks: { 'bad key': ['John'], name: ['John'] }
    };

    const result = FillInBlanksItemSchema.safeParse(invalidItem);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          i => i.message.includes('Token must be alphanumeric') || i.message.includes('Invalid key in record')
        )
      ).toBe(true);
    }
  });

  it('formatOQSEErrors: formats OQSEFileSchema validation errors into flat list', () => {
    const result = OQSEFileSchema.safeParse({
      version: '0.1',
      items: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = formatOQSEErrors(result.error);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('meta'))).toBe(true);
    }
  });
});
