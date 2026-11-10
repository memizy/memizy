# OQSEC v1.0 Specification (Open Quiz & Study Exchange Course)

**OQSEC** describes a **course**: study sets, pages and games put in an order to follow –
sections, lessons and their steps – so that a course can be kept in a folder or a Git
repository, zipped into one file, shared, imported and adapted by any application. It is a
sister format of [OQSE](./oqse.md) (study sets): sets stay ordinary OQSE sets, and a course
only puts them in order. A companion file, **OQSEC View**, adapts a course (hides, reorders,
adds) without copying it.

The keywords MUST, SHOULD, MAY and the rest follow [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119),
as in OQSE. The rules of OQSE apply wherever this document refers to them: IDs, Plain Text
and Rich Content, dates, language tags, licences, URI and path security, open values,
unknown keys, and [versions](./oqse.md#versioning-and-compatibility).

## Table of Contents

*   [Overview](#overview)
*   [The Course Folder and the `.oqsec` File](#the-course-folder-and-the-oqsec-file)
*   [Root Structure](#root-structure)
*   [The `meta` Object](#the-meta-object)
*   [Resources: Sets, Pages and Games](#resources-sets-pages-and-games)
*   [The Outline: Sections, Lessons, Steps](#the-outline-sections-lessons-steps)
*   [Steps](#steps)
*   [Completion](#completion)
*   [Views](#views)
*   [OQSEC View Files](#oqsec-view-files)
*   [Validation Rules](#validation-rules)
*   [Complete Example](#complete-example)
*   [Changelog](#changelog)

## Overview

```
Course
├── Section "Mars"                     (sections nest freely; 0, 1 or more levels)
│   ├── Lesson "Why mud boils on Mars" (5–15 minutes, one sitting, one goal)
│   │   ├── Step: page                 (a simulation)
│   │   ├── Step: practise             (a set, perhaps in a game)
│   │   └── Step: check                (a short test)
│   └── checkpoint                     (a test of the whole section)
└── Lesson "What we learned"
```

* **Lessons and steps are fixed levels**; they give the learner orientation: a lesson is one
  sitting with one goal, a step is one thing to do with a clear end. **Sections** above
  lessons nest as deep as a course needs; the author names their levels ("Chapter",
  "Module", "Subject"…).
* **Sets are referenced, never embedded.** A course points to OQSE sets by their `meta.id`;
  one set can serve several lessons (a step may take only some of its items) and several
  courses.
* **Every section, lesson and step has its own UUID**, so learning progress survives moving
  and renaming them. Progress itself is not part of the format (see [Completion](#completion)).
* **Views** let one course serve different learners – a specialisation, a class, a grade –
  without copies.

## The Course Folder and the `.oqsec` File

A course is distributed as a **folder** (often a Git repository) or as the same folder
zipped into one **`.oqsec`** file.

```
course.json                   (REQUIRED) the course: metadata, resources, outline, views
assets/                       (OPTIONAL) the course's own media (cover image)
sets/<name>/index.json        a set of questions or cards (an OQSE file) …
sets/<name>/index.oqse.md     … or a set of notes (OQSE Markdown)
sets/<name>/assets/…          that set's media
pages/<name>/index.html       a page (a presentation, a simulation, an explainer)
pages/<name>/…                the page's own files (images, data)
games/<name>/index.html       a game the course brings
```

* **MIME types:** the course file `application/vnd.oqsec+json` (over HTTP `application/json`
  is RECOMMENDED); the `.oqsec` file `application/vnd.oqsec+zip`.
* **Encoding:** UTF-8 without BOM. The file name `course.json` is fixed; applications find a
  course by it at the root of a folder, a repository or a `.oqsec` file.
* **Only `sets/`, `pages/`, `games/` and `assets/` are read.** Other files (a README, a
  licence, sources of the author) are ignored and MUST NOT make loading fail.
* **Paths** follow OQSE's [path security rules](./oqse.md#uri-and-path-security-validation-rules):
  relative, no leading `/`, no `..`, only `a-z A-Z 0-9 _ - . /`, compared case-insensitively;
  names SHOULD be lowercase.

### A set inside a course

**A set is a folder shaped like an unpacked [OQSE container](./oqse.md#distribution-formats):**
its index file and an `assets/` folder for its media. Zipping that folder alone gives a valid
`.oqse` file, so a set stays standalone – it can be shared, imported or edited without the
course.

* The index file is `index.json` (canonical OQSE) or, for a set of only `note` items,
  `index.oqse.md` ([OQSE Markdown](./oqse.md#oqse-markdown-note-sets), losslessly equivalent
  and keeping the IDs). Applications that read courses MUST read both. Notes kept as
  Markdown can be written and reviewed as plain text (e.g. in pull requests).
* Relative media paths in a set (`assets/diagram.webp`) resolve against **the set's own
  folder** and MUST stay inside it. A medium two sets need is stored in each.
* Media SHOULD be compact: images as WebP of a sensible size; video and long audio belong on
  a video platform and are linked (`watch`, `listen`).

### Pages and games

A page or a game is **one HTML file**. It runs in the application's sandbox (as plugins do:
an opaque origin, no access to the application's storage) and MAY load libraries from public
CDNs. Its own files (images, data) sit in its folder and are loaded by relative URLs, which
applications resolve against that folder (e.g. with a `<base>`). Applications MAY refuse other
scripts than the HTML file itself and public CDNs, and MAY route the CDN addresses (and the
page's own files) through their own proxy – e.g. so that a learner's device talks only to the
application's domain. Libraries SHOULD therefore be referenced at exact versions.

* A **plain page** needs nothing else and also works when opened on its own.
* A page or game **with the Memizy plugin SDK** carries its [OQSEM manifest](./oqse-manifest.md)
  as an HTML data island; then it can report that it is done, ask the lesson's questions and,
  in a class, run live (a presentation the teacher moves, a game for the whole class).

## Root Structure

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@memizy/oqse@1/schemas/oqse-course-v1.0.json",
  "version": "1.0",
  "meta": { ... },
  "sets": [ ... ],
  "pages": [ ... ],
  "games": [ ... ],
  "outline": [ ... ],
  "views": [ ... ]
}
```

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `$schema` | string | No | **Recommended.** The JSON Schema of OQSEC. |
| `version` | string | Yes | The OQSEC version, `MAJOR.MINOR`. The current version is `"1.0"`. OQSE's [version rules](./oqse.md#versioning-and-compatibility) apply. |
| `meta` | object | Yes | [The `meta` object](#the-meta-object). |
| `sets` | CourseSet[] | No | The sets the course uses. [See Resources](#resources-sets-pages-and-games). |
| `pages` | CoursePage[] | No | The pages the course uses. |
| `games` | CourseGame[] | No | Games the course brings (its own or shared by link). Games an application already knows need no entry. |
| `outline` | (Section \| Lesson)[] | Yes | The course's tree; may be empty (a course being written). [See The Outline](#the-outline-sections-lessons-steps). |
| `views` | CourseView[] | No | Views defined by the author. [See Views](#views). |

## The `meta` Object

The fields shared with OQSE have the same meaning as in [OQSE's `meta`](./oqse.md#the-meta-object).

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | string | Yes | UUID of the course. A copy of a course gets a new one. |
| `language` | string | Yes | BCP 47 language tag of the course. |
| `title` | string | Yes | **Plain Text.** |
| `description` | string | No | **Rich Content.** |
| `goals` | string[] | No | **Plain Text.** What a learner can do after the course ("Explain why mud boils on Mars"), for the course's page and for teachers choosing it. |
| `thumbnail` | string | No | Key in `meta.assets`: the cover image. |
| `assets` | object | No | Media of the course itself (a cover), as OQSE's `meta.assets`; relative paths point into the course's `assets/`. Sets carry their own media. |
| `createdAt` | string | Yes | ISO 8601. |
| `updatedAt` | string | Yes | ISO 8601. |
| `author` | PersonObject | No | As in OQSE. |
| `contributors` | PersonObject[] | No | As in OQSE. |
| `license` | string | No | SPDX identifier of the course (its structure and texts; sets, pages and media MAY have their own). |
| `licenseUrl` | string | No | Absolute URL of the licence text. |
| `levels` | string[] | No | Education levels the course is for (**open**): `primary`, `lower-secondary`, `upper-secondary`, `tertiary`, `adult`. Applications show their local names (e.g. ZŠ, SŠ, VŠ). Unknown values are ignored with a warning. |
| `subject` | string | No | **Plain Text.** The subject in the course's language (e.g. `Zeměpis`, `Biology`). |
| `exam` | string | No | **Plain Text.** An exam the course prepares for (e.g. `Maturita`, `State final exams`). |
| `school` | string | No | **Plain Text.** A school or programme the course is made for (e.g. `1. LF UK`). |
| `tags` | string[] | No | **Plain Text.** |
| `ageMin` | number | No | As in OQSE. |
| `ageMax` | number | No | As in OQSE. |
| `estimatedTime` | number | No | Minutes for the whole course. Applications MAY compute it from the steps instead. |
| `order` | string | No | How the learner moves through the lessons (closed list): `guided` (the default: the next lesson is highlighted, all can be opened), `locked` (a lesson opens when the previous one is done), `free` (a list without a path, for reference courses). |
| `sourceMaterials` | SourceMaterial[] | No | As in OQSE: the works the course builds on (e.g. research papers), shown as credits. |
| `translations` | TranslationObject[] | No | As in OQSE, pointing to courses (`id` is a course's `meta.id`). |
| `aiGenerated` | boolean | No | The course's own texts (titles, descriptions, goals) were made by AI. Applications SHOULD show it ("Made by AI"). Default `false`. |
| `customData` | object | No | As in OQSE. |
| `appSpecific` | object | No | As in OQSE (namespaced by the application). |

## Resources: Sets, Pages and Games

Resources are listed once and referred to from steps by ID, so a step stays short and a
resource used in ten lessons is located in one place.

**Location – `path` or `url`.** Every resource has exactly one of:

* `path`: relative to the course folder, pointing to the resource's index file
  (`sets/mud/index.json`, `sets/mud/index.oqse.md`, `pages/mud/index.html`);
* `url`: an absolute URL of that file outside the course (another repository, a set shared by
  link). It SHOULD be **immutable** – fixed to a commit or a version – so that the course
  does not change under its learners; an application MAY offer the course's author a newer
  version when it knows where it comes from.

The folder of the index file is the resource's folder: relative paths inside the resource
resolve against it.

### `CourseSet`

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | string | Yes | The set's `meta.id` (UUID). After loading, applications MUST check that the set's `meta.id` equals it (a mismatch is an error for that set). |
| `title` | string | Yes | **Plain Text.** For display before the set is loaded. |
| `path` / `url` | string | Yes (one) | Where the set's index file is. |

### `CoursePage`

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | string | Yes | UUID of the page within the course. |
| `title` | string | Yes | **Plain Text.** |
| `kind` | string | No | What the page is (**open**), for icons and lists: `presentation`, `simulation`, `explainer`, `other`. Fallback: `other`. |
| `path` / `url` | string | Yes (one) | Where the page's HTML file is. |
| `thumbnail` | string | No | Relative path (in the page's folder) or absolute URL of a preview image. |
| `aiGenerated` | boolean | No | The page (its text, code or images) was made by AI. Applications SHOULD show it. Default `false`. |
| `license` | string | No | SPDX identifier, if different from the course's. |

### `CourseGame`

Only games the course brings need an entry: a game made for the course and stored with it,
or a game shared by link. A step refers to any game by the `id` of its
[OQSEM manifest](./oqse-manifest.md); an application finds it in this list or among the games
it knows.

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | string | Yes | The game's manifest `id` (a URL or `urn:uuid:…`). It MUST equal the `id` in the game's manifest. |
| `title` | string | Yes | **Plain Text.** |
| `path` / `url` | string | Yes (one) | Where the game's HTML file is. |
| `aiGenerated` | boolean | No | As for pages. |
| `license` | string | No | SPDX identifier, if different from the course's. |

## The Outline: Sections, Lessons, Steps

`outline` is an array of sections and lessons; a section's `children` are again sections and
lessons. **Order is the order in the arrays.** Every node has `kind` and `id` (a UUID unique
within the course, across sections, lessons and steps).

### Section

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `kind` | `"section"` | Yes | |
| `id` | string | Yes | UUID. |
| `title` | string | Yes | **Plain Text.** |
| `levelName` | string | No | **Plain Text.** What this level of sections is called in this course ("Chapter", "Module", "Subject", "Topic"). Applications show it in breadcrumbs. Default: the application's word for a chapter. |
| `description` | string | No | **Rich Content.** |
| `goal` | string | No | **Plain Text.** |
| `optional` | boolean | No | An extension for those who want more; not needed to complete the parent. Default `false`. |
| `children` | (Section \| Lesson)[] | Yes | May be empty. |
| `checkpoint` | Checkpoint | No | A test of the whole section at its end. [See Checkpoints](#checkpoints). |

Sections MAY nest without a limit in the format; authors SHOULD keep to at most three levels.
Applications show the learner one line of lessons with the sections as headings and
breadcrumbs ("Common part › Linear algebra › Vector spaces · lesson 3").

### Lesson

A lesson takes **5–15 minutes**, is done in one sitting and has one goal.

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `kind` | `"lesson"` | Yes | |
| `id` | string | Yes | UUID. |
| `title` | string | Yes | **Plain Text.** |
| `goal` | string | No | **Plain Text.** One sentence: what the learner will be able to do. |
| `description` | string | No | **Rich Content.** |
| `optional` | boolean | No | As for sections. |
| `steps` | Step[] | Yes | In order. May be empty while being written. |

### Checkpoints

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | string | Yes | UUID (it has its own progress). |
| `sets` | SetSelection[] | Yes | The items of the test. |
| `passScore` | number | No | 0–100. Default `80`. |
| `minutes` | number | No | |

A checkpoint is offered after the section's lessons. **"I know this already":** applications
SHOULD also offer it before them; passing it completes every lesson of the section (including
nested sections) for that learner.

## Steps

Every step has these keys, plus those of its kind:

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `kind` | string | Yes | The kind (**open**, see below). |
| `id` | string | Yes | UUID. |
| `title` | string | No | **Plain Text.** Default: derived from the resource ("Read: Mud on Mars"). |
| `minutes` | number | No | Expected time. Applications MAY estimate it (notes by length, questions by count). |
| `optional` | boolean | No | Not needed to complete the lesson. Default `false`. |
| `audience` | string | No | For whom the step is (**open**): `anyone` (the default) or `class` – made for a whole class led by a teacher (a live presentation, a game with a board). A self-learner sees a `class` presentation as plain slides and plays a `class` game alone when the game allows it; otherwise the application shows the step as optional ("played in class"). Fallback: `anyone`. |

**Selecting items – `SetSelection`:** steps that use sets list them in `sets`:

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `set` | string | Yes | ID of a set in the course's `sets`. |
| `items` | string[] | No | Only these items (UUIDs) of the set. |
| `tags` | string[] | No | Only items with at least one of these tags. With `items` too, both apply (an item must be listed and have a tag). |

Without `items` and `tags` the whole set is used. Item IDs a set does not have are ignored
with a warning (the set changed). A step may take items of several sets.

### Kinds

| `kind` | Keys | What it is |
| :--- | :--- | :--- |
| `read` | `sets` | Read notes (`note` items) – the lesson's text. |
| `practise` | `sets`, `mode`?, `game`? | Practise questions or cards. `mode` (**open**): `cards`, `quiz`, `write` – a hint for applications without a game (fallback: the application's default). `game`: `{ "id": "<manifest id>", "settings": { … } }` – play the items in that game with these settings (keys of the game's manifest). |
| `check` | `sets`, `passScore`? | A short test; `passScore` 0–100, default `80`. |
| `page` | `page` | Open a page: `page` is the ID of a [`CoursePage`](#coursepage). |
| `watch` | `url` | Watch a video (absolute URL; e.g. a video platform). |
| `listen` | `url` | Listen to a recording (absolute URL). |
| `link` | `url` | Open an outside page (absolute URL). |

**Unknown kinds** (from a later 1.x) and **unknown games:** an application shows a step of a
kind it does not know with its title as not supported and does not count it for completion
(warning). A `practise` step whose game the application cannot find is played as plain
practice of the same items – a course never breaks because of a game.

## Completion

Applications decide how they record progress; the format only says what "done" means, so that
courses behave alike everywhere. Applications SHOULD treat a step as done when:

| Kind | Done when |
| :--- | :--- |
| `read` | the learner reached the end of the notes |
| `practise` | the round ended (the game's end, or every selected item answered) |
| `check`, checkpoint | the score reached `passScore` |
| `page` | the page reported it (with the SDK), or the learner pressed "Done" |
| `watch`, `listen` | played to (near) the end, or marked by the learner |
| `link` | opened, or marked by the learner |

A lesson is done when its non-optional steps are; a section when its non-optional lessons and
sections are and its checkpoint is passed (or when its checkpoint was passed first). Answers
to questions are recorded per set as usual ([OQSEP](./oqse-progress.md)), so practice outside
the course counts too. **Review** ("time to repeat") is not stored in the course: applications
compute it from the progress of the items of done lessons and MAY show it on the path.

## Views

A **view** is a named change of the course for some of its learners – a specialisation, a
grade, a class. Instead of copying the course, a view lists what differs; new lessons the
author adds later appear in every view unless the view hides them, so views do not go stale.

The author defines views in `views`; a teacher picks one and adapts it in an
[OQSEC View file](#oqsec-view-files) (or in the application), which is again a view built on
it. A learner (or a teacher for a class) picks a view; without one, the whole course applies.

### `CourseView`

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | string | Yes | UUID. |
| `title` | string | Yes | **Plain Text.** ("Web specialisation", "7th grade") |
| `description` | string | No | **Rich Content.** |
| `base` | string | No | ID of another view of this course this one builds on. No cycles. |
| `hide` | string[] | No | IDs of sections, lessons or steps the view leaves out (with everything inside them). |
| `show` | string[] | No | IDs hidden by the base view that this view shows again. |
| `optional` | string[] | No | IDs made optional in this view. |
| `required` | string[] | No | IDs made required in this view. |
| `order` | string | No | The order mode for this view (`guided`, `locked`, `free`). |
| `moves` | Move[] | No | Moved nodes: `{ "node": id, "parent": sectionId \| lessonId \| null, "after": id \| null }` – a lesson or section into a section (`parent: null` – the top of the outline), a step into a lesson; `after: null` puts it first. |
| `add` | Addition[] | No | New nodes: `{ "parent": id \| null, "after": id \| null, "node": Section \| Lesson \| Step }`. Their resources are in the course (an author's view) or in the view file (a teacher's view). |

**Applying a view** (applications MUST give this result): start from the base view applied
to the course (or the course itself), then in this order: `show`, `hide`, `optional` /
`required`, `moves` in their order, `add` in their order, `order`. An ID the course does not
have (the author deleted it) is skipped with a warning; the application SHOULD show such
skipped changes to whoever maintains the view. Added nodes have their own UUIDs, distinct from
the course's.

## OQSEC View Files

An **OQSEC View** file adapts a course somebody else maintains – a teacher's version for their
class, shared with other teachers – without copying it. It sits in a folder like a course
(`view.json`, and `sets/`, `pages/`, `games/` for what it adds) and may be zipped as
`.oqsecv` (`application/vnd.oqsecv+zip`; the JSON `application/vnd.oqsecv+json`).

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@memizy/oqse@1/schemas/oqse-course-view-v1.0.json",
  "version": "1.0",
  "meta": { "id": "…", "language": "cs", "title": "Planetary volcanology for 7th grade", "createdAt": "…", "updatedAt": "…" },
  "course": { "id": "…", "title": "Planetary volcanology", "url": "https://…/course.json", "view": "…" },
  "sets": [ … ], "pages": [ … ], "games": [ … ],
  "view": { "hide": [ … ], "add": [ … ] }
}
```

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `$schema`, `version` | string | | As in the course; the current version is `"1.0"`. |
| `meta` | object | Yes | As the course's `meta` (`id`, `language`, `title`, `createdAt`, `updatedAt` required; `author`, `license`, `description`, `goals`, `levels`… optional). `id` is the view's UUID. |
| `course` | object | Yes | The course adapted: `id` (its `meta.id`), `title`, `url` (absolute URL of its `course.json` or `.oqsec`; it SHOULD be immutable – at a commit), `view` (optional: the ID of the author's view this one builds on). |
| `sets`, `pages`, `games` | arrays | No | Resources of the added nodes, as in a course; paths relative to the view's folder. |
| `view` | object | Yes | A `CourseView` without `id`, `title` and `base` (they come from `meta` and `course.view`). |

When the maintainer of a view takes over a newer version of the course, they change
`course.url`; the view applies to it by IDs, and changes whose targets disappeared are shown to
them. After loading, applications MUST check that the course's `meta.id` equals `course.id`.

## Validation Rules

**Errors** (the file is refused):

* missing or malformed `version`, `meta.id`, `meta.title`, `meta.language`, `outline`;
  a MAJOR version other than 1 (OQSE's version rules);
* a node or step without a valid `kind` / `id`, a section without `children`, a lesson
  without `steps`;
* **duplicate IDs** among sections, lessons, steps, checkpoints and views of a course; a
  resource ID listed twice;
* a resource with both or neither of `path` and `url`; a `path` breaking the path rules; a
  `url` that is not absolute or uses a forbidden scheme;
* a step of a known kind missing its required keys (`sets`, `page`, `url`);
* a view `base` that does not exist or forms a cycle;
* more than **20 000** nodes and steps, or JSON nested deeper than 32 levels; a
  `course.json` larger than **5 MB**.

**Warnings** (the course loads):

* a `SetSelection.set` or `page` that the course does not list (that step is shown as
  unavailable); a game the course does not list is not an issue – the application looks for
  it among the games it knows and otherwise plays the items as plain practice;
* a set whose `meta.id` differs from its entry, or that cannot be loaded (its steps are
  unavailable);
* item IDs or tags a set does not have; view targets that do not exist;
* unknown values of open fields (`kind` of a step or page, `audience`, `mode`, `levels`).

**Unknown keys** MUST be ignored and preserved on export, as in OQSE.

**Reference implementation:** `loadOQSECourse` (the structure, limits and checks together),
`OQSECourseSchema`, `validateOQSECourse`, `safeValidateOQSECourse`, `checkOQSECourse`
(references, duplicates, limits, view targets), `applyCourseView`, `walkCourse`,
`isSafeRelativePath`, and `OQSECourseViewSchema` / `validateOQSECourseView` in the
`@memizy/oqse` package; JSON Schemas `schemas/oqse-course-v1.0.json` and
`schemas/oqse-course-view-v1.0.json`.

## Complete Example

A small course: one section with one lesson (a simulation, practice in a game, a test) and a
checkpoint, plus a view for younger pupils.

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@memizy/oqse@1/schemas/oqse-course-v1.0.json",
  "version": "1.0",
  "meta": {
    "id": "019a7c00-0000-7000-8000-000000000001",
    "language": "cs",
    "title": "Sopky na planetách",
    "description": "Proč na Marsu vře bahno a jak vznikají sopky na jiných světech.",
    "goals": ["Vysvětlit, proč bahno na Marsu vře a zamrzá zároveň"],
    "createdAt": "2026-11-10T12:00:00Z",
    "updatedAt": "2026-11-10T12:00:00Z",
    "author": { "name": "Ladislav Nagy" },
    "license": "CC-BY-4.0",
    "levels": ["lower-secondary", "upper-secondary"],
    "subject": "Zeměpis",
    "order": "guided",
    "sourceMaterials": [
      { "id": "broz2020", "kind": "article", "title": "Brož et al. (2020), Nature Geoscience: mud flowing like lava under Martian conditions" }
    ]
  },
  "sets": [
    { "id": "019a7c00-0000-7000-8000-000000000010", "title": "Bahno na Marsu – otázky", "path": "sets/bahno/index.json" }
  ],
  "pages": [
    { "id": "019a7c00-0000-7000-8000-000000000020", "title": "Bahno na Marsu", "kind": "simulation", "path": "pages/bahno-na-marsu/index.html" }
  ],
  "outline": [
    {
      "kind": "section", "id": "019a7c00-0000-7000-8000-000000000100", "title": "Mars", "levelName": "Kapitola",
      "children": [
        {
          "kind": "lesson", "id": "019a7c00-0000-7000-8000-000000000110", "title": "Proč bahno na Marsu vře",
          "goal": "Vysvětlíš, co nízký tlak dělá s vodou v bahně.",
          "steps": [
            { "kind": "page", "id": "019a7c00-0000-7000-8000-000000000111", "page": "019a7c00-0000-7000-8000-000000000020", "minutes": 5 },
            { "kind": "practise", "id": "019a7c00-0000-7000-8000-000000000112", "sets": [{ "set": "019a7c00-0000-7000-8000-000000000010" }],
              "game": { "id": "https://memizy.com/plugins/let-me-in", "settings": { "difficulty": "easy" } } },
            { "kind": "check", "id": "019a7c00-0000-7000-8000-000000000113", "sets": [{ "set": "019a7c00-0000-7000-8000-000000000010" }], "passScore": 80 }
          ]
        }
      ],
      "checkpoint": { "id": "019a7c00-0000-7000-8000-000000000190", "sets": [{ "set": "019a7c00-0000-7000-8000-000000000010" }] }
    }
  ],
  "views": [
    { "id": "019a7c00-0000-7000-8000-000000000900", "title": "Pro 6. třídu", "order": "locked",
      "optional": ["019a7c00-0000-7000-8000-000000000113"] }
  ]
}
```

**A minimal course** – one set published as a course – has one lesson with the steps its
content suggests (`read` for notes, `practise` and `check` for questions).

## Changelog

### Version 1.0 (2026-11-10)

The first version: the course folder and `.oqsec`, sets as folders shaped like OQSE
containers (JSON or OQSE Markdown), pages and games as single HTML files, sections nesting
above lessons and steps, checkpoints, views and OQSEC View files.
