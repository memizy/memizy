# Changelog of @memizy/oqse

The format itself has its own changelog at the end of [oqse.md](https://github.com/memizy/memizy/blob/main/packages/oqse/oqse.md#version-10-2026-10-14) (OQSE 1.0, 2026-10-14). This file lists the releases of the npm package.

## 1.0.0-rc.6 (2026-10-14)

Release candidate of OQSE 1.0; the format is frozen (1.x only adds).

* `HotspotObject`: the shape fields (`x`, `y`, `width`, `height`, `radius`, `points`, `targetName`) are marked required in the specification, as the validators always treated them.
* New section "Canonical and Authoring Formats" in `oqse.md`: the JSON file is the canonical form that applications store and exchange; authoring formats (OQSE Markdown for notes, tool-specific shorthands) are only inputs converted to it, and item IDs survive edits.
* Aligned before 1.0: `math-input` has `correctAnswers` (a list, like `short-answer`) instead of `correctAnswer` + `alternativeAnswers`, and no `tolerance` (answers are compared as LaTeX; numbers are `numeric-input`); `match-complex` has `prompts` / `matches` (like `match-pairs`) instead of `leftItems` / `rightItems`. `checkAnswer` and the JSON Schemas follow.
* The sub-specifications (`oqse-manifest.md`, `oqse-progress.md`, `oqse-header.md`) point to the changelog in `oqse.md`.

## 1.0.0-rc.5

OQSE 1.0: choices with IDs, answers by ID, `skills`, Answer Formats and `checkAnswer`, typed-answer comparison, timeline rules, feature detection, version rules (0.x drafts are refused) and the JSON Schemas at `https://cdn.jsdelivr.net/npm/@memizy/oqse@1/schemas/`. See the "Version 1.0" changelog in `oqse.md`.
