---
description: Route tests belong in apps/webapp/test/routes-tests/ — NEVER in app/routes/. Vite warms every file under app/routes/ as a client module, so a co-located test importing a *.server module breaks the dev server, and validate/CI stay green
globs:
  [
    "apps/webapp/app/routes/**",
    "apps/webapp/test/routes-tests/**",
    "apps/webapp/vite.config.ts",
  ]
---

# Never Put Test Files in `app/routes/`

Vite's dev-server warmup (`server.warmup.clientFiles` in `vite.config.ts`)
pulls **every** file under `app/routes/` into the **client** module graph. A
test file there is not a route — `ignoredRouteFiles: ["**/.*", "**/*.test.*"]`
in `app/routes.ts` keeps it out of the route tree — but warmup does not care.
The moment it imports a `*.server` module, React Router rejects it:

```
Pre-transform error: Server-only module referenced by client
  '~/modules/api/mobile-auth.server' imported by
  'app/routes/api+/mobile+/qr.claim.test.ts'
```

Route tests exist to test loaders/actions, so they essentially always import a
`*.server` module — meaning **every** co-located route test breaks
`pnpm webapp:dev`. Typecheck, ESLint and the unit suite all pass, so
`pnpm webapp:validate` and CI stay green. The only symptom is a broken dev
server, which is why this regressed more than once.

**Rule:** every route test goes in `apps/webapp/test/routes-tests/`, mirroring
the route's path, and imports the route through the `~/routes/...` alias. Never
a relative `./route-name` import, and never a `.test.server.ts` rename — that
infix only ever existed to dodge the warmup glob and is now banned too.

Enforced by the `local-rules/no-test-files-in-routes` ESLint rule (error →
blocks the pre-commit hook). The warmup glob also negates `*.test.*` /
`*.spec.*` as defense in depth; keep that negation a **superset** of
`ignoredRouteFiles` — the two drifting apart is what caused the original bug.

```ts
// ❌ Bad — app/routes/api+/mobile+/qr.claim.test.ts
import { action } from "./qr.claim";

// ✅ Good — test/routes-tests/api+/mobile+/qr.claim.test.ts
import { action } from "~/routes/api+/mobile+/qr.claim";
```

Name-collide with an existing test for the same route? Add an infix naming the
angle under test (`audits.start.action.test.ts`,
`bookings.$bookingId.adjust-asset-quantity.availability.test.ts`) rather than
merging unrelated suites.

Related: [[no-server-module-in-route-client-exports]] covers the sibling case —
a **real** route leaking a `*.server` import through a non-loader export.
