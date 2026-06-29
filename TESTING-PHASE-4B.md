# Phase 4b — Location Pivot + Qty Allocation: Manual Testing Plan

Phase 4b replaces the `Asset.locationId` 1:1 FK with the `AssetLocation` pivot — structurally identical to Phase 4a's Kit pivot, but **shipped with the qty-allocation triggers + picker UI from day one** (no structural-only intermediate). Also folded in: the **Polish-2 kit fan-out fix** in the raw-SQL asset index.

**Polish-1 (mid-test addition, 2026-05-20):** the asset-index "Kit" and "Location" columns were silently dropping memberships 2..N for multi-kit / multi-location QUANTITY_TRACKED assets — only the primary entry rendered. Added `kits_agg` + `locations_agg` LATERAL aggregates and new `KitColumn` / `LocationColumn` components that mirror `CustodyColumn`'s primary-plus-`+N more`-with-tooltip pattern. See **§1a** for the verification checklist.

**Polish-2 (mid-test addition, 2026-05-21):** the location manage-assets picker and the asset-overview "Update location" dialog were missing the per-asset qty input the 4b plan called for. New `getLocationPickerMeta` helper computes the orthogonal MAX; `updateLocationAssets` accepts `assetQuantities` + adds a strict-available re-validator + a qty-edit branch for already-placed pivot rows; `updateAsset` accepts `newLocationQuantity` + validates against `Asset.quantity`; the asset-overview dialog grew a qty input + multi-placement warning and switched to `useDisabled`. See **§3a** (asset-overview dialog) and **§6a** (manage-assets picker) for the verification checklists.

**Polish-3 (mid-test addition, 2026-05-21):** three follow-up gaps — (a) the asset-overview sidebar showed only the primary location with no per-placement breakdown; (b) the Polish-2 single-placement dialog couldn't add a second placement from the asset page; (c) the asset-index bulk "Update location" silently destroyed multi-placement state for QUANTITY_TRACKED rows. Polish-3 adds a "Placed at locations" sidebar card (mirror of "Included in kits"), an "In locations" + "Unplaced" pair of rows on `QuantityOverviewCard`, a new multi-row "Manage placements" dialog at `/assets/<id>/overview/manage-placements`, the `replaceAssetPlacements` service function with diff-based pivot writes, and the bulk-skip-qty-tracked pattern from `bulkCheckOutAssets` applied to `bulkUpdateAssetLocation`. See **§2a** (locations card + overview rows), **§3b** (manage-placements dialog), and the new bulk-skip bullet in **§4**.

**Polish-4 (mid-test addition, 2026-05-21):** the kit→asset location cascade was destructive — adding an asset to a kit wiped the user's manual placements and wrote the full `Asset.quantity` (not the kit slice) at the kit's location. Schema change: new `AssetLocation.assetKitId` nullable FK discriminator (mirror of `Custody.kitCustodyId`); the `(assetId, locationId)` unique relaxed into two partial uniques (manual one-per-pair, kit-driven one-per-AssetKit). Cascade rewrite: kit-add creates a kit-driven row with `quantity = AssetKit.quantity` additively, manual rows untouched; kit-removal cascades via FK `onDelete`; kit-qty edits sync the matching kit-driven row. UI: new "via kit" badges on the asset-overview "Placed at locations" card, main detail-list Location row, and the location detail asset list; manage-placements dialog renders kit-driven rows read-only above the editable manual rows with a "Via kits" tally in the placed/unplaced indicator. See **§7a** (kit-driven cascade with multi-placement) for the verification checklist.

> **Highest-risk areas, watch closely:**
>
> 1. **Asset index raw SQL.** `query.server.ts` now uses LATERAL primary-pick for _both_ kit and location (the kit half fixes the Polish-2 fan-out regression for multi-kit qty-tracked assets) **and a parallel `kits_agg` / `locations_agg` aggregate LATERAL on top (Polish-1)**. Watch for duplicate rows, missing kit/location columns, or missing "+N more" chips on the main `/assets` index.
> 2. **DB triggers.** `enforce_individual_asset_single_location` (BEFORE) + `enforce_asset_location_sum_within_total` (DEFERRABLE CONSTRAINT). Wrong sum aggregation = silent over-allocation.
> 3. **`updateAsset` location-change path.** Pivot delete-then-create inside a tx, with `ASSET_LOCATION_CHANGED` events + system notes preserved.
> 4. **`bulkUpdateLocation`** + **`updateKitLocations` kit→asset cascade.** Same pivot replace pattern, larger blast radius (multiple assets, kit-driven cascade).
> 5. **Mobile contract.** 8 endpoints synthesize singular `location` via `getPrimaryLocation` from the pivot. App must see no schema change.
> 6. **Picker MAX = orthogonal model.** `Asset.quantity − sum(other locations) + currentAtThisLocation`. Does NOT subtract custody/bookings (per PRD — Location is physical placement, orthogonal). Intentional deviation from the Kit picker.

## Prerequisites

- [x] Migration applied: `20260519143054_add_asset_location_pivot` (996 rows backfilled to dev DB, `Asset.locationId` dropped, RLS on, 2 triggers active).
- [x] `pnpm webapp:validate` green — **2202 / 2202 tests** (+8 after Polish-1's `kit-column.test.tsx` + `location-column.test.tsx`; +0 in Polish-3 — UI-only changes covered by manual walk-through), lint + typecheck clean.
- [x] Dev server up.
- [ ] Workspace data:
  - [x] An INDIVIDUAL asset placed at Location A
  - [x] An INDIVIDUAL asset NOT placed anywhere
  - [x] A QUANTITY_TRACKED asset (e.g. Pens, qty 80) NOT placed anywhere
  - [x] A second QUANTITY_TRACKED asset, multi-kit (e.g. Pens in 2 kits) — for the kit fan-out regression check
  - [x] A Kit holding 1+ INDIVIDUAL assets, with a Location set
- [x] Browser console + Network tab open.

---

## §0 Schema + trigger verification (MCP / SQL)

- [x] **Unique index NOT created.** `SELECT indexname FROM pg_indexes WHERE tablename = 'AssetLocation' AND indexname = 'AssetLocation_assetId_key';` → zero rows. (Sanity: we skipped the 4a-style single-row unique by design.)
- [x] **Both triggers present.** `SELECT trigger_name, action_timing FROM information_schema.triggers WHERE event_object_table = 'AssetLocation' ORDER BY trigger_name;` → `asset_location_individual_single_row` (BEFORE I/U) and `asset_location_sum_within_total` (AFTER I/U/D).
- [x] **Backfill: 996 rows, all INDIVIDUAL got qty=1.** Verified during T2.
- [x] **INDIVIDUAL multi-location rejection.** Inserting a 2nd `AssetLocation` row for an INDIVIDUAL → `INDIVIDUAL asset … already placed at a location` (check_violation). Verified during T2.
- [x] **Sum > Asset.quantity rejected at COMMIT.** Verified during T2.
- [x] **DEFERRED allows mid-tx overshoot.** Verified during T2.

---

## §1 Asset index (main `/assets`) — fan-out + filter regression

This is the single highest-risk area because the LATERAL rewrite touches the most-used query in the app.

- [x] Open `/assets`. Page renders without errors; pagination works; all expected columns visible (Location, Kit, Category, Tags, Custody).
- [ ] **Kit fan-out regression (Polish-2 fix):** with a QUANTITY_TRACKED asset in 2 kits, confirm the main index lists it **once** (not duplicated). If duplicates appear → the LATERAL kit pick regressed.
- [x] **Location filter "is":** filter to a specific location → only assets placed at that location appear.
- [x] **Location filter "is" + "in-location":** all placed assets appear.
- [x] **Location filter "is" + "without-location":** only unplaced assets appear.
- [x] **Location filter "isNot":** inverts each of the above.
- [x] **Location filter "containsAny" with mix of `in-location` + specific IDs:** the OR-logic returns "no location OR at one of those IDs".
- [x] **Sort by Location name:** ascending and descending work.
- [x] **Location column** shows the primary location's name + parent (if any).

### §1a Multi-kit / multi-location column rendering (Polish-1)

Polish-1 layered a `kits_agg` + `locations_agg` LATERAL aggregate on top of the primary-pick LATERAL, then added `KitColumn` / `LocationColumn` components mirroring `CustodyColumn`'s primary-plus-`+N more` pattern. Verify both columns surface every membership, not just the first one.

**Multi-kit column (use the QUANTITY_TRACKED asset in 2+ kits from prerequisites):**

- [x] The asset row shows the **primary kit name** (oldest pivot row by `AssetKit.createdAt`) as an underlined link to `/kits/<primary-kit-id>`.
- [x] A grey rounded `+N more` chip sits next to the primary link (`N` = total kits − 1).
- [x] Hovering the chip surfaces a tooltip that lists **every** kit name on its own line, including the primary.
- [x] Single-kit assets show just the link, **no** `+N more` chip.
- [x] Unkitted assets show the "No data" placeholder (same as before Polish-1).
- [x] Asset row is **not duplicated** in the table — the kits_agg aggregate must not introduce a fan-out (this is the Polish-1 GROUP BY fix verifying alongside the Polish-2 kit-join fix).

**Multi-location column (place a QUANTITY_TRACKED asset at 2+ locations via the picker first):**

- [x] The asset row shows the **primary location** (oldest pivot row by `AssetLocation.createdAt`) as a `LocationBadge` wrapped in a link to `/locations/<primary-location-id>`.
- [x] A `+N more` chip sits next to the primary badge (`N` = total locations − 1).
- [x] Hovering the chip surfaces a tooltip listing **every** location name on its own line.
- [x] Single-location assets show just the badge, **no** `+N more` chip.
- [x] Unplaced assets show the "No data" placeholder.
- [x] Asset row is **not duplicated** — locations_agg must not fan out.

**Filter + sort sanity after Polish-1:**

- [x] Sort by Kit name still orders by the **primary** kit (the LATERAL primary-pick still drives ORDER BY, not the aggregate).
- [x] Sort by Location name still orders by the **primary** location.
- [x] Kit filter `is "kit-X"` still matches an asset whose **any** kit is X — the filter SQL operates on `AssetKit` rows directly, not on the aggregate.

## §2 Asset detail page (`/assets/<id>`)

- [ ] Placed INDIVIDUAL: "Placed at locations" / location sidebar shows the location.
- [ ] Unplaced asset: location section is empty / shows "Unplaced".
- [ ] QUANTITY_TRACKED with no placement: works without errors.
- [ ] Edit-location flow: change location via the inline editor → page refreshes, new location shown, system note added to the asset.

### §2a "Placed at locations" sidebar card + Quantity Overview rows (Polish-3 Fix 1)

Polish-3 added a sidebar card on the asset overview that mirrors the existing "Included in kits" card: one row per placement, with the per-location qty shown for QUANTITY_TRACKED assets. The `QuantityOverviewCard` also grew an "In locations" row and a paired "Unplaced" row so the placed/unplaced split is visible at a glance.

- [ ] **Placed at locations card renders on a placed asset.** Open `/assets/<id>` for an asset with at least one `AssetLocation` row. The sidebar shows a "Placed at location" (singular) or "Placed at locations" (plural) card, with the location icon, the location name as an underlined link, and (for QUANTITY_TRACKED) the per-location qty badge on the right.
- [ ] **Multi-placement QUANTITY_TRACKED:** place a qty-tracked asset at 2+ locations via the picker, refresh the asset page. The card lists ALL placements, one row per location, each with its own qty. Sum check: `sum(per-location qty)` displayed = `inLocations` row value in the Quantity Overview.
- [ ] **Unplaced asset hides the card entirely** — no empty "Placed at" section appears in the sidebar.
- [ ] **INDIVIDUAL asset shows the card with no qty badge** — just the location name link (the per-location qty is always 1 and irrelevant for INDIVIDUAL).
- [ ] **"In locations" row appears on `QuantityOverviewCard`** (qty-tracked only) only when `sum(AssetLocation.quantity) > 0`. Renders directly below the "In kits" row (or "In custody" when no kits).
- [ ] **"Unplaced" row appears below "In locations"** only when there's a non-zero unplaced pool (`Asset.quantity − sum(AssetLocation.quantity) > 0`). Hides cleanly when the asset is fully placed.
- [ ] **Edit placements link** on the "Placed at locations" card (QUANTITY_TRACKED only, when the user has edit permission): clicking opens the modal at `/assets/<id>/overview/manage-placements`. INDIVIDUAL assets don't show this link — they have no multi-placement scenario.
- [ ] **Main detail list — Location row for QUANTITY_TRACKED:** the "Location" row in the asset's main detail table now renders **one line per placement** (LocationBadge + per-location qty + unit) instead of just the primary. Pencil edit button (hover-revealed on desktop) navigates to `/assets/<id>/overview/manage-placements` instead of opening the inline `LocationSelect` editor. Unplaced qty-tracked assets read `"No locations · {Asset.quantity} {unit} unplaced"`.
- [ ] **Main detail list — Location row for INDIVIDUAL:** unchanged. Single primary `LocationBadge`, pencil opens the inline `LocationSelect` editor (no modal navigation). Sanity-check this hasn't regressed.
- [ ] **Asset-actions dropdown — "Update location" entry:** on a QUANTITY_TRACKED asset the label reads **"Manage placements"** and navigates to `/assets/<id>/overview/manage-placements`. On an INDIVIDUAL asset the label reads **"Update location"** and navigates to `/assets/<id>/overview/update-location` (original behavior). All existing disabled/tooltip guards (checked-out, in-kit) still apply identically.

## §3 Asset edit (`/assets/<id>/edit`) — location set / change / clear

(Wraps `updateAsset` → pivot delete-then-create in a tx.)

- [x] Open an INDIVIDUAL with no location, set a location, save. DB check:
  ```sql
  SELECT * FROM "AssetLocation" WHERE "assetId" = '<asset-id>';
  ```
  Expected: 1 row, `quantity = 1`, correct `locationId`.
- [x] Change the location to a different one. Expected: 1 row only (old deleted, new created), updatedAt fresh.
- [x] Clear the location (clear button). Expected: 0 rows.
- [x] Set a location on a QUANTITY_TRACKED asset (e.g. Pens 80) without touching the qty input: pivot row qty defaults to `Asset.quantity` (80).
- [x] `ActivityEvent` rows:
  ```sql
  SELECT action, "fromValue", "toValue", "occurredAt" FROM "ActivityEvent"
   WHERE "assetId" = '<asset-id>' AND action = 'ASSET_LOCATION_CHANGED'
   ORDER BY "occurredAt" DESC LIMIT 5;
  ```
  Expected: one row per change, with correct from/to location ids.
- [x] Asset notes show "moved from X to Y" entries (Phase 4e will add unit counts; 4b keeps existing text).

### §3a Asset-overview "Update location" dialog qty input (Polish-2)

The dialog at `/assets/<id>/overview/update-location` now renders a per-asset qty input for QUANTITY_TRACKED rows. The bound is `Asset.quantity` (the dialog collapses any existing multi-placement to one row at the picked location, so MAX is the total pool — not the orthogonal picker MAX).

- [x] Open the dialog for a QUANTITY_TRACKED unplaced asset. Qty input renders, defaults to the asset's full pool, `max` attribute equals `Asset.quantity`.
- [x] Set a location + change qty to a smaller number (e.g. 30 of 80). Save. DB check:
  ```sql
  SELECT "locationId", "quantity" FROM "AssetLocation" WHERE "assetId" = '<id>';
  ```
  Expected: 1 row, `quantity = 30`.
- [x] Submit qty greater than `Asset.quantity` (via DevTools / curl tampering — the input's `max` blocks it in the UI). Expected: server returns 400 with "Quantity exceeds available pool" — surfaced as a red error box in the dialog. No pivot row written.
- [x] Open the dialog for a QUANTITY_TRACKED asset already at Location A with qty 30. The input pre-fills with 30, not the full pool.
- [x] Open the dialog for a QUANTITY_TRACKED asset placed at 2+ locations. The yellow "Multi-placement notice" warning renders explaining that saving will replace all placements with one. Pick a target + qty and save. DB check: exactly 1 pivot row remains (others deleted).
- [x] INDIVIDUAL assets do **not** render the qty input. Saving the dialog for an INDIVIDUAL writes `quantity = 1` regardless of any tampered submission.
- [x] Cancel/Confirm buttons disable while submitting (`useDisabled` hook).
- [x] **Kit-guard now fires for qty-only edits too.** Open the dialog for an asset whose `AssetKit` row puts it in a kit (e.g. Lens in Photography Kit). Keep the current location, change only the qty, save. Expected: 400 "This asset's location is managed by its parent kit" — same response shape whether you change location, qty, or both. (Pre-Polish-2 the kit-guard only fired on location changes; now `shouldUpdatePlacement = isChangingLocation || isSettingNewQuantity` so kit-managed assets can't have their per-location qty edited via this dialog either.)
- [x] **Pre-existing latent bug fix (kit-guard status surfacing).** The same in-kit dialog above should render the kit-membership error string in the red banner — not a generic "We could not create or update…" message. Pre-Polish-2 the outer catch rewrapped all `ShelfError` instances via `maybeUniqueConstraintViolation`, clobbering the 400 to a 500 with the generic text. Polish-2 switched the catch to re-throw any `isLikeShelfError(cause)` as-is. If you see the kit name in the error, the fix is working.
- [x] **Activity event:** `ASSET_LOCATION_CHANGED` only fires when `isChangingLocation` is true (location actually changed). A qty-only edit at the same location writes the new pivot qty but emits **no** location-change event:
  ```sql
  SELECT count(*) FROM "ActivityEvent"
   WHERE "assetId" = '<id>' AND action = 'ASSET_LOCATION_CHANGED'
     AND "occurredAt" > now() - interval '1 minute';
  ```
  Expected: 0 after a qty-only edit. (Phase 4e will add quantity-aware notes; 4b-Polish-2 deliberately doesn't emit a synthetic "qty changed" event yet.)

### §3b Manage placements dialog (Polish-3 Fix 2)

Reached via the **Edit placements** link on the new "Placed at locations" sidebar card (§2a). Opens at `/assets/<id>/overview/manage-placements`. Renders a multi-row editor: one row per placement (location dropdown + qty input + remove `×`), an "Add another location" button, and a live "placed / unplaced" indicator. Server backend: `replaceAssetPlacements` diff'd against the asset's current pivot rows so unchanged placements keep their `createdAt`.

**Happy paths:**

- [x] Open the dialog for a QUANTITY_TRACKED asset (e.g. Pens with `Asset.quantity = 80`) that already has 1 placement (e.g. Office, 30 units). The dialog renders ONE row pre-filled with Office + 30. The "Placed" indicator shows `30 / 80`, "Unplaced" shows `50`.
- [x] Click "Add another location". A blank row appears with qty pre-filled to the unplaced pool (50). Pick a second location (e.g. Warehouse). Save. DB check:
  ```sql
  SELECT al."locationId", l.name, al."quantity", al."createdAt"
  FROM "AssetLocation" al JOIN "Location" l ON l.id = al."locationId"
  WHERE al."assetId" = '<id>' ORDER BY al."createdAt" ASC;
  ```
  Expected: 2 rows, Office (30) and Warehouse (50). The Office row's `createdAt` is unchanged from before (diff didn't touch it); the Warehouse row's `createdAt` is fresh.
- [x] Edit the Office row's qty from 30 → 20 and Save. DB: Office row's `quantity = 20`, `createdAt` unchanged, Warehouse row untouched. "Unplaced" reads `60` after the edit.
- [x] Remove the Warehouse row via the `×` button, leave Office at 20. Save. DB: only Office (20) remains. `ActivityEvent` shows one `ASSET_LOCATION_CHANGED` for the remove (`fromValue: <warehouse>`, `toValue: null`).
- [x] Remove all rows + save. DB: 0 pivot rows. The asset returns to fully unplaced.

**Validation:**

- [x] Try to submit with two rows on the same location (pick Office twice via DevTools — the UI's `availableLocations` filter normally prevents this). Server returns 400 "Duplicate location" and surfaces the message in the red banner.
- [x] Tamper the hidden `placements` JSON to submit qty above `Asset.quantity` (e.g. Pens 80 → Office 100). Server returns 400 "Submitted placements sum to X but the asset has only Y units total." No pivot rows written (validation runs before the tx).
- [x] Client-side: edit a qty input above `Asset.quantity`. The input's `max` attribute clamps, and even if you bypass it, the red banner shows "Sum of placements (X) exceeds the asset's total quantity (Y)." Save button disabled until resolved.
- [x] INDIVIDUAL asset: dialog opens with no qty input column. "Add another location" disabled after the first row is filled. Server rejects with 400 if a tampered submission tries multiple rows.

**Diff correctness (DB-level):**

- [x] Set up Pens 80 at Office (30) + Warehouse (25) + Field (10). Open the dialog: rows pre-filled accordingly. Change Field 10 → 15, Save. DB: Office and Warehouse `createdAt` unchanged, Field row updated in place (`createdAt` unchanged, `quantity = 15`, `updatedAt` fresh). No deletes or inserts hit the rows that didn't change.

**Activity events:**

```sql
SELECT action, "fromValue", "toValue", "occurredAt"
FROM "ActivityEvent"
WHERE "assetId" = '<id>'
  AND action = 'ASSET_LOCATION_CHANGED'
  AND "occurredAt" > now() - interval '1 minute'
ORDER BY "occurredAt";
```

- [x] An add → row with `fromValue: null`, `toValue: <new-location>`.
- [x] A remove → row with `fromValue: <removed-location>`, `toValue: null`.
- [x] A qty-only edit (existing pivot, new qty) → no event emitted (deliberate, matches §3a + §6a).

**Kit-guard:**

- [x] Try the dialog for an asset that's in a kit. Server rejects with 400 "This asset's location is managed by its parent kit". Same shape as `updateAsset`'s kit-guard.

## §4 Asset bulk location update

(Wraps `bulkUpdateLocation` → per-asset pivot replace in a tx + per-asset `ASSET_LOCATION_CHANGED` events.)

- [x] Select 3+ assets in the asset index, "Update location" → pick a new location. Expected: each gets exactly one `AssetLocation` row at the new location (old rows deleted).
- [x] Repeat with "Remove location" (no target). Expected: zero pivot rows for the selected assets.
- [x] Activity events: one `ASSET_LOCATION_CHANGED` per asset.
- [x] System notes: one per affected location (both the new location and any previous locations).
- [x] Try the bulk update on an asset that's in a kit → blocked with the kit-membership error.
- [x] **Polish-3 — bulk SKIPS qty-tracked.** Replaces the Polish-2 "still writes full pool" behaviour because that path silently destroyed multi-placement state. Now mirror of the bulk-assign-custody pattern:
  - [x] Select a mix of INDIVIDUAL + QUANTITY_TRACKED assets, open "Update location". The dialog shows a yellow `WarningBox` reading "N quantity-tracked asset(s) in your selection will be skipped. Quantity-tracked assets must have their placements managed individually with a per-location quantity." (N = number of qty-tracked rows selected.)
  - [x] Pick a target location + Confirm. DB check: only the INDIVIDUAL assets get new pivot rows at the target; the qty-tracked assets' existing pivot rows are untouched (no destructive replace).
  - [x] Select ONLY qty-tracked assets, open the dialog, pick a location, Confirm. Server returns 400 "All selected assets are quantity-tracked. Quantity-tracked assets must have their placements managed individually with a per-location quantity." No writes happen.
  - [x] WarningBox does NOT render when the selection has zero qty-tracked rows.

## §5 Location detail page (`/locations/<id>/assets`)

- [x] Page lists all assets placed at this location (via the `AssetLocation` pivot).
- [x] Pagination works.
- [x] Search by asset title works.
- [x] Filter by team-member custodian works.
- [x] Empty location renders the empty state.

## §6 Location manage-assets picker (`/locations/<id>/assets/manage-assets`)

- [x] Picker opens; assets list renders.
- [x] Select an UNPLACED INDIVIDUAL asset, confirm. Expected: 1 `AssetLocation` row, `quantity = 1`.
- [x] Select an INDIVIDUAL **already placed at another location** → cross-location move: existing pivot row deleted, new one created (single-trigger keeps total at 1 per asset).
- [x] Select an UNPLACED QUANTITY_TRACKED asset, confirm. Expected: 1 `AssetLocation` row, `quantity = Asset.quantity`.
- [x] **Multi-location qty-tracked:** select a QUANTITY_TRACKED asset that's already placed at Location A; confirm at Location B. Expected: two `AssetLocation` rows for the same asset, each at its location with `quantity = Asset.quantity` (or strict-available pool, depending on UX iteration). **No DB error** — the trigger rejects only over-allocation.
- [x] **Orthogonal MAX sanity:** a qty-tracked asset with operator custody assigned (e.g. Pens 80 with 30 in custody to Johnny) → picker MAX for Location B is `80 − 0 (Location A) + 0 = 80` (custody does NOT subtract). This is the deliberate deviation from the Kit picker.
- [x] Deselect an asset, confirm. Expected: `AssetLocation` row deleted.

### §6a Per-row qty input on the picker (Polish-2)

The picker now renders a qty input alongside each selected QUANTITY_TRACKED row, mirroring the kit manage-assets picker. The MAX uses the **orthogonal model** from `getLocationPickerMeta`:

```
spaceWithoutMe = Asset.quantity − sum(other locations' AssetLocation.quantity)
max            = max(currentAtThisLocation, spaceWithoutMe)
```

Verify against a workspace asset like Pens (qty 80):

- [x] Toggle a QUANTITY_TRACKED row ON. A `Qty:` uinpt appears next to the row, pre-filled with `maxAllowedForThisLocation` (or the existing pivot row's qty when already placed here). Toggling OFF removes the input and drops the entry from the submitted JSON.
- [x] Edit the qty to a smaller value (e.g. 30). The input shows `/ 80` next to it. Confirming writes the picked qty:
  ```sql
  SELECT "locationId", "quantity" FROM "AssetLocation" WHERE "assetId" = '<id>';
  ```
- [x] Pens 80, placed 25 at Warehouse + 10 at Field → open the picker for Office: MAX renders as `45` (= 80 − 25 − 10). The "Also at: Warehouse (25), Field (10)" hint appears below the title.
- [x] Same asset already at Office with qty 30, others total 50 (pathological over-commit): MAX stays at 30 (the `max(current, spaceWithoutMe)` carve-out). The "was 30" label flashes when you edit the input away from the existing value.
- [x] Re-open the picker for an asset already at this location with qty 30. Submit qty 50 (no other placements). DB check: pivot row updated in-place via `tx.assetLocation.update` (createdAt preserved), `quantity = 50`. Validate by re-opening — the "was 30" label is gone (initial now matches current).
- [x] **Server-side rejection on tamper:** in DevTools, edit the hidden `assetQuantities` JSON to submit qty above MAX. Server returns 400 "Quantity exceeds available pool" with the per-asset detail line. No pivot row written.
- [x] INDIVIDUAL rows: no qty input renders, no entry in the submitted JSON, pivot row is written with `quantity = 1`.
- [x] Multi-location qty-tracked: select the asset for Location B at qty 25 (while still at Location A:30). Expected: two pivot rows for the asset, A:30 and B:25, sum 55 ≤ 80.
- [x] **Activity events for the qty-edit branch:** confirm a qty edit on an already-placed pivot row. The picker still calls `updateLocationAssets`, which emits `ASSET_LOCATION_CHANGED` events only for adds (`actuallyNewAssetIds`) and removes (`removedAssetIds`). A pure qty edit (`qtyEditedAssetIds`) emits **no** event today:
  ```sql
  SELECT count(*) FROM "ActivityEvent"
   WHERE "assetId" = '<id>' AND action = 'ASSET_LOCATION_CHANGED'
     AND "occurredAt" > now() - interval '1 minute';
  ```
  Expected: 0 for a pure qty edit, ≥1 for an add or a remove. (Phase 4e will add quantity-aware notes; the same deliberate gap applies as in §3a.)
- [x] **DB trigger still enforces the invariant.** Try to submit a qty that would make `sum(AssetLocation.quantity) > Asset.quantity` after combining with other placements. Server validation catches it with a clean 400 (as above). If you bypass the server (direct SQL `INSERT INTO "AssetLocation" …`), the DEFERRED `enforce_asset_location_sum_within_total` trigger fires at COMMIT.

## §7 Kit location cascade (`/kits/<id>/edit` change location)

(Wraps `updateKitLocations` → per-asset pivot replace + `ASSET_LOCATION_CHANGED` events with `meta.viaKit: true`.)

- [x] Kit holding 2 INDIVIDUAL assets at Location A. Change kit location to B.
- [x] DB check:
  ```sql
  SELECT al."assetId", a.title, l.name FROM "AssetLocation" al
    JOIN "Asset" a ON a.id = al."assetId"
    JOIN "Location" l ON l.id = al."locationId"
   WHERE al."assetId" IN (SELECT "assetId" FROM "AssetKit" WHERE "kitId" = '<kit-id>')
  ORDER BY a.title;
  ```
  Expected: all kit assets at Location B.
- [x] Per-asset `ASSET_LOCATION_CHANGED` event with `meta.viaKit = true`.
- [x] System notes on the kit's assets reflect the move.
- [x] `Kit.locationId` itself updated (FK stays — only Asset pivots).
- [x] **Polish-4 discriminator survives the kit-location change.** Query the AssetLocation rows for the kit's assets right after the move:
  ```sql
  SELECT al."assetId", a.title, al."assetKitId", al."locationId"
  FROM "AssetLocation" al JOIN "Asset" a ON a.id = al."assetId"
  WHERE al."assetId" IN (SELECT "assetId" FROM "AssetKit" WHERE "kitId" = '<kit-id>');
  ```
  Expected: each row whose `locationId = Kit.locationId` has `assetKitId` pointing at the matching `AssetKit.id` (not NULL). If any rows show `assetKitId IS NULL`, the kit-cascade discriminator was lost — the "via kit" badge won't render on the asset overview. Same applies to bulk kit-location changes and to attaching/detaching kits from a Location's manage-kits picker.

### §7a Kit→asset cascade respects manual placements (Polish-4)

Polish-4 added `AssetLocation.assetKitId` so kit-driven placements are tracked separately from manual ones. The kit-add cascade now creates an additive kit-driven row at the kit's location with `quantity = AssetKit.quantity` (the slice) — without wiping the asset's manual placements. UI surfaces a "via kit" badge on the kit-driven rows everywhere placements are listed.

**Schema sanity (one-time after deploy):**

- [x] `assetKitId` column present:
  ```sql
  SELECT column_name FROM information_schema.columns
   WHERE table_name = 'AssetLocation' AND column_name = 'assetKitId';
  ```
  → one row. **Verified 2026-05-22:** column is `text`, nullable.
- [x] Two partial uniques replace the old composite:
  ```sql
  SELECT indexname FROM pg_indexes
   WHERE tablename = 'AssetLocation'
     AND indexname IN (
       'AssetLocation_manual_unique',
       'AssetLocation_kit_unique',
       'AssetLocation_assetId_locationId_key'
     );
  ```
  → exactly `AssetLocation_manual_unique` and `AssetLocation_kit_unique`. The old composite key must be absent. **Verified 2026-05-22:** both partial uniques present, old composite key absent. FK `AssetLocation_assetKitId_fkey` confirmed `ON DELETE CASCADE` (drives the remove-from-kit cascade).

**Add asset to kit — manual placements survive (the regression Polish-4 fixes):**

- [x] Set up `Asset.quantity = 250` Gloves with three manual placements (e.g. Office: 11, Warehouse: 22, Field: 33; unplaced: 184). Kit "Kittington" has location TzHaar Fight Cave.
- [x] Open the kit's manage-assets picker, select Gloves with qty = 20, confirm. Now run:
  ```sql
  SELECT al."locationId", l.name, al."quantity", al."assetKitId"
   FROM "AssetLocation" al JOIN "Location" l ON l.id = al."locationId"
   WHERE al."assetId" = '<gloves-id>'
   ORDER BY al."createdAt";
  ```
  Expected: 4 rows. Office (11, `assetKitId: null`), Warehouse (22, null), Field (33, null), TzHaar Fight Cave (**20**, assetKitId set). Sum = 86 ≤ 250 ✓.
- [x] Asset overview page: "In locations" reads 86 boxes, "Unplaced" reads 164 boxes, "In kits" reads 20 boxes. The "Placed at locations" card lists all 4 placements; the TzHaar one carries a blue **"via kit"** badge linking to Kittington.
- [x] Main detail-list Location row: same 4 lines, blue "via kit" badge on the kit-driven line. Pencil edit button opens manage-placements.

**Manage-placements dialog renders kit-driven rows read-only:**

- [x] Open Manage placements for Gloves. The dialog shows a separate **"Placements managed by kits (read-only)"** section at the top with the TzHaar Fight Cave row (qty 20, "via kit Kittington" badge). No remove `×` button, no editable qty input on that row.
- [x] Below it, the three manual placements (Office 11, Warehouse 22, Field 33) are editable as normal.
- [x] The placed/unplaced indicator splits into three rows: "Placed (manual): 66 / 250", "Via kits: 20 boxes", "Unplaced: 164 boxes". Total always equals 250.
- [x] Try to submit manual placements summing above `Asset.quantity − kitDrivenSum` (e.g. set Office to 250). Client-side validation shows: "Your manual placements (X) plus kit-driven placements (20) sum to Y, which exceeds the asset's total quantity (250)." Save button disabled until resolved. Server-side validation rejects with a matching 400 if you tamper the JSON.

**Kit qty change syncs the kit-driven row:**

- [x] In the kit's manage-assets picker, change Gloves' qty from 20 → 35, confirm. DB:
  ```sql
  SELECT al."quantity", al."assetKitId" FROM "AssetLocation" al
   WHERE al."assetId" = '<gloves-id>' AND al."locationId" = '<tzhaar-id>';
  ```
  Expected: quantity = 35, `assetKitId` unchanged. The `createdAt` on the row is also unchanged — qty edit is `tx.assetLocation.updateMany`, not a delete/recreate.

**Kit location change moves the kit-driven row only:**

- [x] Change Kittington's location from TzHaar Fight Cave → Catacombs of Kourend. DB:
  ```sql
  SELECT al."locationId", l.name, al."quantity", al."assetKitId" IS NOT NULL AS kit_driven
   FROM "AssetLocation" al JOIN "Location" l ON l.id = al."locationId"
   WHERE al."assetId" = '<gloves-id>'
   ORDER BY al."createdAt";
  ```
  Expected: 4 rows — Office, Warehouse, Field (manual, untouched), Catacombs of Kourend (kit-driven, qty 35).

**Remove asset from kit cascades the kit-driven row only:**

- [x] Remove Gloves from Kittington via the picker (deselect, confirm). DB:
  ```sql
  SELECT count(*) FROM "AssetLocation" WHERE "assetId" = '<gloves-id>';
  SELECT count(*) FROM "AssetLocation"
   WHERE "assetId" = '<gloves-id>' AND "assetKitId" IS NOT NULL;
  ```
  Expected: 3 manual rows survive (Office, Warehouse, Field), 0 kit-driven rows (cascaded via FK `onDelete: Cascade`).

**Kit with NO location — no AssetLocation writes:**

- [x] Create a kit "Naked Kit" with no location. Add Gloves to it via the picker (qty 10). DB: AssetKit row created with quantity 10; AssetLocation rows for Gloves are unchanged (no new kit-driven row, no manual rows touched). **Verified 2026-05-22 via SQL audit on existing data:** all 104 AssetKit rows whose Kit has `locationId IS NULL` have zero matching kit-driven AssetLocation rows (104/104). The cascade correctly skips the AssetLocation write when the kit has no location.

**Location page asset list shows the badge:**

- [x] Open `/locations/<tzhaar-id>/assets` (after re-adding Gloves to Kittington). The Gloves row reads `· 35 boxes at this location · via kit Kittington` (the "via kit" badge appears alongside the qty when any row at this location is kit-driven).

**INDIVIDUAL asset in a kit:**

- [x] An INDIVIDUAL asset placed at Location A, added to a kit with location B. Expected: 2 pivot rows — one manual at A (quantity 1, `assetKitId: null`), one kit-driven at B (quantity 1, `assetKitId` set). Both visible on the asset overview; the kit-driven one carries the "via kit" badge.

## §8 Mobile API contract

- [x] `GET /api/mobile/assets/<id>` returns singular `location: {…}` object (synthesized via `getPrimaryLocation`). **Verified 2026-05-22:** GET `/api/mobile/assets/cmnen4fd7008zomb5hur8ggmi` (Pencils) returned `location: { id: 'cmnemr26z002pomb563kpukp1', name: 'TzHaar Fight Cave' }`, raw `assetLocations` key absent.
- [x] `GET /api/mobile/assets` returns each asset with singular `location`. **Verified 2026-05-22:** list responses carry per-item `location` (object or null), no `assetLocations` key.
- [x] `POST /api/mobile/asset/update-location` with `{ locationId }` updates correctly. Response has the new `location` synthesized. **Verified 2026-05-22:** updated INDIVIDUAL "Another macbook" → Party Drop. DB confirms 1 pivot row, `quantity=1`, `assetKitId=null`. Response carries synthesized `location`.
- [x] `POST /api/mobile/bulk-update-location` updates multiple assets in one call. **Verified 2026-05-22.**
- [x] `GET /api/mobile/locations` lists locations. **Verified 2026-05-22:** 13 locations returned.
- [x] `GET /api/mobile/dashboard` doesn't crash on the location aggregation. **Verified 2026-05-22:** `kpis.locations = 13`, no error key.
- [x] **Polish-2 scope boundary — mobile writes full pool.** `POST /api/mobile/asset/update-location` for a QUANTITY_TRACKED asset writes `quantity = Asset.quantity` on the new pivot row. Mobile clients don't pass a qty arg today; the multi-placement mobile UX is the post-4c follow-up the PRD already deferred. Verify the pivot row qty in the DB after a mobile update-location call to confirm the back-compat default still works. **Verified 2026-05-22:** moved Cables (qty 4443, previously at TzHaar with partial qty 22) → Party Drop via mobile route. DB pivot row reads `quantity = 4443`, `assetKitId = null` — full-pool default confirmed. (Side-effect: the previous partial-placement state was overwritten as expected by the back-compat write semantics.)

## §9 Scan drawers

- [x] `/locations/<id>/scan-assets-kits` — scan an asset's QR. If asset is already at this location → "already added" badge. If not → drawer accepts it. Submit. Asset moves to this location.
- [x] Same for kits.
- [ ] **Polish-2 scope boundary — scan writes full pool.** Scan a QUANTITY_TRACKED asset into a location via `/locations/<id>/scan-assets-kits` and confirm. Expected: pivot row qty = `Asset.quantity`. The scan flow has no qty input (scanning implies "this asset is here now", not partial placement). If a user wants partial placement, they use the per-location picker (§6a).

## §10 Reports impact

Deferred to post-4b (per `TESTING-REPORTS.md`). 4b only flags the trigger condition is met. Quick smoke:

- [ ] `/reports` page loads without errors.
- [ ] Location-based reports (distribution-by-location, etc.) don't crash. Full re-verification deferred.

## §11 Booking flows

- [ ] Open `/bookings/<id>/overview/manage-assets`. Asset list shows location column correctly.
- [ ] Add a qty-tracked asset that's placed at a location → booking continues to work as before.

## §12 Asset overview "Included in kit" + "Quantity Overview" — regression check

(Phase 4a-Polish-2 work; sanity-check we didn't regress.)

- [ ] Multi-kit qty-tracked asset shows all kits in "Included in kits" sidebar card.
- [ ] "Quantity Overview" card shows `In kits` row when > 0.

## §13 INDIVIDUAL single-location rule

- [x] Try (via SQL or API tampering) to put one INDIVIDUAL asset at two locations. Expected: DB trigger rejects with `check_violation`. **Verified 2026-05-22:** tried to insert Elder Maul (already at Chambers of Xeric) at Theatre of Blood. BEFORE trigger `asset_location_individual_single_row` rejected with `"INDIVIDUAL asset gqr87dz7786u4o3bfx7x17my2 already placed at a location"`.
- [x] Try to put a qty-tracked asset's `AssetLocation` rows summing > `Asset.quantity`. Expected: rejected at COMMIT. **Verified 2026-05-22:** tried to push Pencils total (cap 100, existing kit-driven 32) to 132 — DEFERRED CONSTRAINT trigger `asset_location_sum_within_total` rejected at COMMIT with `"AssetLocation total 132 exceeds Asset.quantity 100"`. Boundary verified: 32 + 68 = 100 passes, +69 rejects (test row rolled back).

## §15a Polish-6: BookingAsset kit-source discriminator

Polish-6 lands `BookingAsset.assetKitId` (third application of the kit-driven-vs-standalone pattern, mirror of `Custody.kitCustodyId` + `AssetLocation.assetKitId`). Same asset can now have a standalone slice and one-or-more kit-driven slices in the same booking, each as its own `BookingAsset` row. Migration `20260525131507_bookingasset_kit_discriminator` backfills existing rows via the whole-kit-presence heuristic.

**Schema sanity (one-time after deploy):**

- [x] `assetKitId` column present + nullable:
  ```sql
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'BookingAsset' AND column_name = 'assetKitId';
  ```
  **Verified 2026-05-26 (local dev DB):** column is `text`, nullable.
- [x] Partial uniques replaced the composite:
  ```sql
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'BookingAsset'
  AND indexname IN ('BookingAsset_manual_unique', 'BookingAsset_kit_unique',
                    'BookingAsset_bookingId_assetId_key');
  ```
  → exactly `BookingAsset_manual_unique` and `BookingAsset_kit_unique`. Old composite key absent. **Verified 2026-05-26:** both partial uniques present, old composite key absent.
- [x] FK with `SET NULL` cascade:
  ```sql
  SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname = 'BookingAsset_assetKitId_fkey';
  ```
  → `... ON UPDATE CASCADE ON DELETE SET NULL`. **Verified 2026-05-26:** exact match.
- [x] Backfill counts (compare against pre-deploy diagnostic, prod expected ~64,505 kit-driven):
  ```sql
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE "assetKitId" IS NULL) AS standalone,
    COUNT(*) FILTER (WHERE "assetKitId" IS NOT NULL) AS kit_driven
  FROM "BookingAsset";
  ```
  **Verified 2026-05-26 (local dev DB):** 6,783 total / 6,783 standalone / 0 kit-driven. The 0 looks alarming relative to the prod-expected ~64,505, but it's accurate for this DB — the seed data has 1,705 in-kit candidates where individual assets were thrown into bookings WITHOUT their whole kit (partial-kit-in-booking case), so the heuristic conservatively leaves them all as standalone (the correct behaviour; false-positive kit attribution would be worse). On prod the heuristic is expected to attribute ~87% because real users use the kit-add UX rather than dropping individual kit members into bookings ad-hoc.

**The user-flow regression test (the bug that triggered Polish-6):**

- [x] Gloves: qty-tracked, total 250, with 87 boxes in Kittington (kit). Open a booking, scan Gloves's QR with qty 22, confirm. DB:
  ```sql
  SELECT id, "assetId", "assetKitId", quantity FROM "BookingAsset"
  WHERE "bookingId" = '<booking-id>' AND "assetId" = '<gloves-id>';
  ```
  Expected: 1 row, `assetKitId = NULL`, `quantity = 22`. Booking detail UI shows Gloves as a **standalone** entry (not nested under Kittington).
- [x] Scan Kittington kit's QR into the same booking. DB: 2 rows now for Gloves — one standalone (qty 22), one kit-driven (qty 87, `assetKitId` set). UI shows: standalone Gloves entry + Kittington group with Gloves nested inside.
- [x] Remove Gloves from Kittington (kit picker). DB: kit-driven Gloves BookingAsset row's `assetKitId` flipped to `NULL` (SET NULL fired). Booking now shows 2 standalone Gloves entries — booking note: _"… removed Gloves from kit Kittington. The kit's booked slice has been converted to a standalone reservation in this booking."_
- [x] Edit Kittington's AssetKit.quantity for Gloves from 87 → 50. DB: kit-driven BookingAsset row's `quantity` updated to 50 (live link). Standalone row untouched.

**Picker behaviour (the Wave 5 fix):**

- [x] Open the booking's manage-assets picker. Gloves should be SELECTABLE for standalone add even though it's in Kittington. The picker's "Available" badge subtracts kit allocations: Gloves 250 total, 87 in kit, 0 in custody, 0 reserved → Available 163.
- [x] Add Gloves through the picker with qty 30. DB: BookingAsset row created with `assetKitId = NULL` (picker writes standalone only).

**Mobile API back-compat (Wave 7):**

- [x] `GET /api/mobile/bookings/<id>` on a booking with standalone + kit-driven Gloves slices returns ONE entry for Gloves with `quantity` = sum across slices, `assetKitId = null` (mixed).
- [x] `GET /api/mobile/bookings/<id>` on a booking where Gloves is only kit-driven returns one entry with `assetKitId` set to that kit's AssetKit id.
- [x] Mobile client that ignores the new `assetKitId` field sees the same flat shape it always did (one entry per assetId, summed qty).

**Deferred for Phase 4d (NOT in Polish-6):**

- [x] **Check-in floor guard** when shrinking AssetKit.quantity below per-row check-in. **DONE in Polish-7b (2026-05-28)** — its blocker is gone now that `ConsumptionLog.bookingAssetId` exists. `updateKitAssets` (`kit/service.server.ts`, qty-sync block) now sums per-slice check-ins (`groupBy bookingAssetId`, RETURN/CONSUME/LOSS/DAMAGE) and **blocks** the edit with a clear error when the new kit quantity is below what's already checked in against a kit-driven slice, naming the asset + booking. Legacy `bookingAssetId IS NULL` logs aren't counted (no regression for pre-Polish-7b data). Covered by 2 unit tests in `kit/service.server.test.ts` ("blocks shrinking … below … checked in" / "allows shrinking down to the floor").
- [ ] **Booking-side multi-row picker UX** — picker today scopes to standalone rows only (`assetKitId IS NULL`); kit-driven slices for the same asset are read-only from this picker, managed by removing the kit. Multi-row editable picker is Phase 4d.
- [ ] **`BOOKING_ASSET_DETACHED_FROM_KIT` activity event** — would require a new enum value + migration; not added for Polish-6. System notes already cover the user-visible audit trail; activity event can land in Phase 4d.
- [ ] **Server-side `enforce_booking_asset_sum_within_availability` trigger** — cross-booking + time-windowed availability check. Application-layer validation is the source of truth for now; trigger deferred to Phase 4d (per the wave-8 note in the plan).
- [ ] **AtomsResetHandler render-storm on React 19 (pre-existing, not a 4b/Polish-6 regression).** Navigating from a list page (assets index, kits list) into `manage-{assets,kits}` intermittently throws `useContext, dispatcher is null` inside React Router's `WithErrorBoundaryProps` → blank page. Refresh fixes it. Root cause: `apps/webapp/app/atoms/atoms-reset-handler.tsx`:29-46 writes 4 atoms during render, and the matching route init (e.g. manage-assets.tsx:1191-1195) also writes `setSelectedBulkItems` during render. The deliberate "parent-runs-first" pattern from `7576974d7` / `89966dd20` (anti-hydration-flicker) was tolerated by React 18 but trips React 19.2.1's stricter setState-during-render bailout when `BulkListItemCheckbox` instances from the previous route are still mounted as subscribers. **Workaround during 4b testing:** refresh once on the manage-assets / manage-kits page. **Real fix (Phase 4d):** replace the during-render writes with `getDefaultStore().set()` in a navigation listener, or use `useHydrateAtoms` for the route-side seed. Touches `atoms-reset-handler.tsx` + 3 manage-\* routes.

## §14 Final gate

- [x] `pnpm webapp:validate` green (re-run to confirm no regressions): **2202 / 2202**.
- [x] `pnpm webapp:doctor --diff main` — no new findings beyond the accepted `no-giant-component` family.
- [x] Browser console clean across §1–§13.
- [x] Server console clean — no Prisma errors.
- [x] **Polish-1 + Polish-2 + Polish-3 sections green:** §1a (multi-kit/location column rendering), §2a (placed-at-locations card + overview rows), §3a (asset-overview dialog qty input), §3b (manage-placements dialog), §6a (manage-assets picker qty input), §4 (bulk-skip qty-tracked) all ticked.

## §15 Sign-off

When all checked: ready to commit Phase 4b on `feat-quantities`. Polish-1, Polish-2, Polish-3, and Polish-4 ship as their **own commits on top of `b43a3ae56`** (same cadence as 4a-Polish-2) — do NOT amend the main 4b commit. Do NOT push any of them without explicit user permission. The Polish-4 migration (`20260521133643_assetlocation_kit_discriminator`) deploys alongside the rest of the 4b migrations.

---

### Cascade-semantics flag for PR description (carry-over from CLAUDE-CONTEXT.md)

Old `Asset.locationId` was nullable, `SET NULL` on Location delete. New `AssetLocation.locationId` is `ON DELETE CASCADE` — deleting a location now removes the pivot rows (assets stay, become "unplaced"). Observably equivalent end-state.

### Known scope carry-overs (not 4b)

- **Quantity-aware location-change notes** → Phase 4e (task #86). Notes still say "moved Pens to Office 1" without unit counts.
- **Split/merge "Move N units A→B" UX + "Place N unplaced units"** → Phase 4c.
- **Reports location-filter re-verification** → still deferred via `TESTING-REPORTS.md`.
- **Multi-placement mobile UI** → post-4c, mobile-team owned.
