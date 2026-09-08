---
description: Client code must create unique ids with generateClientId(), never crypto.randomUUID(); the browser floor lives in vite build.target plus the inline check in browser-support.ts
globs: ["apps/webapp/app/**/*.ts", "apps/webapp/app/**/*.tsx"]
---

# Client ids via `generateClientId()`

`crypto.randomUUID` is undefined in older browsers and in every insecure
context (a self-hosted instance on plain HTTP), so a direct call crashes the
component that renders it. `generateClientId()` in `~/utils/id/client-id`
returns the same v4 UUID shape on every runtime. ESLint rejects every
`.randomUUID` access in client code (`crypto.`, `globalThis.crypto.`,
`window.crypto.`); `*.server.ts` modules run on Node and may keep it.

```ts
// ❌ Bad — throws "crypto.randomUUID is not a function" on unsupported runtimes
const key = crypto.randomUUID();

// ✅ Good
import { generateClientId } from "~/utils/id/client-id";
const key = generateClientId();
```

The supported-browser floor (Chrome 98, Edge 98, Firefox 94, Safari 15.4) is
pinned in two places that must move together: `build.target` in
`apps/webapp/vite.config.ts` (syntax is lowered to it) and the runtime probes
in `app/utils/browser-support.ts` (older browsers get the "browser out of
date" screen instead of a hang). Before using a browser API newer than that
floor, add a guard or extend the probes.
