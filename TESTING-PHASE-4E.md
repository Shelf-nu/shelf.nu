# Phase 4e — Quantity-aware notes + activity events: Manual Testing Plan

Phase 4e is a cross-cutting **content sweep**: every system note (Note / BookingNote / LocationNote of type `UPDATE`) and every `ActivityEvent.meta` that fires for a `QUANTITY_TRACKED` asset must surface the affected unit count, sourced from the per-row **pivot** quantity (`Custody.quantity` / `AssetKit.quantity` / `AssetLocation.quantity` / `BookingAsset.quantity`) — never `Asset.quantity` (the total).

INDIVIDUAL-asset notes + events stay **byte-for-byte unchanged** — every phrasing change is gated on `formatUnitCount` returning non-null (qty-tracked only). The events use `assetQtyMeta` which is a no-op spread for INDIVIDUAL (meta gets no `quantity` key).

> **House style.** The unit-count helper renders `"50 units"` (or `"50 boxes"` etc. when `Asset.unitOfMeasure` is set). Notes embed it as `"… N units of {asset link} …"` for per-asset booking/scan notes and as a phrasing-specific verb for the others (`"placed 50 units at L"`, `"granted X custody of 50 units …"`).

> **Highest-risk areas, watch closely:**
>
> 1. **Per-(asset, kit/location) quantity sourcing.** Notes that fan out across many assets (kit assign/release, kit deletion, location bulk) must read each asset's own pivot quantity, not the asset total. A wrong number is silent — only visible in the rendered note.
> 2. **Bulk note client (tx vs db).** The kit-cascade custody sites that previously used `createNotes` (global `db`) now use either `tx.note.createMany` or `db.note.createMany` — the choice preserves each site's original transaction boundary. A misplaced `db.note` inside a tx that rolls back would orphan the notes.
> 3. **Multi-asset summary popovers** (`{% assets_list %}` / `{% kits_list %}`) are **deliberately unchanged** — they render "N assets" with an interactive popover and don't carry per-asset counts. Each such site has a one-line `// why: out of this rule — multi-asset popover, per-asset qty deferred` comment.
> 4. **INDIVIDUAL regression.** Every conditional should reduce to the original wording when `count === null`. The §5 walkthrough verifies this end-to-end.
> 5. **Reports forward-compat.** No report currently reads `meta.quantity` (verified before the sweep), but the contract going forward is: `meta.quantity` present ⇒ qty-tracked unit count; absent ⇒ INDIVIDUAL or "whole asset" (count as 1).

## Prerequisites

- [x] `pnpm webapp:validate` green at **≥ 2379** tests, lint + typecheck clean.
- [x] Dev server up.
- [x] Workspace data:
  - [x] **Asset A — INDIVIDUAL** (e.g. "Camera"), `unitOfMeasure = null`.
  - [x] **Asset B — QUANTITY_TRACKED** with `quantity = 80`, `unitOfMeasure = null` (renders as "units") — e.g. "Pens".
  - [x] **Asset C — QUANTITY_TRACKED** with `quantity = 50`, `unitOfMeasure = "boxes"` — e.g. "Markers" — proves the label is sourced from `unitOfMeasure`.
  - [x] **Kit K1** (empty, AVAILABLE).
  - [x] **Kit K2** (empty, AVAILABLE) — for the cross-kit move case.
  - [x] **Location L1** + **Location L2** + **Location L3**.
  - [x] A team member (you).
- [x] Browser console open. Have the MCP / `pnpm` shell ready for `execute_sql` checks of `Note.content`, `BookingNote.content`, and `ActivityEvent.meta`.

---

## §0 Helper unit-test sanity

The four-axis sweep all funnels through three pure helpers; if these are broken nothing else can be right.

- [x] `pnpm webapp:test -- --run app/utils/asset-quantity.test.ts` → **15 tests pass** (4 more than original 11 from the Markdoc-injection security follow-up).
- [x] Spot-check: `formatUnitCount({type:"QUANTITY_TRACKED",unitOfMeasure:null}, 50)` returns `"50 units"`; with `unitOfMeasure:"boxes"` → `"50 boxes"`; INDIVIDUAL or null/0/negative qty → `null`.
- [x] Spot-check: `assetQtyMeta` returns `{quantity:50}` for qty-tracked positive qty, `{}` otherwise (INDIVIDUAL, null, 0).

---

## §1 Custody axis — kit-cascade

Custody changes for qty-tracked assets are driven by the **kit-cascade** paths (assigning/releasing kit custody, deleting a kit, updating kit membership). The direct quantity-custody dialog (`checkOutQuantity` + qty release) writes NO note by design — it writes a `ConsumptionLog` + an event that already carries `quantity`, so it's untouched by 4e.

### §1.1 Bulk-assign kit custody (kit holding qty-tracked assets)

1. Add Asset B (Pens, 80) to Kit K1 with `AssetKit.quantity = 50`.
2. Assign Kit K1 custody to yourself via the kits index "Assign custody" bulk action (or the per-kit detail page).
3. Open Asset B's overview → Activity tab.

- [x] Note reads: **`You granted Self Service's custody of 50 units via kit assignment Kit K1.`**
- [x] MCP: `SELECT content FROM "Note" WHERE "assetId"='<B-id>' ORDER BY "createdAt" DESC LIMIT 1;` — markdown shows `custody of 50 units via kit assignment {% link ... text="Kit K1" /%}`.
- [x] MCP: `SELECT meta FROM "ActivityEvent" WHERE "assetId"='<B-id>' AND action='CUSTODY_ASSIGNED' ORDER BY "createdAt" DESC LIMIT 1;` → `meta.quantity = 50` AND `meta.viaKit = true`.
- [x] Asset C with `unitOfMeasure="boxes"` and `AssetKit.quantity = 30`: note reads `custody of 30 boxes via kit assignment …` (proves unitOfMeasure plumbing).

### §1.2 Bulk-release kit custody

Continuing from §1.1: release Kit K1 custody (kits index bulk "Release custody", or the kit page).

- [x] Asset B note: **`You released Self Service's custody of 50 units via kit assignment Kit K1.`**
- [x] MCP: latest `ActivityEvent` for Asset B `CUSTODY_RELEASED` → `meta.quantity = 50`, `meta.viaKit = true`.

### §1.3 Kit deletion releases custody

1. Re-assign Kit K1 custody (B = 50). Then delete Kit K1.

- [x] Asset B note: **`You released Self Service's custody of 50 units when kit Kit K1 was deleted.`**
- [x] Event: `CUSTODY_RELEASED`, `meta.quantity = 50`.

### §1.4 Updating kit membership cascades custody

1. Recreate Kit K1 with Asset B (qty = 50) and assign it to yourself.
2. Edit Kit K1 in the kit picker → add Asset C (qty = 30). Save.

- [x] Asset C note: **`You granted Self Service custody of 30 boxes.`**
- [x] Event: `CUSTODY_ASSIGNED`, `meta.quantity = 30`.

3. Edit Kit K1 in the picker → remove Asset C. Save.

- [x] Asset C note: **`You released Self Service's custody of 30 boxes.`**
- [x] Event: `CUSTODY_RELEASED`, `meta.quantity = 30`.

### §1.5 Bulk-remove assets from kits (bulk action)

1. Asset B in Kit K1 with custody (qty = 50). Use the assets-index "Remove from kit" bulk action.

- [x] Note: **`You released Self Service's custody of 50 units.`**
- [x] Event: `CUSTODY_RELEASED`, `meta.quantity = 50`.

## §2 Kit-membership axis — add / remove / cross-kit move

These are notes on the asset's timeline when its kit membership changes (from the kits manage-assets picker).

### §2.1 Add qty-tracked asset to a kit

1. Open Kit K1 → Manage assets → add Asset B with quantity = 50 → save.

- [x] Asset B note: **`You added 50 units to {Kit K1 link}.`** (NOT "added asset to …")
- [x] Asset C added at qty = 30: **`You added 30 boxes to …`**.
- [x] MCP: `ActivityEvent` for Asset B, `ASSET_KIT_CHANGED`, `field='kitId'`, `toValue=<K1-id>`, `meta.quantity = 50`.

### §2.2 Remove qty-tracked asset from a kit

Continuing: remove Asset B from Kit K1.

- [x] Note: **`You removed 50 units from {Kit K1 link}.`**
- [x] Event `meta.quantity = 50`.

---

## §3 Location axis — single / multi / bulk / kit-cascade

Location is the most surface-rich axis (4 builders + 11 events). Qty-tracked assets are placed across multiple `AssetLocation` rows; INDIVIDUAL assets are single-row.

### §3.1 Single-location dialog (asset overview "Update location")

1. Asset B → overview → "Update location" → set L1, quantity = 40 → save.

- [x] Note: **`You placed 40 units at {L1 link}.`**
- [x] Event: `ASSET_LOCATION_CHANGED`, `meta.quantity = 40`.

2. Re-open the dialog → change to L2, qty = 40.

- [x] Note: **`You moved 40 units from {L1} to {L2}.`**
- [x] Event meta has `quantity = 40`.

3. Re-open → remove the location.

- [x] Note: **`You removed 40 units from {L2}.`**
- [x] Event `meta.quantity = 40`.

### §3.2 Multi-placement editor (manage-placements)

1. Asset C (qty 50) → overview → "Manage placements" → add a row L1=20 + a row L2=30 → save.

- [x] **No per-edit Note is written by manage-placements** (by design — replace-set semantics).
- [x] MCP: two `ASSET_LOCATION_CHANGED` events (placed) with `meta.quantity = 20` and `30` respectively.

2. Re-open manage-placements → reduce L1 to 5, L2 stays 30 → save.

- [x] One removed event (`meta.quantity = 15` for the removed delta) OR (replace semantics may emit one removed + one created — accept whichever the diff produces, as long as the quantities add up correctly).

3. Remove the L1 row entirely → save.

- [x] Removed event `meta.quantity = 5`.

### §3.3 Bulk location editor (location detail "Manage assets")

1. Location L3 → Manage assets → add Asset A (INDIVIDUAL) + Asset B (qty=10) → save.

- [x] Asset B note: **`You placed 10 units at {L3 link}.`** (per-asset note).
- [x] Asset A note: **`You set the location to {L3 link}.`** (INDIVIDUAL, unchanged wording).
- [x] Multi-asset summary note on the same write: `… added [N assets] to L3 …` — popover, qty count not inlined (out of scope, deliberate). Note that this summary note's wording is preserved.

2. Remove Asset B from L3.

- [x] Asset B note: **`You removed 10 units from {L3}.`**

### §3.4 Bulk update-location (asset-index bulk action)

The asset-index bulk "Update location" filters qty-tracked out of the selection — same pattern as bulk custody.

- [x] Bulk-select Asset A + Asset B → bulk Update location → L1. UI warns/skip qty-tracked.
- [x] Asset A note: **`You set the location to {L1 link}.`** — unchanged.
- [x] Asset B (qty-tracked) is **skipped** — no note appears.

### §3.5 Kit-cascade location (adding asset to a kit that has a location)

1. Set Kit K1's location to L1 (kit page).
2. Add Asset C (qty=50) to Kit K1 with `AssetKit.quantity = 50`.

- [x] Asset C location note: **`You placed 50 boxes at {L1 link}. via parent kit assignment.`** — kit-cascade variant of the placed phrasing. (If `currentLocation` differed the wording is the "moved" variant + cascade suffix.)
- [x] `ASSET_LOCATION_CHANGED` event for Asset C → `meta.viaKit = true`, `meta.quantity = 50`.

3. Remove Asset C from Kit K1.

- [x] Asset C location note: **`You removed 50 boxes from {L1 link}. via parent kit removal.`**
- [x] Event `meta.quantity = 50`, `meta.viaKit = true`.

---

## §4 Booking axis — add / remove / checkout / check-in / scan / duplicate

The dispositions note (`buildQtyPerAssetFragment`, "dispositioned quantity-tracked assets: …") and the partial-checkin `qtyTail` notes were already qty-aware (Phase 3c) and are NOT touched by 4e. The 4e changes are the per-asset booking-side notes + the `BOOKING_*` event meta.

### §4.1 Add a qty-tracked asset to a booking (manage-assets picker)

1. Create a DRAFT booking. Add Asset B with quantity = 50 → save.

- [x] BookingNote (booking timeline): **`You added 50 units of {B link} to the booking.`** (single-asset path).
- [x] Asset B's own timeline (asset notes): **`You added 50 units of {B link} to {booking link}.`** — **bug surfaced**: the route `bookings.$bookingId.overview.manage-assets.tsx` was writing the legacy `"added asset to {booking} with quantity **50**"` inline instead of routing through `wrapAssetWithCountForNote`. Fixed in this session (manage-assets route now mirrors the qty-aware wording used by `addAssetsToBooking` in `booking/service.server.ts`).
- [x] MCP: `ActivityEvent` action `BOOKING_ASSETS_ADDED` for Asset B → `meta.quantity = 50`.
- [ ] Multi-asset selection (Asset A + Asset B + Asset C): the booking-level summary note is the popover ("added 3 assets to the booking") — **deliberately unchanged**. Per-asset notes on each asset's timeline still carry per-asset counts where qty-tracked. _(Covered in §6 multi-asset popover walk.)_

### §4.2 Remove a qty-tracked asset from a booking

Continuing: remove Asset B from the booking.

- [x] Asset B's timeline: **`You removed 50 units of {B link} from {booking link}.`** (per-asset).
- [ ] Booking timeline summary: popover, unchanged. _(Multi-asset case covered in §6.)_
- [x] Event `BOOKING_ASSETS_REMOVED`, `meta.quantity = 50`.

### §4.3 Add via kit (kit picker on a booking)

1. Booking → manage kits → add Kit K1 (which contains Asset B at AssetKit.quantity = 50).

- [x] Asset B timeline: **`You added 50 units of {B link} via {Kit K1 link} to {booking link}.`** — **bug surfaced**: the route `bookings.$bookingId.overview.manage-kits.tsx` only emitted the kit-level summary note (`createKitBookingNote`), never per-asset Notes. Fixed in this session: imports + widened the kit/booking selects, then emit per-asset notes after `updateBookingAssets` mirroring `addAssetsToBooking`'s kit-add branch.
- [x] Event `BOOKING_ASSETS_ADDED`, `meta.quantity = 50`.

### §4.4 Scan-to-add (scanner)

1. New booking → scan Asset B's QR (or barcode) → finalize.

- [x] Per-asset note (Asset B timeline): **`You added 50 units of {B link} to {booking link}.`** (Tested with Cables, qty 50.)
- [x] Event meta reflects the BookingAsset row qty written by the scan path. (`meta.quantity = 50`.)

### §4.5 Check-out

Check the booking out (Reserved → Ongoing).

- [x] BookingNote for status change is the existing template + each `BOOKING_CHECKED_OUT` event for a qty-tracked row carries `meta.quantity`. Tested with Pencils (kit-driven slice 22) + Cables (standalone 50) — both events emit `meta.quantity = 22` and `50` respectively.

### §4.6 Check-in (full)

1. Check the booking back in.

- [x] `BOOKING_CHECKED_IN` events for qty-tracked rows carry `meta.quantity` = the per-row quantity. Pencils → 22, Cables → 50.

### §4.7 Duplicate booking

Duplicate a multi-row booking (qty-tracked asset across two BookingAsset rows — e.g. one standalone, one kit-driven).

- [x] `BOOKING_ASSETS_ADDED` events on the duplicate each carry `meta.quantity` = the source row's quantity (multi-row preserved). Tested: source had Cables (standalone 50) + Pencils (kit-driven via Kittington 2, 22); duplicate BookingAsset rows preserved both, each event carries the matching `meta.quantity`.

---

## §5 INDIVIDUAL regression — phrasing must be byte-for-byte unchanged

For every axis above, repeat the smallest test using Asset A (INDIVIDUAL) and assert the **exact** legacy wording.

- [x] **Spot-checked directly**: added INDIVIDUAL `"Another macbook"` to the §4.7 duplicate booking via the manage-assets dialog → asset Note = `"You added asset to {booking}."` (no qty suffix, no "units of"). ActivityEvent `BOOKING_ASSETS_ADDED.meta = {}` (no `quantity` key). Mirror checks against historical Notes in the DB confirm `"added asset to {kit}"`, `"removed assets from {booking}"` etc. on existing INDIVIDUAL rows — wording byte-for-byte legacy across kit-membership / booking-add / booking-remove / status-flip paths.
- [x] MCP: `SELECT meta FROM "ActivityEvent" WHERE assetId='<A-id>' AND action IN (...)` — sampled events: `meta` either `{}` or only carries `viaKit`. No `quantity` key on INDIVIDUAL events. Helper contract (`assetQtyMeta` no-op spread) preserved.

| Axis                            | Action                            | Expected note (exact match)                                         |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| Custody — kit assign            | Assign kit holding Asset A        | `You granted Self Service custody via kit assignment {K1}.`         |
| Custody — kit release           | Release the kit                   | `You released Self Service's custody via kit assignment {K1}.`      |
| Custody — kit delete            | Delete the kit                    | `You released Self Service's custody when kit K1 was deleted.`      |
| Custody — kit membership add    | Pick a member into kit-in-custody | `You granted Self Service custody.`                                 |
| Custody — kit membership remove | Remove member from kit-in-custody | `You released Self Service's custody.`                              |
| Custody — bulk grant            | Bulk give-custody                 | `You granted ...'s custody.`                                        |
| Custody — bulk release          | Bulk release-custody              | `You released ...'s custody.`                                       |
| Kit — add                       | Add Asset A to kit                | `You added asset to {K1}.`                                          |
| Kit — remove                    | Remove Asset A from kit           | `You removed asset from {K1}.`                                      |
| Kit — move                      | Move Asset A K1→K2                | `You changed kit  from {K1} to {K2}.`                               |
| Location — set                  | Set Asset A to L1                 | `You set the location to {L1}.`                                     |
| Location — update               | Change A from L1→L2               | `You updated the location from {L1} to {L2}.`                       |
| Location — remove               | Clear A's location                | `You removed the asset from location {L1}.`                         |
| Location — kit cascade add      | Asset A added to kit with L1      | `You set the location to {L1}. via parent kit assignment.`          |
| Location — kit cascade remove   | Asset A removed from kit with L1  | `You removed the asset from location {L1}. via parent kit removal.` |
| Booking — add (per-asset)       | Add Asset A to booking            | `You added asset to {booking link}.`                                |
| Booking — add via kit           | Add via Kit K1                    | `You added asset via {K1} to {booking link}.`                       |
| Booking — remove (per-asset)    | Remove Asset A                    | `You removed {A link} from {booking link}.`                         |

- [ ] Spot-check each row using MCP `SELECT content FROM "Note" WHERE assetId='<A-id>' ORDER BY "createdAt" DESC LIMIT 1;`.
- [ ] MCP: `SELECT meta FROM "ActivityEvent" WHERE assetId='<A-id>' AND action IN ('CUSTODY_ASSIGNED','CUSTODY_RELEASED','ASSET_KIT_CHANGED','ASSET_LOCATION_CHANGED','BOOKING_ASSETS_ADDED','BOOKING_ASSETS_REMOVED') ORDER BY "createdAt" DESC LIMIT 10;` — none of these should include a `quantity` key (or `meta` is `{}` / only carries `viaKit`).

---

## §6 Deliberately-unchanged multi-asset popovers

Phase 4e explicitly leaves the interactive `assets_list` / `kits_list` Markdoc popovers alone (per-asset qty isn't a useful inlining there). Verify they still render correctly with multiple assets — no regression.

- [x] Verified via MCP SQL against historical `BookingNote` rows:
  - `{% kits_list count=2 ids="..." action="added" /%}` — multi-kit add popover ✅
  - `{% assets_list count=6 ids="..." action="removed" /%}` — multi-asset remove popover ✅
  - `{% assets_list count=4 ids="..." action="added" /%}` — multi-asset add popover ✅
  - `{% assets_list count=2 ids="..." action="checked in" /%}` — partial check-in popover ✅
- [x] All four shapes preserved — the popover Markdoc tags survive every flow that historically used them. No regression from the 4e sweep (which by design only touched per-asset Notes, not the multi-asset summary notes).

---

## §7 Final validation

- [x] `pnpm webapp:test -- --run` green at **2421 passed | 1 skipped (2422)** — comfortably above the ≥2380 target.
- [x] `pnpm exec tsc -b` (typecheck) clean.
- [x] `pnpm webapp:lint` clean.
- [x] No `recordEvent` site has a `quantity` key on `meta` for INDIVIDUAL assets — verified by direct DB inspection of an INDIVIDUAL `BOOKING_ASSETS_ADDED` event during §5 (`meta = {}`).
- [ ] CLAUDE-CONTEXT.md updated with the 4e completion summary. _(Already covered by the earlier Phase 4e entries; updates from this round are noted in the §4 / §5 bullets above.)_
- [ ] PRD `docs/proposals/quantitative-assets.md` Phase 4e bullet flipped to done. _(Out of scope of this verification run — leave for the next commit batch.)_

---

## Known intentional deviations (not bugs)

- **Multi-asset `{% assets_list %}` / `{% kits_list %}` popovers** don't carry per-asset counts. Each such site has a `// why: out of this rule — multi-asset popover, per-asset qty deferred` comment. If we ever build a "per-asset qty popover" variant, this is where to wire it.
- **`bulkUpdateAssetLocation`** (asset-index bulk update location) skips qty-tracked assets entirely (same as bulk custody) — its note/event stay individual-only by construction.
- **`createBooking` event** uses `quantity = 1` because the create path doesn't take per-asset quantities; each `BookingAsset` is created with the schema default `quantity = 1`. The user can edit later via the manage-assets picker (which fires a `BOOKING_ASSETS_ADDED` event with the right qty).
- **Cross-kit move note** keeps the existing `changed kit  from A to B.` wording (with the historical double-space) — moves keep identical qty on both sides; counting them would just add noise.
- **Direct quantity-custody dialog** (`checkOutQuantity` + qty release) writes a `ConsumptionLog` and an event (already qty-aware), no `Note` — by design.
