/**
 * OQSEC v1.0 – OQSE Course: types.
 *
 * A course puts OQSE sets, pages and games in an order to follow (sections, lessons, steps).
 * See ../oqse-course.md.
 */

import type {
  AssetDictionary,
  ISO8601DateTime,
  LanguageCode,
  OpenValue,
  PersonObject,
  SourceMaterial,
  SPDXLicense,
  TranslationObject,
} from './oqse';
import type { UUID } from './utils';

/** Education levels (open). */
export type CourseLevel = OpenValue<'primary' | 'lower-secondary' | 'upper-secondary' | 'tertiary' | 'adult'>;

/** How the learner moves through the lessons (closed). */
export type CourseOrder = 'guided' | 'locked' | 'free';

export interface CourseMeta {
  id: UUID;
  language: LanguageCode;
  title: string;
  description?: string;
  /** What a learner can do after the course (Plain Text). */
  goals?: string[];
  thumbnail?: string;
  assets?: AssetDictionary;
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
  author?: PersonObject;
  contributors?: PersonObject[];
  license?: SPDXLicense;
  licenseUrl?: string;
  levels?: CourseLevel[];
  subject?: string;
  exam?: string;
  school?: string;
  tags?: string[];
  ageMin?: number;
  ageMax?: number;
  estimatedTime?: number;
  /** Default `guided`. */
  order?: CourseOrder;
  sourceMaterials?: SourceMaterial[];
  translations?: TranslationObject[];
  /** The course's own texts were made by AI. */
  aiGenerated?: boolean;
  customData?: Record<string, unknown>;
  appSpecific?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Where a resource's index file is: inside the course folder (`path`) or outside (`url`). Exactly one. */
export type ResourceLocation = { path: string; url?: never } | { url: string; path?: never };

export type CourseSet = { id: UUID; title: string; [key: string]: unknown } & ResourceLocation;

export type CoursePageKind = OpenValue<'presentation' | 'simulation' | 'explainer' | 'other'>;

export type CoursePage = {
  id: UUID;
  title: string;
  kind?: CoursePageKind;
  thumbnail?: string;
  aiGenerated?: boolean;
  license?: SPDXLicense;
  [key: string]: unknown;
} & ResourceLocation;

export type CourseGame = {
  /** The game's OQSEM manifest `id` (a URL or `urn:uuid:…`). */
  id: string;
  title: string;
  aiGenerated?: boolean;
  license?: SPDXLicense;
  [key: string]: unknown;
} & ResourceLocation;

/** Items of a set a step uses: all, or only `items` and/or those with one of `tags`. */
export interface SetSelection {
  set: UUID;
  items?: UUID[];
  tags?: string[];
}

export type StepAudience = OpenValue<'anyone' | 'class'>;
export type StepKind = OpenValue<'read' | 'practise' | 'check' | 'page' | 'watch' | 'listen' | 'link'>;

interface BaseStep {
  kind: StepKind;
  id: UUID;
  title?: string;
  minutes?: number;
  optional?: boolean;
  /** Default `anyone`. */
  audience?: StepAudience;
  [key: string]: unknown;
}

export interface ReadStep extends BaseStep { kind: 'read'; sets: SetSelection[] }
export interface PractiseStep extends BaseStep {
  kind: 'practise';
  sets: SetSelection[];
  mode?: OpenValue<'cards' | 'quiz' | 'write'>;
  game?: { id: string; settings?: Record<string, unknown> };
}
export interface CheckStep extends BaseStep { kind: 'check'; sets: SetSelection[]; passScore?: number }
export interface PageStep extends BaseStep { kind: 'page'; page: UUID }
export interface UrlStep extends BaseStep { kind: 'watch' | 'listen' | 'link'; url: string }
/** A step of a kind from a later 1.x: shown as not supported, not counted. */
export interface UnknownStep extends BaseStep { kind: string & {} }

export type CourseStep = ReadStep | PractiseStep | CheckStep | PageStep | UrlStep | UnknownStep;

export interface Checkpoint {
  id: UUID;
  /** The items of the test; without it, what the section's practise and check steps use (`checkpointSelections`). */
  sets?: SetSelection[];
  /** 0–100, default 80. */
  passScore?: number;
  minutes?: number;
  [key: string]: unknown;
}

export interface CourseLesson {
  kind: 'lesson';
  id: UUID;
  title: string;
  goal?: string;
  description?: string;
  optional?: boolean;
  steps: CourseStep[];
  [key: string]: unknown;
}

export interface CourseSection {
  kind: 'section';
  id: UUID;
  title: string;
  /** What this level of sections is called in this course ("Chapter", "Module"…). */
  levelName?: string;
  description?: string;
  goal?: string;
  optional?: boolean;
  children: CourseNode[];
  checkpoint?: Checkpoint;
  [key: string]: unknown;
}

export type CourseNode = CourseSection | CourseLesson;

/** A node moved by a view: into `parent` (null: the top of the outline), after `after` (null: first). */
export interface ViewMove { node: UUID; parent: UUID | null; after: UUID | null }
/** A node added by a view. */
export interface ViewAddition { parent: UUID | null; after: UUID | null; node: CourseNode | CourseStep }

/** The changes a view makes (shared by views in a course and OQSEC View files). */
export interface ViewChanges {
  hide?: UUID[];
  show?: UUID[];
  optional?: UUID[];
  required?: UUID[];
  order?: CourseOrder;
  moves?: ViewMove[];
  add?: ViewAddition[];
  [key: string]: unknown;
}

export interface CourseView extends ViewChanges {
  id: UUID;
  title: string;
  description?: string;
  /** Another view of the same course this one builds on. */
  base?: UUID;
}

export interface OQSECourse {
  $schema?: string;
  version: string;
  meta: CourseMeta;
  sets?: CourseSet[];
  pages?: CoursePage[];
  games?: CourseGame[];
  outline: CourseNode[];
  views?: CourseView[];
  [key: string]: unknown;
}

/** An OQSEC View file: a teacher's adaptation of a course somebody else maintains. */
export interface OQSECourseViewFile {
  $schema?: string;
  version: string;
  meta: CourseMeta;
  course: { id: UUID; title: string; url: string; view?: UUID; [key: string]: unknown };
  sets?: CourseSet[];
  pages?: CoursePage[];
  games?: CourseGame[];
  view: ViewChanges;
  [key: string]: unknown;
}
