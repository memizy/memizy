# OQSEH v0.1 Specification (Open Quiz & Study Exchange Header)

OQSEH defines a lightweight projection of the OQSE `meta` object.

It acts as a standalone header (a "library card") that can be used by directories and APIs to list OQSE study sets without hosting full `.oqse.json` payloads.

## OQSEHeader Root Object

An OQSEHeader represents one catalog entry that points to a full OQSE set.

### OQSEHeader Example

```json
{
  "$schema": "https://cdn.jsdelivr.net/gh/memizy/oqse-specification@main/schemas/oqse-header-v0.1.json",
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "title": "Biology - Cell Basics",
  "language": "en",
  "updatedAt": "2026-04-19T10:15:00Z",
  "description": "Introductory set about eukaryotic and prokaryotic cells.",
  "author": {
    "name": "Memizy Team"
  },
  "subject": "Biology",
  "tags": ["cells", "biology", "intro"],
  "createdAt": "2026-03-01T08:00:00Z",
  "estimatedTime": 20,
  "requirements": {
    "features": ["markdown"]
  },
  "url": "https://cdn.example.org/sets/biology-cells.oqse.json"
}
```

### Fields

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `$schema` | string | No | Optional schema URL for self-identification of an individual header object. |
| `id` | string | Yes | Picked from `meta.id`. Unique UUID of the OQSE set. |
| `title` | string | Yes | Picked from `meta.title`. Human-readable set title. |
| `language` | string | Yes | Picked from `meta.language`. BCP 47 language code. |
| `updatedAt` | string | Yes | Picked from `meta.updatedAt`. Last update timestamp (ISO 8601). |
| `description` | string | No | Picked from `meta.description`. Short rich-text/markdown-capable description. |
| `author` | object | No | Picked from `meta.author`. Author metadata object. |
| `subject` | string | No | Picked from `meta.subject`. Subject/category label. |
| `tags` | string[] | No | Picked from `meta.tags`. Search and grouping tags. |
| `createdAt` | string | No | Picked from `meta.createdAt`. Creation timestamp (ISO 8601). |
| `estimatedTime` | number | No | Picked from `meta.estimatedTime`. Estimated completion time in minutes. |
| `requirements` | object | No | Picked from `meta.requirements`. Feature profile required by the set. |
| `url` | string | Yes | Absolute URL to the full raw `.oqse.json` file. |

## Validation Notes

- OQSEH is intentionally lightweight and should remain a projection of OQSE `meta` plus `url`.
- Header consumers should use `url` as the canonical pointer to the full set payload.
