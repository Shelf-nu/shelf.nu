---
description: A route's non-loader/action exports must never reference a *.server module — it leaks server code into the client bundle and 500s the dev server (typecheck/tests won't catch it)
globs: ["apps/webapp/app/routes/**/*.tsx", "apps/webapp/app/routes/**/*.ts"]
---

# No Server Modules in Route Client Exports

React Router strips server code ONLY from a route's `loader`, `action`,
`middleware`, and `headers` exports. Any OTHER export in a route file — the
default component, `clientLoader`, `ErrorBoundary`, `meta`/`links`/`handle`, or
a **helper you `export` just so a test can import it** — that (transitively)
imports a `*.server` module leaks that module into the client bundle. Vite then
throws `Server-only module referenced by client` and the route 500s at load.
Typecheck and unit tests PASS, so `validate`/CI won't catch it — only opening
the route does.

**Rule:** a `*.server` import may be referenced ONLY inside `loader` / `action`
(etc.). If a server helper needs to be unit-testable in isolation, put it in its
own `*.server.ts` module and import it into the loader — never `export` a
server-dependent helper FROM the route file. Importing a `*.server` module into
a route is fine only when nothing but the loader/action uses it.

```ts
// ❌ Bad — exported from the route (a retained export) → server module leaks to client
// routes/_layout+/bookings.$bookingId.overview.tsx  (this file also has a clientLoader)
import { getAssetAvailabilityBatch } from "~/modules/asset/availability.server";
export async function buildAvailableUnitsByAsset(args) { /* uses getAssetAvailabilityBatch */ }

// ✅ Good — helper lives in a .server module; the route uses it only in the loader
// modules/booking/booking-overview-availability.server.ts
export async function buildAvailableUnitsByAsset(args) { /* uses the .server primitive */ }
// routes/_layout+/bookings.$bookingId.overview.tsx
import { buildAvailableUnitsByAsset } from "~/modules/booking/booking-overview-availability.server";
export async function loader(args) { const x = await buildAvailableUnitsByAsset(...); }
```

Related: the `*.client.ts` mirror — don't import from `*.client.ts` in
loaders/actions; use the `.server.ts` equivalent.
