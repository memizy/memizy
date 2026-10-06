# @memizy/protocol

Types, Zod schemas and helpers of the **Memizy Plugin Protocol v1** – the contract between Memizy plugins (`@memizy/plugin-sdk`) and hosts (`@memizy/host-sdk`).

* Specification: [SPEC.md](./SPEC.md) (Release Candidate 3)
* Plugin authors do not use this package directly – see the [AI plugin guide](../../docs/ai-plugin-guide.md).

```ts
import {
  readPluginManifestFromHtml, // validate a plugin's manifest data island without running it
  resolveSettings,            // apply defaults / validate setting values
  negotiateProtocolVersion,   // handshake version negotiation
  parseHostCall,              // validate plugin → host calls
  assertJsonWithin, LIMITS,   // size limits
  ProtocolError, toProtocolError,
  type HostApi, type PluginApi, type InitPayload,
} from '@memizy/protocol';

const result = readPluginManifestFromHtml(html);
if (result.success) console.log(result.runtime.views); // e.g. ['solo', 'board', 'controller']
```
