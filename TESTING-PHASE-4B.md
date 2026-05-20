# Phase 4b — Location Pivot + Qty Allocation: Manual Testing Plan

Phase 4b replaces the `Asset.locationId` 1:1 FK with the `AssetLocation` pivot — structurally identical to Phase 4a's Kit pivot, but **shipped with the qty-allocation triggers + picker UI from day one** (no structural-only intermediate). Also folded in: the **Polish-2 kit fan-out fix** in the raw-SQL asset index.

> **Highest-risk areas, watch closely:**
>
> 1. **Asset index raw SQL.** `query.server.ts` now uses LATERAL primary-pick for _both_ kit and location (the kit half fixes the Polish-2 fan-out regression for multi-kit qty-tracked assets). Watch for duplicate rows or missing location/kit columns on the main `/assets` index.
> 2. **DB triggers.** `enforce_individual_asset_single_location` (BEFORE) + `enforce_asset_location_sum_within_total` (DEFERRABLE CONSTRAINT). Wrong sum aggregation = silent over-allocation.
> 3. **`updateAsset` location-change path.** Pivot delete-then-create inside a tx, with `ASSET_LOCATION_CHANGED` events + system notes preserved.
> 4. **`bulkUpdateLocation`** + **`updateKitLocations` kit→asset cascade.** Same pivot replace pattern, larger blast radius (multiple assets, kit-driven cascade).
> 5. **Mobile contract.** 8 endpoints synthesize singular `location` via `getPrimaryLocation` from the pivot. App must see no schema change.
> 6. **Picker MAX = orthogonal model.** `Asset.quantity − sum(other locations) + currentAtThisLocation`. Does NOT subtract custody/bookings (per PRD — Location is physical placement, orthogonal). Intentional deviation from the Kit picker.

## Prerequisites

- [x] Migration applied: `20260519143054_add_asset_location_pivot` (996 rows backfilled to dev DB, `Asset.locationId` dropped, RLS on, 2 triggers active).
- [x] `pnpm webapp:validate` green — **2177 / 2177 tests**, lint + typecheck clean.
- [ ] Dev server up.
- [ ] Workspace data:
  - [ ] An INDIVIDUAL asset placed at Location A
  - [ ] An INDIVIDUAL asset NOT placed anywhere
  - [ ] A QUANTITY_TRACKED asset (e.g. Pens, qty 80) NOT placed anywhere
  - [ ] A second QUANTITY_TRACKED asset, multi-kit (e.g. Pens in 2 kits) — for the kit fan-out regression check
  - [ ] A Kit holding 1+ INDIVIDUAL assets, with a Location set
- [ ] Browser console + Network tab open.

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

- [ ] Open `/assets`. Page renders without errors; pagination works; all expected columns visible (Location, Kit, Category, Tags, Custody).
- [ ] **Kit fan-out regression (Polish-2 fix):** with a QUANTITY_TRACKED asset in 2 kits, confirm the main index lists it **once** (not duplicated). If duplicates appear → the LATERAL kit pick regressed.
- [ ] **Location filter "is":** filter to a specific location → only assets placed at that location appear.
- [ ] **Location filter "is" + "in-location":** all placed assets appear.
- [ ] **Location filter "is" + "without-location":** only unplaced assets appear.
- [ ] **Location filter "isNot":** inverts each of the above.
- [ ] **Location filter "containsAny" with mix of `in-location` + specific IDs:** the OR-logic returns "no location OR at one of those IDs".
- [ ] **Sort by Location name:** ascending and descending work.
- [ ] **Location column** shows the primary location's name + parent (if any).

## §2 Asset detail page (`/assets/<id>`)

- [ ] Placed INDIVIDUAL: "Placed at locations" / location sidebar shows the location.
- [ ] Unplaced asset: location section is empty / shows "Unplaced".
- [ ] QUANTITY_TRACKED with no placement: works without errors.
- [ ] Edit-location flow: change location via the inline editor → page refreshes, new location shown, system note added to the asset.

## §3 Asset edit (`/assets/<id>/edit`) — location set / change / clear

(Wraps `updateAsset` → pivot delete-then-create in a tx.)

- [ ] Open an INDIVIDUAL with no location, set a location, save. DB check:
  ```sql
  SELECT * FROM "AssetLocation" WHERE "assetId" = '<asset-id>';
  ```
  Expected: 1 row, `quantity = 1`, correct `locationId`.
- [ ] Change the location to a different one. Expected: 1 row only (old deleted, new created), updatedAt fresh.
- [ ] Clear the location (clear button). Expected: 0 rows.
- [ ] Set a location on a QUANTITY_TRACKED asset (e.g. Pens 80). Expected: 1 row, `quantity = 80` (full pool).
- [ ] `ActivityEvent` rows:
  ```sql
  SELECT action, "fromValue", "toValue", "occurredAt" FROM "ActivityEvent"
   WHERE "assetId" = '<asset-id>' AND action = 'ASSET_LOCATION_CHANGED'
   ORDER BY "occurredAt" DESC LIMIT 5;
  ```
  Expected: one row per change, with correct from/to location ids.
- [ ] Asset notes show "moved from X to Y" entries (Phase 4e will add unit counts; 4b keeps existing text).

## §4 Asset bulk location update

(Wraps `bulkUpdateLocation` → per-asset pivot replace in a tx + per-asset `ASSET_LOCATION_CHANGED` events.)

- [ ] Select 3+ assets in the asset index, "Update location" → pick a new location. Expected: each gets exactly one `AssetLocation` row at the new location (old rows deleted).
- [ ] Repeat with "Remove location" (no target). Expected: zero pivot rows for the selected assets.
- [ ] Activity events: one `ASSET_LOCATION_CHANGED` per asset.
- [ ] System notes: one per affected location (both the new location and any previous locations).
- [ ] Try the bulk update on an asset that's in a kit → blocked with the kit-membership error.

## §5 Location detail page (`/locations/<id>/assets`)

- [ ] Page lists all assets placed at this location (via the `AssetLocation` pivot).
- [ ] Pagination works.
- [ ] Search by asset title works.
- [ ] Filter by team-member custodian works.
- [ ] Empty location renders the empty state.

## §6 Location manage-assets picker (`/locations/<id>/assets/manage-assets`)

- [ ] Picker opens; assets list renders.
- [ ] Select an UNPLACED INDIVIDUAL asset, confirm. Expected: 1 `AssetLocation` row, `quantity = 1`.
- [ ] Select an INDIVIDUAL **already placed at another location** → cross-location move: existing pivot row deleted, new one created (single-trigger keeps total at 1 per asset).
- [ ] Select an UNPLACED QUANTITY_TRACKED asset, confirm. Expected: 1 `AssetLocation` row, `quantity = Asset.quantity`.
- [ ] **Multi-location qty-tracked:** select a QUANTITY_TRACKED asset that's already placed at Location A; confirm at Location B. Expected: two `AssetLocation` rows for the same asset, each at its location with `quantity = Asset.quantity` (or strict-available pool, depending on UX iteration). **No DB error** — the trigger rejects only over-allocation.
- [ ] **Orthogonal MAX sanity:** a qty-tracked asset with operator custody assigned (e.g. Pens 80 with 30 in custody to Johnny) → picker MAX for Location B is `80 − 0 (Location A) + 0 = 80` (custody does NOT subtract). This is the deliberate deviation from the Kit picker.
- [ ] Deselect an asset, confirm. Expected: `AssetLocation` row deleted.

## §7 Kit location cascade (`/kits/<id>/edit` change location)

(Wraps `updateKitLocations` → per-asset pivot replace + `ASSET_LOCATION_CHANGED` events with `meta.viaKit: true`.)

- [ ] Kit holding 2 INDIVIDUAL assets at Location A. Change kit location to B.
- [ ] DB check:
  ```sql
  SELECT al."assetId", a.title, l.name FROM "AssetLocation" al
    JOIN "Asset" a ON a.id = al."assetId"
    JOIN "Location" l ON l.id = al."locationId"
   WHERE al."assetId" IN (SELECT "assetId" FROM "AssetKit" WHERE "kitId" = '<kit-id>')
  ORDER BY a.title;
  ```
  Expected: all kit assets at Location B.
- [ ] Per-asset `ASSET_LOCATION_CHANGED` event with `meta.viaKit = true`.
- [ ] System notes on the kit's assets reflect the move.
- [ ] `Kit.locationId` itself updated (FK stays — only Asset pivots).

## §8 Mobile API contract

- [ ] `GET /api/mobile/assets/<id>` returns singular `location: {…}` object (synthesized via `getPrimaryLocation`).
- [ ] `GET /api/mobile/assets` returns each asset with singular `location`.
- [ ] `POST /api/mobile/asset/update-location` with `{ locationId }` updates correctly. Response has the new `location` synthesized.
- [ ] `POST /api/mobile/asset/update-location` with `{ locationId: null }` (clear) returns asset with `location: null`.
- [ ] `POST /api/mobile/assets/bulk-update-location` updates multiple assets in one call.
- [ ] `GET /api/mobile/locations` lists locations.
- [ ] `GET /api/mobile/dashboard` doesn't crash on the location aggregation.

## §9 Scan drawers

- [ ] `/locations/<id>/scan-assets-kits` — scan an asset's QR. If asset is already at this location → "already added" badge. If not → drawer accepts it. Submit. Asset moves to this location.
- [ ] Same for kits.

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

- [ ] Try (via SQL or API tampering) to put one INDIVIDUAL asset at two locations. Expected: DB trigger rejects with `check_violation`.
- [ ] Try to put a qty-tracked asset's `AssetLocation` rows summing > `Asset.quantity`. Expected: rejected at COMMIT.

## §14 Final gate

- [ ] `pnpm webapp:validate` green (re-run to confirm no regressions): **2177 / 2177**.
- [ ] `pnpm webapp:doctor --diff main` — no new findings beyond the accepted `no-giant-component` family.
- [ ] Browser console clean across §1–§13.
- [ ] Server console clean — no Prisma errors.

## §15 Sign-off

When all checked: ready to commit Phase 4b as a single bundled commit on `feat-quantities`. Do NOT push without explicit user permission.

---

### Cascade-semantics flag for PR description (carry-over from CLAUDE-CONTEXT.md)

Old `Asset.locationId` was nullable, `SET NULL` on Location delete. New `AssetLocation.locationId` is `ON DELETE CASCADE` — deleting a location now removes the pivot rows (assets stay, become "unplaced"). Observably equivalent end-state.

### Known scope carry-overs (not 4b)

- **Quantity-aware location-change notes** → Phase 4e (task #86). Notes still say "moved Pens to Office 1" without unit counts.
- **Split/merge "Move N units A→B" UX + "Place N unplaced units"** → Phase 4c.
- **Reports location-filter re-verification** → still deferred via `TESTING-REPORTS.md`.
- **Multi-placement mobile UI** → post-4c, mobile-team owned.
