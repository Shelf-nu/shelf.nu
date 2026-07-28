---
description: Hand-copied webapp logic in the companion (or any second app) must be marked as a mirror, point at its source, and prefer extraction to packages/*
globs: apps/companion/**
---

# Cross-App Mirrors Need Provenance

The companion cannot import from `apps/webapp/app/**` (Remix-internal paths,
server-adjacent imports — Metro can't consume them). When it needs webapp
truth (permission matrices, enums, business constants), a hand-copied mirror
is sometimes the pragmatic choice — but every mirror MUST:

1. **Declare itself a mirror, never a source** — file-level JSDoc stating the
   canonical file it mirrors and that the server enforces the real rules.
2. **Mirror the EFFECTIVE behavior, not the raw data** — e.g. the server's
   `hasPermission()` short-circuits ADMIN/OWNER to allow-all; a copy of the
   raw `Role2PermissionMap` alone is wrong. Say so in a comment at the spot.
3. **Be UI-cosmetic only** — if a client copy ever gates anything the server
   does not independently enforce, that is a bug, not a mirror.
4. **Carry an extraction path** — when the mirrored thing is behavioral
   (matrix + resolution logic), the durable fix is a shared workspace package
   (`packages/*`, like `@shelf/database`). Note the intended package in the
   JSDoc so reviewers see the debt is tracked, not accidental.

```ts
// ❌ Bad — silent copy; reviewer can't tell drift from design
const ROLE_PERMISSIONS = { OWNER: { qr: ["read", "update"] } };

// ✅ Good — provenance + effective-behavior note + extraction path
/**
 * MIRROR of apps/webapp .../permission.data.ts — cosmetic UI gating only;
 * server enforces via requireMobilePermission. Encodes the EFFECTIVE result
 * (matrix + ADMIN/OWNER allow-all short-circuit). Extraction target:
 * @shelf/permissions (see PR #2753 discussion).
 */
```

Existing mirrors: none — the permissions mirror was extracted to
`@shelf/permissions` (packages/permissions). If you create a new mirror,
add it to this list; when you touch one, diff it against its canonical
source before shipping.
