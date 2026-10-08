---
description: Every Asset read must say whether it includes archived assets
globs: apps/webapp/app/**/*.{ts,tsx}
---

# Asset Queries Name `archivedAt`

Archived assets (`Asset.archivedAt`, issue #382) are out of service. A read that
forgets them quietly offers or counts them again, and typecheck cannot tell.
`local-rules/require-archived-at-check-on-asset-queries` (error) makes every
`<client>.asset.find*/count/aggregate/groupBy` with a literal `where` name
`archivedAt`.

- Pickers, counts, KPIs, availability pools, anything that starts NEW work →
  `archivedAt: null`.
- Surfaces that show assets already part of a record or a physical label (the
  asset's own pages, a booking holding it, location/kit pages, audits, QR scan,
  history reports, backup export), guards that read the archive state, and ID
  allocation → reach archived on purpose, with a reason:

```ts
// ❌ Bad — silently includes archived assets
db.asset.count({ where: { organizationId } });

// ✅ Good
db.asset.count({ where: { organizationId, archivedAt: null } });

// ✅ Good — must reach archived too, and says why
// eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: detail page shows archived assets with a badge
db.asset.findFirst({ where: { id, organizationId } });
```

List views read the `?archived=` toggle only through `honorArchivedView`, which
callers pass for members holding `asset: archive`. See
`apps/webapp/eslint-local-rules/README.md`.
