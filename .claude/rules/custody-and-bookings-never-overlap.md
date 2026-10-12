---
description: Custody and a checked-out booking are exclusive holds on the same units; only location overlaps them
globs:
  - "apps/webapp/app/modules/booking/**"
  - "apps/webapp/app/modules/custody/**"
  - "apps/webapp/app/modules/kit/**"
  - "apps/webapp/app/modules/asset/**"
  - "apps/webapp/app/components/scanner/**"
  - "apps/webapp/app/routes/api+/**"
---

# Custody And Bookings Never Overlap

An item answers three questions, and only one of them may stack with the others:

| Axis                  | Means                     | Overlaps with                  |
| --------------------- | ------------------------- | ------------------------------ |
| Location              | where it is stored        | custody, bookings              |
| Custody               | a named person holds it   | location only, never a booking |
| Booking (checked out) | it is out on that booking | location only, never custody   |

Neither hold overlaps **itself** either: one unit is never in two custodies, and never out
on two bookings. Think of the physical object: a person holding a kit cannot also hand it
to a borrower.

**Only check-out takes a booking hold.** Adding an item in custody to a booking, or
reserving that booking, is fine: a reservation is a plan, and the item is assumed back
before the booking checks out. The refusal belongs at check-out (and at custody assign for
an item already out), never at add or reserve.

**The grain is the unit, not the row.** An INDIVIDUAL asset is one unit. A
`QUANTITY_TRACKED` asset is N units, and units in custody + units checked out never exceed
its total. A kit is one unit as a whole: a kit with a `KitCustody` row cannot be checked
out, and a CHECKED_OUT kit cannot be assigned custody, **whatever its members are**. For a
quantity-tracked member that is not enough on its own: the kit's slice (`AssetKit.quantity`)
must also be free, so a slice whose units are out elsewhere blocks the check-out too.

```ts
// ❌ Bad: the asset-level exemption leaks to kits. A quantity-only kit in custody passes,
// because QT IN_CUSTODY only means "some units held".
const blocked = assets.filter(
  (a) => !isQuantityTracked(a) && a.status === AssetStatus.IN_CUSTODY
);

// ✅ Good: the kit is its own unit; gate on its custody row, then on its slice's units
if (kits.some((kit) => kit.custody)) throw kitInCustodyError(kits);
```

The QT exemption on `Asset.status === IN_CUSTODY` is right for a loose asset (the rest of
the pool is bookable) and wrong for anything that holds units as a whole.

**Enforce it server-side in every path that takes a hold** (button and scan check-out,
custody assign, mobile routes), and give the scanner drawers a blocker with a test (see
[[scanner-blockers-need-a-test]]). A drawer tag like "In custody" is not a blocker.
"Clean it up on return" is not a substitute: the double hold exists for the whole booking.
See [[booking-checkout-is-recorded-per-slice]] and [[kit-location-owns-member-placement]].
