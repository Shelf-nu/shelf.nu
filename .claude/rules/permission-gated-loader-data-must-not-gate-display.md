---
description: Skipping a loader query behind an edit/manage permission is a perf win only if nothing DISPLAYED derives from it — otherwise view-only roles silently lose data
globs: ["apps/webapp/app/routes/**/*.tsx", "apps/webapp/app/routes/**/*.ts"]
---

# Permission-Gated Loader Data Must Not Feed Display

Skipping a query for users who can't edit is a legitimate optimization. It
becomes a **silent data-loss bug** the moment a display path reads from the
skipped result — the page renders empty for BASE and SELF_SERVICE and looks
perfectly healthy for whoever wrote it (ADMIN/OWNER short-circuit to allow-all
in `hasPermission`).

This shipped: the asset overview gated `getActiveCustomFields` on
`asset: update`, but the page built its ENTIRE custom-fields list from those
definitions. Every BASE and SELF_SERVICE user saw zero custom fields for three
months. Typecheck, unit tests and `validate` were green throughout — an empty
array is a valid array.

**Before gating a loader fetch, name what the payload feeds.** Editor
affordances only (dropdown options, autocomplete sources) → safe to gate.
Anything that labels, orders, or decides the visibility of a row → not gateable.

**Display must derive from the entity's own data, which the read gate already
authorized.** Stored values usually carry their definition already; use that as
the primary source and let the permission-gated fetch only ADD to it.

```ts
// ❌ Bad — the whole list dies when the gated fetch is skipped
const defs = canEdit ? await getActiveCustomFields({ ... }) : [];
const rows = defs.map((def) => ({ def, value: valueMap.get(def.id) ?? null }));

// ✅ Good — seeded from the asset's own values, topped up for editors
const rows = buildAssetOverviewCustomFields({
  storedValues: asset.customFields,       // always present; read gate covered it
  editableDefinitions: allCustomFieldDefs, // [] for view-only, adds "Not set" rows
});
```

A row you surface but the action refuses to write must render read-only —
don't hand a user an editor that dead-ends on a 400.

**Verify as the lowest role, not as an owner.** No automated check in this repo
catches this class; only loading the page as BASE or SELF_SERVICE does. See
[[org-scope-user-supplied-ids]] for the inverse failure (over-exposure).
