# Quantity Semantics Per Surface

Shelf has FOUR different `quantity` fields across the schema, each
meaning something different. Reaching for `getAssetTotalValue(asset)`
on every surface looks ergonomic but silently substitutes the WRONG
multiplier — every booking, kit, custody, and value-at-risk total in
the codebase had this bug at v1.0 of the QT-aware-display work.

| Surface           | Right multiplier               | Field on row            |
| ----------------- | ------------------------------ | ----------------------- |
| Inventory / dash  | workspace stock                | `Asset.quantity`        |
| Booking total/PDF | booked units                   | `BookingAsset.quantity` |
| Kit overview      | units in this kit              | `AssetKit.quantity`     |
| Custody snapshot  | units held by this custodian   | `Custody.quantity`      |
| Overdue at-risk   | booked units (still out)       | `BookingAsset.quantity` |
| Idle assets       | workspace stock (sitting idle) | `Asset.quantity`        |

Before reaching for `getAssetTotalValue`, **state in a comment what the
row represents and which quantity it should multiply by**. If it's
anything other than workspace stock, do NOT use the helper — inline the
multiplication with the right field, named explicitly. The helper is
reserved for surfaces where `Asset.quantity` IS the multiplier.

```typescript
// ❌ Bad — `ba.asset.quantity` is workspace stock (e.g. 100), but
// the booking only reserved `ba.quantity` (e.g. 5). Total reports
// 100× the unit price; multi-slice assets double-count.
const total = bookingAssets.reduce(
  (sum, ba) => sum + getAssetTotalValue(ba.asset),
  0
);

// ✅ Good — explicit booked-units multiplier; comment names the surface
// Each row = one BookingAsset slice. Multiplier = ba.quantity (booked).
const total = bookingAssets.reduce(
  (sum, ba) => sum + (ba.asset.valuation ?? 0) * ba.quantity,
  0
);
```

When you fix one occurrence, **grep sibling aggregates of the same
entity** — this bug travels in packs (per [[bulk-event-parity]] / IDOR
fix patterns: review never finds them all, sweeps do).

The Prisma `select` clause must match: surfacing the wrong quantity in
the loader → wrong total in the reducer is the easier mistake to make.
Select the field whose name matches the multiplier the surface needs;
don't select `asset.quantity` "just in case" if the row is custody.
