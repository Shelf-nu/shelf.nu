---
description: Shelf has TWO code-bearing entity types — Asset AND Kit. Any feature that surfaces an identifier or code value on one entity's list views must evaluate the equivalent surfaces for the other. Reach for the shared `resolveDisplayCode` resolver + `AssetCodeBadge` primitive so the same logic ships everywhere; don't re-implement per surface.
globs:
  [
    "apps/webapp/app/components/booking/list-asset-content.tsx",
    "apps/webapp/app/components/booking/kit-row.tsx",
    "apps/webapp/app/components/assets/assets-index/assets-list.tsx",
    "apps/webapp/app/components/assets/assets-index/advanced-asset-columns.tsx",
    "apps/webapp/app/components/audit/expected-assets-list.tsx",
    "apps/webapp/app/routes/_layout+/kits.$kitId.assets.tsx",
    "apps/webapp/app/routes/_layout+/kits._index.tsx",
    "apps/webapp/app/routes/_layout+/locations.$locationId.assets.tsx",
    "apps/webapp/app/routes/_layout+/bookings.$bookingId.overview.manage-assets.tsx",
    "apps/webapp/app/routes/_layout+/bookings.$bookingId.overview.manage-kits.tsx",
    "apps/webapp/app/routes/_layout+/audits.$auditId.overview.tsx",
    "apps/webapp/app/routes/_layout+/audits.$auditId.scan.tsx",
  ]
---

Shelf renders rows of **code-bearing entities** in many places. Two entity
types carry codes today: **Asset** and **Kit** (both have `qrCodes` and
`barcodes` relations per schema; both can be added to the alternative-barcodes
add-on). Customer workflows that need "match physical label → row" apply to
both — so any feature that surfaces an identifier must evaluate **both axes**
of the surface grid:

```text
                    Asset                                    Kit
  ┌──────────────────────────────────────┐  ┌──────────────────────────────┐
  • /assets index (simple AND advanced)    • /kits index
  • Add-Assets-to-booking modal            • Add-Kits-to-booking modal
  • Booking overview asset row             • Booking overview kit-row
  • Kit detail's asset list                • Kit detail header (property sheet)
  • Locations page assets                  • —
  • Audit overview / expected-assets       • —
  • Audit scan live drawer                 • —
  └──────────────────────────────────────┘  └──────────────────────────────┘
```

**When you surface a new attribute or code on ANY surface, in order:**

1. Use the shared **resolver** — `resolveDisplayCode({ entity, organization })`
   from `~/modules/barcode/display`. The `EntityForCodeResolution` type
   accepts both Asset and Kit shapes (kit-specific fields are optional).
   Don't re-implement.
2. Use the shared **rendering primitive** — `<AssetCodeBadge>` from
   `~/components/assets/asset-code-badge`. Same chip everywhere. Use the
   `interactive` prop when the chip opens a code preview, so the trailing
   "expand" affordance is consistent.
3. **Loader audit** — for each surface you touch, confirm `qrCodes` and
   `barcodes` are included with **tight** `select` clauses
   (`{ take: 1, select: { id: true } }` for QR; `{ select: { id, type, value } }`
   for Barcode). Avoid `include: true` payload bloat.
4. If a surface is **intentionally excluded**, leave a one-line
   `// why: out of this rule — <reason>` comment AT the surface.

**Known v1.1 gaps (deliberately deferred):**

- **Audit scan-live drawer** — still uses simplified `AuditScannedItem` shape;
  needs `qrCodes`/`barcodes` plumbed through the scanner atom.
- **`Kit.sequentialId`** and **`Kit.preferredBarcodeId`** schema fields — kits
  today fall back to QR when workspace pref is SAM, and have no per-kit
  override. Add these (with a migration) before promoting kits to full
  feature parity with assets.

❌ Bad — wires the chip on one entity's surfaces only:

```tsx
// Only the asset surfaces got <AssetCodeBadge>; /kits index shows raw text.
// Customer who set workspace pref = Code128 sees the chip on assets but not
// on kits — same workspace, inconsistent rendering.
```

✅ Good — chip everywhere a code-bearing entity is listed, with the resolver
deciding what to render:

```tsx
const displayCode = currentOrganization
  ? resolveDisplayCode({ entity: item, organization: currentOrganization })
  : null;

// ...
{
  displayCode ? <AssetCodeBadge {...displayCode} /> : null;
}
```

Mobile companion (`apps/companion/`) is out of scope of this rule — owned by
another team. Coordinate separately if a change should also land there.
