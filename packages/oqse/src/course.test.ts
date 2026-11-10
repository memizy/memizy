import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CourseLesson, CourseSection, OQSECourse } from './course';
import { applyCourseView, checkpointSelections, fillCourseIds, isSafeRelativePath, loadOQSECourse, validateOQSECourseView } from './courseValidation';

const id = (n: number) => `019a7c00-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SET = id(10), PAGE = id(20);

/** A course: section A (lessons L1, L2), lesson L3 at the top; a view "V" hides L2. */
function course(): OQSECourse {
  return {
    version: '1.0',
    meta: { id: id(1), language: 'cs', title: 'Kurz', createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z' },
    sets: [{ id: SET, title: 'Otázky', path: 'sets/otazky/index.json' }],
    pages: [{ id: PAGE, title: 'Simulace', kind: 'simulation', path: 'pages/sim/index.html' }],
    outline: [
      {
        kind: 'section', id: id(100), title: 'A', children: [
          { kind: 'lesson', id: id(110), title: 'L1', steps: [
            { kind: 'page', id: id(111), page: PAGE },
            { kind: 'practise', id: id(112), sets: [{ set: SET }], game: { id: 'https://memizy.com/plugins/let-me-in' } },
          ] },
          { kind: 'lesson', id: id(120), title: 'L2', steps: [{ kind: 'check', id: id(121), sets: [{ set: SET }] }] },
        ],
        checkpoint: { id: id(190), sets: [{ set: SET }] },
      },
      { kind: 'lesson', id: id(300), title: 'L3', steps: [{ kind: 'read', id: id(301), sets: [{ set: SET }] }] },
    ],
    views: [{ id: id(900), title: 'V', hide: [id(120)] }],
  };
}

const titles = (nodes: OQSECourse['outline']): string[] =>
  nodes.flatMap((n) => (n.kind === 'section' ? [n.title, ...titles(n.children)] : [n.title]));

describe('OQSEC: loading', () => {
  it('loads the example of the specification without errors or warnings', () => {
    const md = readFileSync(resolve(__dirname, '../oqse-course.md'), 'utf8');
    const json = md.split('## Complete Example')[1].match(/```json\n([\s\S]*?)\n```/)![1];
    const result = loadOQSECourse(json);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('loads a course and finds no issues', () => {
    const result = loadOQSECourse(course());
    expect(result).toMatchObject({ success: true, errors: [], warnings: [] });
  });

  it('refuses duplicate IDs across sections, lessons, steps, checkpoints and views', () => {
    const c = course();
    (c.outline[1] as CourseLesson).steps[0].id = id(111);
    const result = loadOQSECourse(c);
    expect(result.success).toBe(false);
    expect(result.errors.join()).toContain(id(111));
  });

  it('refuses a resource with both or neither of path and url, and unsafe paths', () => {
    for (const set of [
      { id: SET, title: 'x', path: 'sets/a/index.json', url: 'https://example.com/a.json' },
      { id: SET, title: 'x' },
      { id: SET, title: 'x', path: '../secret/index.json' },
      { id: SET, title: 'x', path: '/etc/passwd' },
      { id: SET, title: 'x', url: 'javascript:alert(1)' },
    ]) {
      expect(loadOQSECourse({ ...course(), sets: [set] }).success, JSON.stringify(set)).toBe(false);
    }
  });

  it('refuses a known step without its keys, but only warns about an unknown kind', () => {
    const c = course();
    (c.outline[1] as CourseLesson).steps.push({ kind: 'watch', id: id(302) } as never);
    expect(loadOQSECourse(c).success).toBe(false);
    const d = course();
    (d.outline[1] as CourseLesson).steps.push({ kind: 'vr-tour', id: id(303), audience: 'family' });
    const result = loadOQSECourse(d);
    expect(result.success).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['unknown-value', 'unknown-value']);
  });

  it('warns about sets and pages the course does not list, not about unlisted games', () => {
    const c = course();
    c.sets = [];
    c.pages = [];
    const result = loadOQSECourse(c);
    expect(result.success).toBe(true);
    expect(new Set(result.warnings.map((w) => w.code))).toEqual(new Set(['unknown-set', 'unknown-page']));
  });

  it('refuses a view base that is missing or cyclic', () => {
    const c = course();
    c.views = [{ id: id(901), title: 'a', base: id(902) }, { id: id(902), title: 'b', base: id(901) }];
    expect(loadOQSECourse(c).success).toBe(false);
    c.views = [{ id: id(901), title: 'a', base: id(999) }];
    expect(loadOQSECourse(c).success).toBe(false);
  });

  it('refuses another MAJOR version and text over 5 MB', () => {
    expect(loadOQSECourse({ ...course(), version: '2.0' }).success).toBe(false);
    expect(loadOQSECourse(' '.repeat(5 * 1024 * 1024 + 1)).success).toBe(false);
  });

  it('checks relative paths', () => {
    expect(isSafeRelativePath('sets/mud/index.oqse.md')).toBe(true);
    for (const p of ['', '/a', 'C:/a', 'a/../b', 'a//b', './a', 'a b', 'a\\b']) expect(isSafeRelativePath(p), p).toBe(false);
  });
});

describe('OQSEC: views', () => {
  it('hides parts of the course; new lessons stay in the view', () => {
    const c = course();
    c.outline.push({ kind: 'lesson', id: id(400), title: 'L4 (new)', steps: [] });
    const applied = applyCourseView(c, c.views![0]);
    expect(titles(applied.outline)).toEqual(['A', 'L1', 'L3', 'L4 (new)']);
    expect(applied.skipped).toEqual([]);
    expect(titles(c.outline)).toContain('L2'); // the course itself is not changed
  });

  it('builds on a base view: show brings back what the base hid', () => {
    const c = course();
    c.views!.push({ id: id(901), title: 'W', base: id(900), show: [id(120)], hide: [id(300)], order: 'locked' });
    const applied = applyCourseView(c, c.views![1]);
    expect(titles(applied.outline)).toEqual(['A', 'L1', 'L2']);
    expect(applied.order).toBe('locked');
  });

  it('makes parts optional or required, moves and adds', () => {
    const c = course();
    const applied = applyCourseView(c, {
      optional: [id(110)],
      moves: [{ node: id(300), parent: id(100), after: null }, { node: id(112), parent: id(300), after: id(301) }],
      add: [
        { parent: id(110), after: id(111), node: { kind: 'link', id: id(500), url: 'https://example.com' } },
        { parent: null, after: id(100), node: { kind: 'lesson', id: id(510), title: 'Moje lekce', steps: [] } },
      ],
    });
    expect(applied.skipped).toEqual([]);
    expect(titles(applied.outline)).toEqual(['A', 'L3', 'L1', 'L2', 'Moje lekce']);
    const section = applied.outline[0] as CourseSection;
    const l3 = section.children[0] as CourseLesson, l1 = section.children[1] as CourseLesson;
    expect(l3.steps.map((s) => s.id)).toEqual([id(301), id(112)]);
    expect(l1.steps.map((s) => s.id)).toEqual([id(111), id(500)]);
    expect(l1.optional).toBe(true);
  });

  it('skips changes whose targets are gone or that do not fit', () => {
    const c = course();
    const applied = applyCourseView(c, {
      hide: [id(777)],
      moves: [
        { node: id(100), parent: id(110), after: null }, // a section into a lesson
        { node: id(100), parent: id(100), after: null }, // into itself
        { node: id(111), parent: null, after: null }, // a step to the top
      ],
      add: [{ parent: id(888), after: null, node: { kind: 'lesson', id: id(520), title: 'x', steps: [] } }],
    });
    expect(applied.skipped).toHaveLength(5);
    expect(titles(applied.outline)).toEqual(titles(c.outline));
  });

  it('reports view targets that are gone as warnings when loading', () => {
    const c = course();
    c.views = [{ id: id(900), title: 'V', hide: [id(777)] }];
    const result = loadOQSECourse(c);
    expect(result.success).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['view-target']);
  });
});

describe('OQSEC View files', () => {
  it('validates a view file and applies it to its course', () => {
    const file = validateOQSECourseView({
      version: '1.0',
      meta: { id: id(2), language: 'cs', title: 'Pro 7. třídy', createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z' },
      course: { id: id(1), title: 'Kurz', url: 'https://cdn.jsdelivr.net/gh/memizy/course-x@0123456789abcdef0123456789abcdef01234567/course.json', view: id(900) },
      sets: [{ id: id(30), title: 'Moje otázky', path: 'sets/moje/index.json' }],
      view: { add: [{ parent: id(110), after: null, node: { kind: 'practise', id: id(600), sets: [{ set: id(30) }] } }] },
    });
    const applied = applyCourseView(course(), { ...file.view, base: file.course.view });
    expect(titles(applied.outline)).toEqual(['A', 'L1', 'L3']);
    const l1 = (applied.outline[0] as CourseSection).children[0] as CourseLesson;
    expect(l1.steps[0].id).toBe(id(600));
  });

  it('refuses a view file without the course it adapts', () => {
    expect(() => validateOQSECourseView({ version: '1.0', meta: course().meta, view: {} })).toThrow();
  });
});

describe('OQSEC: authoring helpers (1.1.0-rc.2)', () => {
  it('a checkpoint without sets is valid and tests what its section teaches', () => {
    const c = course();
    delete (c.outline[0] as CourseSection).checkpoint!.sets;
    expect(loadOQSECourse(c)).toMatchObject({ success: true, warnings: [] });
    // the section has a practise step and a check step, both on SET
    expect(checkpointSelections(c.outline[0] as CourseSection)).toEqual([{ set: SET }, { set: SET }]);
    const withSets = course();
    expect(checkpointSelections(withSets.outline[0] as CourseSection)).toEqual([{ set: SET }]);
  });

  it('fills in missing IDs (and keeps the existing ones), so the file can be written back', () => {
    const raw = {
      version: '1.0',
      meta: { language: 'cs', title: 'Bez ID', createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z' },
      sets: [{ id: SET, title: 'Otázky', path: 'sets/otazky/index.json' }],
      outline: [
        { kind: 'section', title: 'A', children: [{ kind: 'lesson', title: 'L', steps: [{ kind: 'practise', sets: [{ set: SET }] }, { kind: 'check', id: id(7), sets: [{ set: SET }] }] }], checkpoint: {} },
      ],
      views: [{ title: 'V', add: [{ parent: null, after: null, node: { kind: 'lesson', title: 'Navíc', steps: [{ kind: 'link', url: 'https://example.com' }] } }] }],
    };
    expect(loadOQSECourse(raw).success).toBe(false);
    const { data, filled } = fillCourseIds(raw);
    expect(filled).toBe(8); // meta, section, lesson, a step, the checkpoint, the view, the added lesson and its step
    expect(loadOQSECourse(data).errors).toEqual([]);
    expect(((data.outline[0] as { children: { steps: { id: string }[] }[] }).children[0].steps[1]).id).toBe(id(7));
    expect(raw.meta).not.toHaveProperty('id'); // the input is not changed
    expect(fillCourseIds(data).filled).toBe(0);
  });

  it('applies a view to any outline (an application\'s own tree, no metadata)', () => {
    const outline = [{ kind: 'lesson', id: id(1), title: 'a', steps: [{ kind: 'x', id: id(2) }] }, { kind: 'lesson', id: id(3), title: 'b', steps: [] }] as never;
    const applied = applyCourseView({ outline }, { hide: [id(1)], order: 'free' });
    expect(applied.outline.map((n) => n.id)).toEqual([id(3)]);
    expect(applied.order).toBe('free');
  });
});
