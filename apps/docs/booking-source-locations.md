# Booking Source Locations

A quantity-tracked asset (a "pool", such as Light bulbs) can be placed at
several locations. A booking says where its units come from, decides that when
the units are added, and holds them there: a reservation of 8 units at Demo
Warehouse keeps those 8 units for that booking, the way a reservation keeps an
individual asset.

This page covers what users see, how the data is attributed, and how the
feature is rolled out.

## What users see

### Sources

Each booking slice of a pool has one or more **sources**: a location where the
pool is placed, or the pool's **Unplaced** units (stock that is not placed at
any location). A slice taking units from two places still shows as one row.
Its Location cell lists the split, for example:

> Demo Warehouse 8 · Unplaced 7

The tooltip lists planned and out units per source. Individual assets and kit
rows look as they always did. A pool with no manual placements shows the cell
it always showed.

Other labels a slice can show:

| Label                 | Meaning                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Unplaced`            | Units planned from or out from the pool's unplaced units.                                                                                                                                                                  |
| `Unknown`             | Units that are out, but whose origin is not a known source: units checked out before sources existed with no recorded location, units that left inside a kit before the kit was detached, or a deleted location's history. |
| `Needs a location`    | Planned units that have no source yet. They cannot be checked out until a source is chosen.                                                                                                                                |
| `Short at {location}` | Another booking or a stock change took units this booking planned at that location. The slice cannot be checked out from there until the sources are changed.                                                              |

### Auto and manual

Adding assets to a booking asks no new question. Shelf allocates the units
silently (**Auto**):

1. Unplaced alone covers the whole quantity over the booking window: all from
   Unplaced.
2. Otherwise the first location (in placement order) that covers it.
3. Otherwise a split: Unplaced first, then the location with the most free
   units.
4. Otherwise the change is refused, naming each source with its free units.
   This refuses even when the pool as a whole has enough units: no fixed set of
   sources covers the whole window.

An Auto slice is moved silently to other sources when its current sources stop
fitting and another set fits.

The adjust quantity dialog has a **From** section for pools with manual
placements: one input per source with its free units for the window, and an
**Auto** button. Editing the split makes the slice **manual**. Shelf never moves
a manual split; when it stops fitting, the slice shows `Short at` until someone
changes it. On a checked-out booking only the units not yet out can be moved.

Every change that adds demand (reserve, quantity increase, source change, date
change, extension, a check-out that takes back released units) is admitted only
when it leaves every other booking whole. Stock changes (moving placements,
losing units, deleting a location) are always allowed; the bookings they hurt
are flagged `Short at` or `Needs a location`.

### Check-out and check-in

Check-out keeps today's confirmation, pre-filled with "As planned" (dispatch by
the allocation). Choosing a source for this dispatch takes the units from that
source's plan when it covers them; otherwise it moves the plan into that source
when the source has room now and over the window (the slice becomes manual);
otherwise it is refused, naming the source. A slice flagged short cannot leave
from the short source.

Check-in charges returned and used-up units to the sources they left from. A
return is never refused for capacity. A request that names no slice (older
phones, quick check-in) is spread over the slices and sources that have units
out, most out first.

### Location page

For a pool, the location page reads, for example, "8 here · 2 out on bookings ·
1 in custody · 3 reserved next". Out and custody are figures for now. "Reserved
next" is the highest number of units booked here at any moment of the next
booking window, never a sum.

## Kits (loose units only)

The per-location guarantee covers **loose units only**. Units inside a kit are
not part of any location here: they are checked against the asset's total
stock, as they always were. The From section's help text says so.

A kit slice keeps one internal plan row (kind `KIT`) so returned and newly
added kit units stay apart after kit quantity edits. It is never shown and never
changes location numbers. A kit unit leaving never lowers the loose units at a
location.

## How attribution is stored

- `BookingAsset.sourceAllocation` is the mode of a slice: `LEGACY` (behaviour
  from before sources: no rows, no shares), `KIT`, `AUTO` or `MANUAL`.
- A **group** is every slice of one asset on one booking. A group is either all
  `LEGACY` or has no `LEGACY` slice, and a converted group never returns to
  `LEGACY`.
- `BookingAssetSource` holds one row per source of a converted slice, kinds
  `LOCATION`, `UNPLACED`, `UNKNOWN`, `UNASSIGNED` (shown as "Needs a location")
  and `KIT`, with `quantity`, `outQuantity`, `releasedQuantity` and
  `dispatchedTotal`.
- `BookingDispositionShare` attributes each disposition log (RETURN, CONSUME,
  LOSS, DAMAGE) of a converted group to a slice and a source row, by quantity.
  Logs are never edited: `ConsumptionLog.locationId` and the stock ledger keep
  meaning "where stock changed".
- Deferred constraint triggers check the final state of every touched slice and
  group at COMMIT. See [Database Triggers](./database-triggers.md) and
  [Protected Indexes](./protected-indexes.md).

Existing bookings are converted lazily, one group at a time, the first time a
writer touches the group while adoption is on. Displaying a booking never
converts it. A group whose recorded out units exceed its plan stays `LEGACY`
until check-ins bring it within bounds; the action proceeds the old way and a
Sentry info event records the numbers.

## Old phones and the capability header

The companion app announces what it understands in the
`X-Shelf-Capabilities` request header. The token `booking-sources` means the
client understands per-source slices and can answer the source question at
check-out.

A client without it (an older build) does not get the source question for a
split slice. The server dispatches by the allocation, and the response summary
lists the real sources. An untagged check-in from such a client is resolved by
the server before any log is written.

Every phone becomes capable once the companion OTA that ships this feature is
installed. The phone's adjust sheet offers Auto and shows the split; editing a
split by hand stays on the web.

## The adoption flag

`BOOKING_SOURCES_ENABLED` is a server-only environment variable. `"true"`
enables **adoption only**:

- new pool slices get source rows, and
- `LEGACY` groups that a writer touches convert.

With the flag off, everything else stays on: source-aware reads, admission,
check-out dispatch, check-in settlement, placement rehome, location delete and
kit merges all keep converted groups correct, and maintenance may still create
rows (a rehome destination, a "Needs a location" row). A slice added to an
already converted group is created `KIT` or `AUTO` with the flag off too.

Machines with the flag on and off can therefore serve side by side, which is
what happens while Fly restarts machines one by one after the secret changes.

## Rollout

Production migrations are run by hand; the deploy does not run them.

1. **Run the migrations before deploy 1**, in this order:

   - `20261112100000_booking_asset_sources`: enums, the two `BookingAsset`
     columns (every existing slice becomes `LEGACY`), the two tables, foreign
     keys, indexes, RLS with no policies, revoked `anon`/`authenticated`
     grants, and the `BOOKING_ASSET_SOURCES_CHANGED` activity action.
   - `20261112100100_booking_source_contract`: the contract triggers.

   Both are additive. The running build keeps working against them unchanged:
   `LEGACY` groups get only the checks they already satisfy. Run them off-peak.
   They take short but strong locks:

   - `ALTER TABLE "BookingAsset" ADD COLUMN` takes an `ACCESS EXCLUSIVE` lock
     on `BookingAsset` (no rewrite: the `NOT NULL` column has a constant
     default), which blocks every read and write of the table while it waits
     and while it runs;
   - each foreign key takes a `SHARE ROW EXCLUSIVE` lock on the table it
     references, and each `CREATE TRIGGER` / `CREATE CONSTRAINT TRIGGER` in
     the contract migration takes `SHARE ROW EXCLUSIVE` on its table, which
     block writes.

   A lock request that queues behind a long-running transaction holds up
   every query behind it, so cap the wait. Run each migration in its own
   session, in one transaction, with a lock timeout set first:

   ```sql
   SET lock_timeout = '5s';
   BEGIN;
   -- the migration file, unchanged
   COMMIT;
   ```

   (`psql --single-transaction` with the `SET` at the top of the input does
   the same.) If it fails with `canceling statement due to lock timeout`, the
   transaction rolls back and nothing was applied: find the blocking
   transaction (`pg_stat_activity`, `pg_locks`), wait for it to finish, and
   run the same migration again. Do not raise the timeout to get past it.

2. **Deploy 1** with `BOOKING_SOURCES_ENABLED` unset or `false`. This build
   understands and maintains sources everywhere but creates none.
3. **Wait until every old machine is gone** (the Fly deploy is complete). No
   machine may run a build older than deploy 1 once adoption starts.
4. **Activate**: set the Fly secret `BOOKING_SOURCES_ENABLED=true`. Fly restarts
   the machines of the same build one by one.
5. Publish the companion OTA.

### Rollback

- **The rollback floor is deploy 1's build.** Once adoption is on, rolling back
  below deploy 1 is unsupported: an older build writes disposition logs without
  shares, and the contract rejects that transaction at COMMIT for any
  converted group.
- To stop adoption, set the flag back to `false`. Converted groups stay
  converted and maintained; nothing new converts.
- **Never drop the triggers** as a recovery step. They are what keeps a
  converted group's rows, shares and logs consistent.

## Known limits

- **Request replay.** A partial check-out or check-in whose response is lost
  and is sent again applies twice. This is true without sources too; fixing it
  needs an operation id from every client.
- **Location delete race.** A source row inserted at a location after the
  delete's final check fails at the foreign key with a generic error.
- **Lock order.** Reserving locks assets before model rows, while fulfil and
  check-out rescheduling lock model rows before assets. This is older than
  sources and now also covers quantity-tracked kit assets: a rare, retried
  deadlock.
- **Kit detach.** Two kit slices of one group detaching with no standalone
  slice of the asset both become `AUTO` and collide on the one standalone slice
  per asset rule.
- **Converted capacity.** Conversion caps each slice at
  `max(quantity, checkedOutQuantity)`, as the units-out reader does. Callers of
  the check-out attribution that pass `quantity` differ when more units went
  out than are booked.
- **Location page.** A single-placement pool that is converted on some
  bookings, with `LEGACY` groups that recorded no source on others, undercounts
  units out at that location; custody of a single-placement pool is counted at
  that placement.
- **From section.** It shows only for converted slices. A `LEGACY` slice gets it
  after its first conversion.

## Behaviour changes outside sources

- The web adjust quantity action refuses `SELF_SERVICE` and `BASE` users on
  RESERVED, ONGOING and OVERDUE bookings, as the mobile route already did.
  Ownership failures on that route stay 403.
- Kit quantity edits no longer rewrite slices on COMPLETE, CANCELLED or
  ARCHIVED bookings, for `LEGACY` slices too: a finished booking keeps the kit
  quantity it had.
- Moving kit units merges colliding slices when the source membership empties.

## Tests

The rollout rules are pinned against a real database by
`apps/webapp/test/db/booking-sources-rollout.db.test.ts` (see
[Real Database Tests](./real-database-tests.md)): a build from before deploy 1
checks out, partially checks in and returns untagged units on `LEGACY` slices
of the migrated schema; the same writer fails on a converted group; a group
converted with the flag on stays maintained with the flag off; and machines
with mixed flag values serialize on the booking lock with every invariant
intact.
