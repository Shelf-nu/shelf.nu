# "Was This Checked Out?" Is Answered By The Slice, Not By Status Or Records

Three sources look like they answer _"was this asset checked out on this booking?"_. Only
one does.

| Source                                      | Grain                | Actually answers                           |
| ------------------------------------------- | -------------------- | ------------------------------------------ |
| `BookingAsset.checkedOutAt` / `checkedInAt` | one slice            | **is this slice out, since when, by whom** |
| `PartialBookingCheckout` / `Checkin`        | one scan **session** | what a batch claimed, and how many units   |
| `Asset.status`                              | global               | is it out _somewhere_                      |

## The two wrong answers

**`Asset.status` is global.** An asset can be `CHECKED_OUT` by a _different_ active booking
while never having gone out on this one. Overlapping bookings make this ordinary, not
exotic.

**`PartialBookingCheckout` records progressive scan SESSIONS only.** `checkoutBooking` —
the Check out button — writes no row at all. So the absence of rows says nothing, and a
booking-level test is worse than useless:

```ts
// ❌ Bad — "does this booking have any rows?"
const eligible =
  rows.length > 0
    ? new Set(rows.flatMap((r) => r.assetIds))
    : new Set(everyBookingAsset); // the all-at-once escape hatch
```

That fallback holds only while a booking is purely one style. A booking checked out with
the button (no rows) that later gains **one** asset added and scanned out gets its first
row — the hatch closes, and every asset that went out with the button is reported as
"never checked out". Booking `cmt4klqh400pfrbi8vm966180` hit this with **105 of 107**
slices refused, while the UI showed them all as Checked Out.

```ts
// ✅ Good — the recorded fact, per slice
const checkedOut = new Set(
  bookingFound.bookingAssets
    .filter((ba) => Boolean(ba.checkedOutAt))
    .map((ba) => ba.assetId)
);
```

## When you add a flow that moves assets

Every path that sends assets out or brings them back must maintain the markers — there are
four writers today (`checkoutBooking`, progressive checkout, `checkinBooking`, progressive
check-in) and a new one is easy to miss:

- sending out → set `checkedOutAt`/`checkedOutById`, clear `checkedInAt`/`checkedInById`;
- bringing back → set `checkedInAt`/`checkedInById`, scoped to slices that actually went
  out (stamping one that never did claims it came back);
- `checkedInAt` means **fully reconciled**. A partially-returned `QUANTITY_TRACKED` slice
  stays NULL and is tracked by `ConsumptionLog`.

A claim does not always name the slice it takes: the mobile route accepts
`{ assetId, quantity }` with no tag, so a qty-tracked asset can be claimed untagged while its
units sit across a standalone slice and N kit-driven ones. Scoping the marker by `assetId`
then reports every sibling as out. Resolve the claim to slices first — `compareSlicesForGreedyFill`
(`~/modules/booking/checkout-attribution`) is the order both the marker and the quantity
attribution must agree on — and cap each slice by its **remaining**, not its booked quantity: a
slice already fully out would otherwise absorb the claim and leave the departing one unmarked.

Keep writing the `PartialBookingCheckout` session row alongside — it still owns per-slice
**quantity** attribution, which the boolean marker cannot express.

## Why slice-grained

A `QUANTITY_TRACKED` asset is split across several bookings and several slices at once, so
no column on `Asset` could represent it. `BookingAsset` is already the per-slice,
per-booking join row. Its `deleteMany` is scoped to genuinely-removed rows, so the marker
survives ordinary booking edits.

Related: [[quantity-semantics-per-surface]] for the same "name what this value means before
reaching for a helper" discipline.
