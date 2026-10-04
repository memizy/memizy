import { z } from 'zod';
import type { OQSEHeader } from './header';
import { AbsoluteURLSchema, OQSEMetaSchema } from './oqseValidation';

// OQSEMetaSchema contains object-level refinements, which block .pick() in Zod 4.
// Rebuild the base object from its shape, then pick the projection fields.
const OQSEMetaPickableSchema = z.object(OQSEMetaSchema.shape);

const OQSEHeaderMetaSchema = OQSEMetaPickableSchema.pick({
  id: true,
  title: true,
  language: true,
  updatedAt: true,
  description: true,
  author: true,
  subject: true,
  tags: true,
  createdAt: true,
  estimatedTime: true,
  requirements: true,
}).partial({
  createdAt: true,
});

export const OQSEHeaderSchema: z.ZodType<OQSEHeader> = OQSEHeaderMetaSchema.extend({
  url: AbsoluteURLSchema,
  $schema: z.string().url().optional(),
});

export function validateOQSEHeader(data: unknown): OQSEHeader {
  return OQSEHeaderSchema.parse(data);
}

export function safeValidateOQSEHeader(
  data: unknown
): ReturnType<typeof OQSEHeaderSchema.safeParse> {
  return OQSEHeaderSchema.safeParse(data);
}
