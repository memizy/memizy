# OQSEP v0.1 Specification (Open Quiz & Study Exchange Progress)

Applications that implement spaced repetition or other adaptive learning algorithms accumulate significant per-user, per-item learning data over time. Without a standard for this data, users are entirely dependent on a single platform — a form of **vendor lock-in** that makes migrating to a better tool, or continuing study on a different device, practically impossible.

**OQSEP** (Open Quiz & Study Exchange — Progress) is a lightweight, companion JSON format that standardizes the representation and export of this learning progress. An OQSEP file is always associated with a specific OQSE study set (identified by `meta.setId`) and contains one progress record per item in that set.

#### Rationale & Design Goals

*   **Portability over precision.** Progress data MUST be exportable and importable across applications using different spaced repetition algorithms (e.g., Leitner, SM-2, FSRS). No single algorithm's internal state is mandated.
*   **Raw statistics as a universal bridge.** Complex algorithms such as FSRS require parameters (stability, difficulty, retrievability) that are meaningless outside their own mathematical model. OQSEP solves this by always storing the **raw outcome statistics** (`attempts`, `incorrect`, `streak`) which any algorithm can use as a **Cold Start** seed when importing progress from a foreign system.
*   **Lightweight by design.** Simple applications and plugins MAY rely solely on `bucket` and `nextReviewAt` without ever parsing `appSpecific` data. This allows a plugin with a minimal implementation to still consume OQSEP files meaningfully.
*   **No answer content stored.** OQSEP deliberately does not record the actual text of a user's answers. Only the outcome (`isCorrect`) and optional confidence (`confidence`) are stored. This keeps the progress file lean and avoids reproducing the set content redundantly.

#### Distribution Format

OQSEP files MUST be valid UTF-8 encoded JSON. The RECOMMENDED file extension is `.oqsep.json` (plain `.json` is also fully permitted; the compound extension improves discoverability in editors and file managers without requiring special tooling). The RECOMMENDED MIME type for HTTP transmission is `application/json` (custom APIs MAY use `application/vnd.oqsep+json` for strict content negotiation). An OQSEP file MUST NOT be embedded inside an OQSE container (`.oqse` / `.json`); it is always a separate, standalone artifact.

## Table of Contents

*   [Data Model](#data-model)
*   [Bucket Scale](#bucket-scale)
*   [Confidence Scale](#confidence-scale)
*   [Example](#example)
*   [Portability Best Practices](#portability-best-practices)

## Data Model

An OQSEP document is a single JSON object with the following structure.

##### Root Object

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `$schema` | string | No | **Recommended.** URL reference to the JSON Schema for the OQSEP format for automatic validation. |
| `version` | string | Yes | Version of the OQSEP format. MUST follow `"MAJOR.MINOR"` format (e.g., `"1.0"`). The current format version is `"0.1"`. |
| `meta` | object | Yes | Metadata block describing the origin of this progress data. See [Progress Meta Object](#progress-meta-object). |
| `records` | object | Yes | A map of item UUIDs (strings) to their individual [Progress Record](#progress-record) objects. The absence of an item from this map implicitly signals an unseen state (equivalent to bucket 0). An explicit record with `bucket: 0` MAY, however, appear when an application stores pre-study initialization data or algorithm-specific state for an item the user has not yet encountered. |

##### Progress Meta Object

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `setId` | string | Yes | **Plain Text.** The UUID of the OQSE study set this progress file corresponds to. Importing applications MUST verify this matches the set being loaded before applying the progress data. |
| `exportedAt` | string | Yes | ISO 8601 timestamp (e.g., `"2026-03-04T12:00:00Z"`) indicating when this progress file was generated. |
| `algorithm` | string | No | Identifier of the spaced repetition algorithm last used to update these records. The value MUST be lowercase and alphanumeric, with hyphens permitted (pattern: `^[a-z0-9\-]+$`). When using a widely recognized algorithm, applications MUST use one of the following official identifiers: `"leitner"`, `"sm2"`, `"sm15"`, `"fsrs"`, `"anki"`. This field is informational only; importing applications MUST NOT refuse to import a file solely because this value differs from their own algorithm. |

##### Progress Record

Each entry in the `records` map is keyed by an item UUID and contains the following object. The absence of an item in the `records` map implicitly means it is unseen and has no stored state. However, an explicit record MAY exist even for unseen items if an application needs to store pre-study initialization data or specific `appSpecific` state.

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `bucket` | integer | Yes | Current knowledge level of the item. MUST be an integer in the range **0–4**. See [Bucket Scale](#bucket-scale). Value `0` explicitly denotes an item that is in a *new*, *unseen*, or *reset* state; if `bucket` is `0`, the value of `stats.attempts` SHOULD logically be `0`. Values **1–4** represent increasing levels of knowledge. |
| `nextReviewAt` | string | No | ISO 8601 timestamp indicating when the item is next due for review. Applications utilizing only a simple scheduler MAY rely solely on this field and `bucket`, ignoring `appSpecific`. |
| `stats` | object | Yes | Aggregate outcome statistics across all past attempts. See [Stats Object](#stats-object). |
| `lastAnswer` | object | No | Details of the most recent single answer session. See [Last Answer Object](#last-answer-object). |
| `appSpecific` | object | No | A namespaced object for storing algorithm-specific internal state that cannot be expressed through the standard fields. Top-level keys MUST be the application identifier (e.g., `"memizy"`), with algorithm-specific data nested beneath (e.g., `{ "memizy": { "fsrs": { "stability": 0.42 } } }`). This namespacing prevents key collisions when multiple applications round-trip the same file. Applications MUST preserve all keys in this object when saving, modifying only their own namespace. |

##### Stats Object

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `attempts` | integer | Yes | Total number of times this item has ever been answered. MUST be ≥ 0. |
| `incorrect` | integer | Yes | Total count of incorrect answers (lapses) across all attempts. MUST be ≥ 0 and ≤ `attempts`. |
| `streak` | integer | Yes | Current consecutive correct answers streak. Reset to `0` on any incorrect answer. MUST be ≥ 0. |

##### Last Answer Object

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `isCorrect` | boolean | Yes | Whether the most recent answer was correct. If `isSkipped` is `true`, this field SHOULD be `false` and MUST be ignored by scheduling logic. |
| `confidence` | integer | No | User's self-assessed confidence rating after the most recent answer. MUST be an integer in the range **1–4** if present. See [Confidence Scale](#confidence-scale). |
| `answeredAt` | string | Yes | ISO 8601 timestamp of when the answer was submitted. |
| `timeSpent` | integer | No | Time spent on this specific answer attempt, in milliseconds. MUST be ≥ 0 if present. |
| `hintsUsed` | integer | No | Number of hints the user revealed during this attempt. MUST be ≥ 0 if present. Defaults to `0` when absent. |
| `isSkipped` | boolean | No | Whether the user skipped the item without submitting an answer. When `true`, `isCorrect` SHOULD be `false` and MUST be ignored by scheduling logic. |

## Bucket Scale

The `bucket` field encodes the current knowledge level of an item on a **0–4 integer scale**, directly inspired by the Leitner box system. It provides a universal, algorithm-agnostic signal that all importing applications can map to their own scheduling tiers.

The absence of an item from the `records` map is the canonical representation of an unseen item. Value `0` acts as an explicit, storable equivalent of that unseen state, provided to allow applications to attach pre-study initialization data (e.g., seeding `appSpecific` parameters before a first session) without implying the user has already encountered the item.

| Bucket | Label | Meaning |
| :---: | :--- | :--- |
| **0** | *New / Reset* | Item is in an initial or reset state. The user has not meaningfully engaged with it. MAY be stored explicitly when pre-initialization data is needed; otherwise the item is simply absent from `records`. `stats.attempts` SHOULD be `0` when this value is stored. |
| **1** | *Learning* | Item is newly introduced or was recently answered incorrectly. Requires frequent, short-interval review. |
| **2** | *Familiar* | Item has been answered correctly at least once but is not yet reliably recalled. Review intervals are moderate. |
| **3** | *Consolidated* | Item is recalled reliably under normal conditions. Review intervals are longer. |
| **4** | *Mastered* | Item is recalled effortlessly and consistently. Review intervals are long-term. |

## Confidence Scale

The `confidence` field, when present, captures the user's **subjective assessment of their own recall quality** immediately after answering. It uses a **forced four-point scale (1–4)** with no middle value.

The deliberate absence of a middle option prevents the central-tendency bias common in three-point or odd-numbered scales without a forced choice — users statistically gravitate towards a neutral midpoint when one is available, producing data that is too uniform to be useful for adaptive scheduling. A four-point scale forces a genuine lean toward either weak or strong recall.

| Rating | Label | Meaning |
| :---: | :--- | :--- |
| **1** | *Complete Blackout* | No recall whatsoever. The answer was wrong and even seeing the correct answer did not trigger recognition. |
| **2** | *Familiar but Forgotten* | The answer was incorrect, but upon seeing the correct answer it felt familiar or obvious in hindsight. Some trace memory exists. |
| **3** | *Correct with Effort* | The answer was correct, but required noticeable hesitation, conscious effort, or felt uncertain throughout. |
| **4** | *Effortless Recall* | The answer was correct and came immediately, without hesitation or doubt. |

## Example

A minimal but complete OQSEP document with two item records:

```json
{
  "$schema": "https://cdn.jsdelivr.net/gh/memizy/oqse-specification@main/schemas/oqse-progress-v0.1.json",
  "version": "0.1",
  "meta": {
    "setId": "019cb880-acf3-7bb1-a717-96bb05e220c1",
    "exportedAt": "2026-03-04T14:30:00Z",
    "algorithm": "leitner"
  },
  "records": {
    "019cb880-d607-7944-8630-66b9b432109a": {
      "bucket": 3,
      "nextReviewAt": "2026-03-11T09:00:00Z",
      "stats": {
        "attempts": 8,
        "incorrect": 1,
        "streak": 5
      },
      "lastAnswer": {
        "isCorrect": true,
        "confidence": 4,
        "answeredAt": "2026-03-04T14:28:11Z"
      }
    },
    "019cb880-ee7f-7e91-83ed-44bec565b69d": {
      "bucket": 1,
      "nextReviewAt": "2026-03-05T09:00:00Z",
      "stats": {
        "attempts": 3,
        "incorrect": 2,
        "streak": 0
      },
      "lastAnswer": {
        "isCorrect": false,
        "confidence": 1,
        "answeredAt": "2026-03-04T14:29:05Z"
      },
      "appSpecific": {
        "memizy": {
          "fsrs": {
            "stability": 0.42,
            "difficulty": 7.81,
            "retrievability": 0.61
          }
        }
      }
    }
  }
}
```

Note that an item belonging to the set might be entirely absent from `records`. The absence of a record implicitly means the user has never been shown that item (and it defaults to bucket 0 behavior). However, explicit records with `bucket: 0` are also perfectly valid for unseen items.

## Portability Best Practices

**On omitting answer content:** OQSEP deliberately does not store the literal text or selection of the user's answers (e.g., the exact string they typed). The `lastAnswer` object records only whether the answer was correct (`isCorrect`) and an optional confidence rating. This is a conscious design choice to keep the progress file lean. Spaced repetition algorithms require outcome signals (correctness, confidence, timing), not a replay of what was typed. If an application strictly requires saving the exact user input for custom features, it MUST place this data inside its `appSpecific` namespace.

**On `appSpecific` usage:** Algorithm-specific parameters that are opaque outside a given algorithm's mathematical model — such as FSRS stability (S) and difficulty (D) values — MUST be stored exclusively inside the `appSpecific` sub-object of the relevant record. Top-level keys within `appSpecific` MUST be the application identifier (e.g., `"memizy"`), with algorithm-specific data nested beneath (e.g., `{ "memizy": { "fsrs": { ... } } }`). This namespacing is mandatory to prevent silent key collisions when a file passes through multiple applications. Applications MUST preserve all keys in `appSpecific` when saving, modifying only their own namespace. Storing proprietary data at the top level of a Progress Record — or directly as an un-namespaced key in `appSpecific` — is not permitted and WILL cause validation failures.

**On cold-start import:** When an application using a complex algorithm (e.g., FSRS) receives a progress file produced by a simpler one (e.g., Leitner), the `appSpecific` block for its own algorithm will be absent. The application SHOULD gracefully initialize its internal parameters using the universally available `stats` (`attempts`, `incorrect`, `streak`) and `bucket` as seed data. This is the **Cold Start** scenario: deriving reasonable initial parameter estimates from raw statistics rather than refusing the import.

**On `setId` verification:** Importing applications MUST compare `meta.setId` against the UUID of the OQSE set being opened. If the values do not match, the application SHOULD warn the user and refrain from applying the progress data automatically to prevent data corruption.

**On partial records and unseen items:** The `records` map need not contain an entry for every item in the set. Items absent from the map are treated as unseen. However, applications MAY explicitly generate a record with `bucket: 0` for an item that has never been presented if they need to store pre-study initialization data, suspended states, or `appSpecific` metadata. While permitted, applications SHOULD NOT unnecessarily synthesize placeholder records for all unseen items just to fill the file, as this bloats the file size.