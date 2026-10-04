import type { OQSEMeta } from './oqse';

type OQSEHeaderMetaProjection = Pick<
  OQSEMeta,
  | 'id'
  | 'title'
  | 'language'
  | 'updatedAt'
  | 'description'
  | 'author'
  | 'subject'
  | 'tags'
  | 'createdAt'
  | 'estimatedTime'
  | 'requirements'
>;

export type OQSEHeader = Omit<OQSEHeaderMetaProjection, 'createdAt'>
  & Partial<Pick<OQSEHeaderMetaProjection, 'createdAt'>>
  & {
    url: string;
    $schema?: string;
  };
