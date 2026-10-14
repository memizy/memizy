# @memizy/protocol

Types, Zod schemas and helpers of the **Memizy Plugin Protocol v1** – the contract between Memizy plugins (`@memizy/plugin-sdk`) and hosts (`@memizy/host-sdk`).

* Specification: [SPEC.md](./SPEC.md) (1.0)
* Plugin authors do not use this package directly – see the [AI plugin guide](../../docs/ai-plugin-guide.md).

```ts
import {
  readPluginManifestFromHtml, // validate a plugin's manifest data island without running it
  resolveSettings,            // apply defaults / validate setting values
  negotiateProtocolVersion,   // handshake version negotiation
  LIMITS,                     // size and rate limits (SPEC 8.1)
  ProtocolError, toProtocolError,
  type HostApi, type PluginApi, type InitPayload,
} from '@memizy/protocol';

const result = readPluginManifestFromHtml(html);
if (result.success) console.log(result.runtime.views); // e.g. ['solo', 'board', 'controller']
```

* **Public API** = what `@memizy/protocol` exports (semver within 1.x, SPEC 9). Helpers shared by the Memizy packages – call parsing (`parseHostCall`), size checks (`assertJsonWithin`), rate limiting, content policies of the iframe, relay limits – are in **`@memizy/protocol/internal`** and may change in any release.
* The exported `*Schema` objects are **Zod 4** schemas; the 1.x line stays on Zod 4.
