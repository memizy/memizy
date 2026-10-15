# Changelog of @memizy/oqse

The format itself has its own changelog at the end of [oqse.md](https://github.com/memizy/memizy/blob/main/packages/oqse/oqse.md#version-10-2026-10-14) (OQSE 1.0, 2026-10-14). This file lists the releases of the npm package.

## Unreleased (next release candidate)

Forward compatibility of OQSE 1.0 (see the "Version 1.0" changelog in `oqse.md`), checked by `forwardCompat.test.ts` with files of a "later 1.x version".

* Open values: `MediaObject.type`, `subtitles[].kind`, `pedagogy.bloomLevel` / `cognitiveLoad`, `SourceMaterial.kind`, OQSEM `studyMode` / `questionDensity` accept values of later versions (`OpenValueSchema`, warning `UNKNOWN_VALUE`); `MEDIA_TYPES`, `SOURCE_KINDS`, `SUBTITLE_KINDS`, `BLOOM_LEVELS`, `COGNITIVE_LOADS` list the known ones; the type `OpenValue<T>`. Before, a new media type or source type made the whole set unreadable and a new Bloom level removed the question.
* Items of unknown types: `loadOQSEFile` and `safeValidateOQSEFile` return them unchanged in `unsupportedItems` (a warning, no longer an error in strict validation); `withUnsupportedItems(file, unsupportedItems)` puts them back for saving.
* `SourceMaterial`: `kind`, `url`, `doi`, `isbn`, `set`, `mimeType` replace `type` + `value` (`SourceMaterialType` / `SourceMaterialTypeSchema` removed; `SourceKind`, `SOURCE_KINDS`); `SourceReference.itemId`. Sets of the release candidates are converted by the repository tool `scripts/migrate-oqse` (the library itself does not carry the old shape: such a source loads as a source cited by its title); every source is validated on its own, so a bad source no longer makes the set unreadable (`INVALID_SOURCE`); `SOURCE_WITHOUT_LOCATOR` warns about a source cited by title only; an `itemId` into this very set must exist.
* OQSEP: `starred`, `lastAnswer.answer` (≤ 4 KB, `MAX_LAST_ANSWER_BYTES`); all OQSEP schemas keep unknown keys (they used to drop them, and the JSON Schema had `additionalProperties: false`).
* OQSEM: `capabilities.types` / `actions` accept lowercase names of later versions; unknown keys and asset categories are kept. OQSEH: unknown keys are kept.
* `checkCompatibility` does not report media of an unknown type as unsupported (they fall back to a link).
* Tolerant reading of real data (each case made a whole set unreadable before): BCP 47 tags with numeric regions and variants (`es-419`, `de-CH-1996`) and `cs_CZ` converted to `cs-CZ` (warning `LANGUAGE_NORMALIZED`); fractions of a second of any length (`…00.123456Z`, as databases write them) in sets and progress files; subtitles from any URI; an invalid optional `meta` field or one broken entry of `assets`, `tagDefinitions`, `translations`… is removed with an error (`INVALID_META_FIELD`) instead of refusing the set; the nesting limit is 32 levels for the whole file (`MAX_JSON_DEPTH`; it was 10 from the root, so a moderately deep `appSpecific` broke the set).
* OQSEP record keys are item IDs, not only UUIDs (generated items).
* The specification fixes for 1.x what older applications could not handle growing: size limits and ranges of scales, the HTML tags allowed without `html`, the formats of IDs, dates and language tags.

## 1.0.0-rc.6 (2026-10-14)

Release candidate of OQSE 1.0; the format is frozen (1.x only adds).

* `HotspotObject`: the shape fields (`x`, `y`, `width`, `height`, `radius`, `points`, `targetName`) are marked required in the specification, as the validators always treated them.
* New section "Canonical and Authoring Formats" in `oqse.md`: the JSON file is the canonical form that applications store and exchange; authoring formats (OQSE Markdown for notes, tool-specific shorthands) are only inputs converted to it, and item IDs survive edits.
* Aligned before 1.0: `math-input` has `correctAnswers` (a list, like `short-answer`) instead of `correctAnswer` + `alternativeAnswers`, and no `tolerance` (answers are compared as LaTeX; numbers are `numeric-input`); `match-complex` has `prompts` / `matches` (like `match-pairs`) instead of `leftItems` / `rightItems`. `checkAnswer` and the JSON Schemas follow.
* The sub-specifications (`oqse-manifest.md`, `oqse-progress.md`, `oqse-header.md`) point to the changelog in `oqse.md`.

## 1.0.0-rc.5

OQSE 1.0: choices with IDs, answers by ID, `skills`, Answer Formats and `checkAnswer`, typed-answer comparison, timeline rules, feature detection, version rules (0.x drafts are refused) and the JSON Schemas at `https://cdn.jsdelivr.net/npm/@memizy/oqse@1/schemas/`. See the "Version 1.0" changelog in `oqse.md`.
