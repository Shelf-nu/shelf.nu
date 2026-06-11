# Phase 4c — Split / merge UX: Manual Testing Plan

Phase 4c delivers the user-facing **"move units"** flows for `QUANTITY_TRACKED`
assets — redistributing units across `AssetLocation` and `AssetKit` pivot rows
without touching the orthogonal axes. Three flows ship in this PR:

1. **Move N units from Location A → Location B** (`moveAssetLocationUnits`)
2. **Move N units from Kit X → Kit Y** (`moveAssetKitUnits`)
3. **Place N unplaced units at Location L** (`placeUnplacedUnits`)

All three flows live behind one component: `MoveUnitsDialog` (axis-parameterized).
The service layer wraps each operation in a single `$transaction`, emits **paired
events** sharing a `meta.moveCorrelationId`, and writes **paired Notes** so the
4e activity-feed phrasing rules (`moved N units from X to Y`) hold on both
sides.

INDIVIDUAL assets stay byte-for-byte unchanged — the "Move units" affordance is
hidden at the UI level and the service-layer guards reject INDIVIDUAL with a 400.

> **Highest-risk areas, watch closely:**
>
> 1. **Trigger atomicity.** `enforce_asset_location_sum_within_total` +
>    `enforce_asset_kit_sum_within_total` are DEFERRABLE INITIALLY DEFERRED. A
>    botched move that overshoots `Asset.quantity` must be rejected at COMMIT,
>    not mid-tx. Verify by attempting a `quantity > available` move (see §6).
> 2. **Source-row deletion on exhaustion.** When the source pivot row hits
>    `quantity = 0`, the service DELETEs it (partial unique would allow a
>    zero-qty row but it pollutes reads). See §2.
> 3. **`assetKitId IS NULL` discriminator.** `moveAssetLocationUnits` MUST
>    refuse to touch kit-driven `AssetLocation` rows. The UI hides the
>    affordance on those rows; the service is the second line of defence
>    (see §6, kit-driven row case).
> 4. **Paired events + `moveCorrelationId`.** Reports rely on the correlation
>    UUID to rebuild a single "move" from two `ASSET_*_CHANGED` events. Missing
>    or mismatched correlation IDs break Phase 4e cross-checks.
> 5. **Concurrent-move guard.** `SELECT … FOR UPDATE` on the source row (via
>    `lockAssetForQuantityUpdate`) must serialize two parallel moves on the
>    same asset. See §4.
> 6. **Cross-org IDOR.** Destination IDs (locationId / kitId) originate from
>    form input — the service MUST validate ownership via the
>    `assertLocationBelongsToOrg` / `assertKitBelongsToOrg` helpers per the
>    `org-scope-user-supplied-ids` rule. See §7.

**Last run:** _Not yet executed_
**Tester:** _TBD_
**Branch:** `feat-quantities`

---

## §0 Prerequisites

The flows touch `AssetLocation` + `AssetKit` pivots, the cascade to
`BookingAsset` (kit-driven slices), and the `ActivityEvent` + `Note` audit
trails. Seed data needs to cover all three axes.

### Seed data shopping list

| Item                   | Spec                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------- |
| **Asset "Gloves"**     | `type = QUANTITY_TRACKED`, `quantity = 100`, `unitOfMeasure = "pairs"`                  |
| **Location A**         | "Warehouse A" — manual placement of 60 pairs of Gloves                                  |
| **Location B**         | "Warehouse B" — empty (destination for §1 / §2)                                         |
| **Location C**         | "Office" — manual placement of 10 pairs of Gloves                                       |
| **Kit "Field Kit"**    | Contains Gloves with `AssetKit.quantity = 20`                                           |
| **Kit "Office Kit"**   | Contains Gloves with `AssetKit.quantity = 0` initially — used as kit destination for §3 |
| **Unplaced units**     | 10 pairs (100 total − 60 at Warehouse A − 10 at Office − 20 in Field Kit)               |
| **Open booking "BK1"** | `DRAFT` or `RESERVED`, holds Gloves via Field Kit slice (covers cascade in §3)          |
| **INDIVIDUAL asset**   | Any INDIVIDUAL asset ("Camera" works) for the §6 hidden-affordance check                |
| **Second org**         | Org-B with at least one location for the §7 cross-org IDOR curl                         |

### Verify seed state (Supabase MCP)

```sql
-- Confirm Gloves is qty-tracked with the right total
SELECT id, name, type, quantity, "unitOfMeasure"
FROM "Asset"
WHERE name = 'Gloves';

-- Confirm AssetLocation placements: Warehouse A=60 manual, Office=10 manual, plus a kit-driven row for Field Kit
SELECT al.id, l.name AS location, al.quantity, al."assetKitId"
FROM "AssetLocation" al
JOIN "Location" l ON l.id = al."locationId"
WHERE al."assetId" = '{glovesId}'
ORDER BY l.name;

-- Confirm AssetKit memberships: Field Kit=20, Office Kit=0 (or missing entirely)
SELECT ak.id, k.name AS kit, ak.quantity
FROM "AssetKit" ak
JOIN "Kit" k ON k.id = ak."kitId"
WHERE ak."assetId" = '{glovesId}'
ORDER BY k.name;

-- Confirm unplaced gap = 10
SELECT
  a.quantity AS total,
  COALESCE(SUM(al.quantity) FILTER (WHERE al."assetKitId" IS NULL), 0) AS placed_manual,
  a.quantity - COALESCE(SUM(al.quantity) FILTER (WHERE al."assetKitId" IS NULL), 0) AS unplaced
FROM "Asset" a
LEFT JOIN "AssetLocation" al ON al."assetId" = a.id
WHERE a.id = '{glovesId}'
GROUP BY a.id;
-- expect: unplaced = 10
```

**Status:** ⬜ Not run

---

## §1 — Move units between two locations (happy path)

The canonical flow: 25 pairs of Gloves migrate from Warehouse A → Warehouse B.

### Preconditions

- Warehouse A row: 60 pairs of Gloves (manual placement, `assetKitId IS NULL`)
- Warehouse B: no `AssetLocation` row for Gloves yet

### Steps

1. Navigate to `/assets/{glovesId}/overview`
2. Locate the "Warehouse A — 60 pairs" row in the "Placed at locations" sidebar card
3. Click the "Move units" affordance on that row
4. In the dialog:
   - Confirm header reads "Move units from Warehouse A"
   - Pick "Warehouse B" as the destination from the dropdown
   - Enter `25` in the quantity input
   - Submit

### Expected

1. Toast: "Moved 25 pairs from Warehouse A to Warehouse B"
2. Dialog closes; the page refreshes the placements list
3. "Warehouse A — 35 pairs" row replaces the old 60-pair row
4. A new "Warehouse B — 25 pairs" row appears alongside Warehouse A + Office
5. Activity feed shows **two** new entries (newest first):
   - `You moved 25 pairs from Warehouse A to Warehouse B.` (to-side)
   - `You moved 25 pairs from Warehouse A to Warehouse B.` (from-side)
6. Per-row Notes mirror the same phrasing in chronological order

### SQL spot-checks (Supabase MCP)

```sql
-- AssetLocation rows reflect the new split
SELECT l.name AS location, al.quantity, al."assetKitId"
FROM "AssetLocation" al
JOIN "Location" l ON l.id = al."locationId"
WHERE al."assetId" = '{glovesId}' AND al."assetKitId" IS NULL
ORDER BY al."createdAt";
-- expect: Warehouse A=35, Office=10, Warehouse B=25 (order may vary by createdAt)

-- Paired events share moveCorrelationId
SELECT action, "fromValue", "toValue", meta
FROM "ActivityEvent"
WHERE "entityId" = '{glovesId}' AND action = 'ASSET_LOCATION_CHANGED'
ORDER BY "createdAt" DESC LIMIT 4;
-- expect: 2 newest rows share the same meta->>'moveCorrelationId'
--         meta.quantity = 25 on both
--         one row's fromValue = warehouseA id, toValue = warehouseB id (and the inverse on the pair)
```

**Status:** ⬜ Not run

---

## §2 — Move when source row is exhausted

When the source pivot row hits `quantity = 0`, the service DELETEs it. The page
should no longer render a Warehouse A row at all.

### Preconditions

- Continuing from §1: Warehouse A has 35 pairs, Warehouse B has 25 pairs
- (Or reset seed and place 35 at Warehouse A only)

### Steps

1. On the asset overview, click "Move units" on the "Warehouse A — 35 pairs" row
2. Pick Warehouse B, enter `35`, submit

### Expected

1. Toast: "Moved 35 pairs from Warehouse A to Warehouse B"
2. "Warehouse A" row VANISHES from the "Placed at locations" card
3. "Warehouse B" row updates to "60 pairs"
4. Office row untouched at 10
5. Activity feed shows the paired events; the from-side note phrasing still
   renders the Warehouse A link (the Note row pre-dates the deletion)

### SQL spot-checks (Supabase MCP)

```sql
-- Warehouse A row deleted
SELECT COUNT(*) FROM "AssetLocation"
WHERE "assetId" = '{glovesId}'
  AND "locationId" = '{warehouseAId}'
  AND "assetKitId" IS NULL;
-- expect: 0

-- Warehouse B row now holds 60
SELECT quantity FROM "AssetLocation"
WHERE "assetId" = '{glovesId}'
  AND "locationId" = '{warehouseBId}'
  AND "assetKitId" IS NULL;
-- expect: 60

-- Sum-within-total invariant still holds
SELECT a.quantity AS total,
       COALESCE(SUM(al.quantity) FILTER (WHERE al."assetKitId" IS NULL), 0) AS placed_manual,
       COALESCE(SUM(al.quantity) FILTER (WHERE al."assetKitId" IS NOT NULL), 0) AS placed_via_kit
FROM "Asset" a
LEFT JOIN "AssetLocation" al ON al."assetId" = a.id
WHERE a.id = '{glovesId}'
GROUP BY a.id;
-- expect: placed_manual + placed_via_kit ≤ total = 100
```

**Status:** ⬜ Not run

---

## §3 — Move between kits

Symmetric to §1 but on the `AssetKit` pivot. The cascade also flows down to
any `BookingAsset` row with the matching `assetKitId` — kit-driven booking
slices must stay in sync.

### Preconditions

- Field Kit holds 20 pairs of Gloves
- Office Kit either holds 0 pairs OR has no AssetKit row yet
- Open booking BK1 holds Field Kit (so `BookingAsset.quantity = 20`,
  `assetKitId = fieldKitId` exists)

### Steps

1. Navigate to `/assets/{glovesId}/overview`
2. Locate the "Field Kit — 20 pairs" row in the "Included in kits" sidebar card
3. Click "Move units" on that row
4. Pick "Office Kit" as destination, enter `10`, submit

### Expected

1. Toast: "Moved 10 pairs from kit Field Kit to kit Office Kit"
2. Field Kit row reads "10 pairs"
3. Office Kit row reads "10 pairs" (new row materialized if it didn't exist)
4. Activity feed: paired `ASSET_KIT_CHANGED` events
5. Per-row Notes: "moved 10 pairs from kit Field Kit to kit Office Kit"
   (NEW phrasing per Wave 0 contract — symmetric to location move)
6. Booking BK1 still references Field Kit, but its `BookingAsset.quantity` is now 10

### SQL spot-checks (Supabase MCP)

```sql
-- AssetKit pivot rows reflect the move
SELECT k.name, ak.quantity
FROM "AssetKit" ak
JOIN "Kit" k ON k.id = ak."kitId"
WHERE ak."assetId" = '{glovesId}'
ORDER BY k.name;
-- expect: Field Kit=10, Office Kit=10

-- Paired ASSET_KIT_CHANGED events with moveCorrelationId
SELECT action, "fromValue", "toValue", meta
FROM "ActivityEvent"
WHERE "entityId" = '{glovesId}' AND action = 'ASSET_KIT_CHANGED'
ORDER BY "createdAt" DESC LIMIT 4;
-- expect: 2 newest rows share meta->>'moveCorrelationId'
--         meta.quantity = 10
--         meta.fromKitId / meta.toKitId set

-- Booking cascade: kit-driven BookingAsset slices reflect post-move qty
SELECT b.name, ba.quantity, ak.id AS "assetKitId", k.name AS kit
FROM "BookingAsset" ba
JOIN "Booking" b ON b.id = ba."bookingId"
LEFT JOIN "AssetKit" ak ON ak.id = ba."assetKitId"
LEFT JOIN "Kit" k ON k.id = ak."kitId"
WHERE ba."assetId" = '{glovesId}'
  AND b.status IN ('DRAFT', 'RESERVED', 'ONGOING');
-- expect: kit-driven booking slices reflect post-move qtys
--         Field Kit slice in BK1 now at 10 (not 20)
```

**Status:** ⬜ Not run

---

## §4 — Concurrent move guard (two tabs)

`SELECT … FOR UPDATE` on the source row (via `lockAssetForQuantityUpdate`)
must serialize two parallel moves. The second one observes the post-first
state and either succeeds with the reduced pool or fails with a clear
"only N available" error.

### Preconditions

- Reset Warehouse B to 60 pairs (or use post-§2 state)
- Two browser tabs open at `/assets/{glovesId}/overview`

### Steps

1. In Tab A: open "Move units" on Warehouse B (60 pairs). Pick Warehouse A,
   enter `30`. Do NOT submit yet.
2. In Tab B: open the same dialog. Pick Warehouse A, enter `30`. Do NOT
   submit yet.
3. Submit Tab A. Within <100ms, submit Tab B.

### Expected

1. ONE tab succeeds: Warehouse B → 30 pairs, Warehouse A grows by 30
2. The OTHER tab fails with a user-visible error:
   - Toast or inline error: "only 30 pairs available at Warehouse B"
   - No partial write — Warehouse B does NOT drop below 30
3. Activity feed shows ONE pair of events, not two

### SQL spot-checks (Supabase MCP)

```sql
-- Warehouse B should be at 30, not 0 or 60
SELECT quantity FROM "AssetLocation"
WHERE "assetId" = '{glovesId}'
  AND "locationId" = '{warehouseBId}'
  AND "assetKitId" IS NULL;
-- expect: 30 (one move landed, the other was rejected)

-- Event count: exactly 2 ASSET_LOCATION_CHANGED rows from this experiment
SELECT COUNT(*) FROM "ActivityEvent"
WHERE "entityId" = '{glovesId}'
  AND action = 'ASSET_LOCATION_CHANGED'
  AND "createdAt" > now() - interval '5 minutes';
-- expect: 2 (the failed tab wrote nothing)
```

**Status:** ⬜ Not run

---

## §5 — Place unplaced units

One-sided variant: no source row to decrement. Just an upsert on
`AssetLocation` with `assetKitId IS NULL`. Used to fill the gap between
`Asset.quantity` and `sum(AssetLocation.quantity WHERE assetKitId IS NULL)`.

### Preconditions

- Gloves has unplaced quantity > 0 (seed leaves 10 unplaced)
- The "X unplaced — place them" CTA is visible inside `QuantityOverviewCard`

### Steps

1. Navigate to `/assets/{glovesId}/overview`
2. In the QuantityOverviewCard, click the "10 pairs unplaced — place them" CTA
3. In the dialog (axis = `place-unplaced`):
   - Header reads "Place 10 pairs"
   - Pick "Office" as destination
   - Quantity defaults to `10` (the full unplaced gap); leave it
   - Submit

### Expected

1. Toast: "Placed 10 pairs at Office"
2. The "X unplaced" CTA DISAPPEARS (unplaced gap = 0)
3. Office row updates from "10 pairs" → "20 pairs"
4. Activity feed: ONE `ASSET_LOCATION_CHANGED` event (one-sided, no pair)
5. Note: "You placed 10 pairs at Office." (existing
   `getLocationUpdateNoteContent` phrasing)

### SQL spot-checks (Supabase MCP)

```sql
-- Office row gained 10 pairs
SELECT quantity FROM "AssetLocation"
WHERE "assetId" = '{glovesId}'
  AND "locationId" = '{officeId}'
  AND "assetKitId" IS NULL;
-- expect: 20

-- Unplaced gap is now 0
SELECT
  a.quantity AS total,
  COALESCE(SUM(al.quantity) FILTER (WHERE al."assetKitId" IS NULL), 0) AS placed_manual,
  a.quantity - COALESCE(SUM(al.quantity) FILTER (WHERE al."assetKitId" IS NULL), 0)
    - COALESCE(SUM(al.quantity) FILTER (WHERE al."assetKitId" IS NOT NULL), 0) AS unplaced_after_kit_driven
FROM "Asset" a
LEFT JOIN "AssetLocation" al ON al."assetId" = a.id
WHERE a.id = '{glovesId}'
GROUP BY a.id;
-- expect: unplaced = 0 (or matches the new gap if kit-driven rows shifted)

-- Single (one-sided) ASSET_LOCATION_CHANGED event, NO moveCorrelationId
SELECT meta FROM "ActivityEvent"
WHERE "entityId" = '{glovesId}'
  AND action = 'ASSET_LOCATION_CHANGED'
ORDER BY "createdAt" DESC LIMIT 1;
-- expect: meta.quantity = 10; meta.moveCorrelationId is NULL (place-unplaced is one-sided)
```

**Status:** ⬜ Not run

---

## §6 — Negative paths

All paths below must surface a user-visible error (or hide the affordance
entirely) — never a 500 or silent no-op.

### Cases

1. **INDIVIDUAL asset — affordance HIDDEN**

   - Navigate to `/assets/{individualAssetId}/overview`
   - "Move units" affordance must NOT render on the location row or kit row
   - Direct API call (form-POST with `intent=move-location` and the INDIVIDUAL
     asset's ID) returns 400 with "split/merge is only for quantity-tracked
     assets"

2. **Source = destination**

   - Open the dialog on Warehouse A
   - Pick Warehouse A as the destination (or notice it's filtered out of the
     dropdown already)
   - Submit forces a client-side error: "Source and destination must differ"
   - If client validation is bypassed, server returns 400

3. **Quantity > available**

   - Open the dialog on a row with `quantity = 5`
   - Enter `10`, submit
   - Server returns 400: "only 5 pairs available at {sourceLocation}"
   - No partial write — source row still reads 5

4. **Kit-driven AssetLocation row — affordance NOT rendered**

   - On the asset overview "Placed at locations" card, a kit-driven row
     (badge "via kit") shows NO "Move units" button
   - Hint shown instead: "Move via kit" or similar
   - Direct API call with that pivot row's location returns 400 with
     "kit-driven units must be moved via the kit"

5. **No destinations available**
   - Asset is already placed at every location in the org
   - Open the dialog: destination dropdown shows an empty-state
     ("No other locations available — create a new location first")
   - Submit is disabled

**Status:** ⬜ Not run

---

## §7 — Multi-tenant IDOR sanity (cross-org curl)

Destination IDs originate from form input. The service MUST validate
ownership via `assertLocationBelongsToOrg` / `assertKitBelongsToOrg` —
otherwise an Org-A user could move units of their own asset into a location
they don't own (cross-org write).

### Preconditions

- User signed in as Org-A
- Org-A owns asset "Gloves" and location "Warehouse A"
- Org-B (separate workspace) owns a location "Site B1"
- Capture the Org-B location ID via DB inspection or by signing in as Org-B
  briefly

### Steps

1. As Org-A user, capture session cookie + CSRF token from devtools
2. POST to `/assets/{glovesId}/overview` with form-encoded body:
   ```
   intent=move-location
   fromLocationId={warehouseAId}     ← Org-A
   toLocationId={siteB1Id}           ← Org-B (smuggled)
   quantity=5
   ```
3. Mirror the curl pattern used in prior security sweeps (set `Cookie`,
   `X-CSRF-Token`, `Content-Type: application/x-www-form-urlencoded`)

### Expected

1. Response: **403** (forbidden) or **404** (not found)
2. NO write to `AssetLocation` referencing `Site B1`
3. NO `ActivityEvent` row created
4. No leaked Org-B metadata in the error response body

### SQL spot-checks (Supabase MCP)

```sql
-- Confirm no cross-org write landed
SELECT COUNT(*) FROM "AssetLocation"
WHERE "assetId" = '{glovesId}'
  AND "locationId" = '{siteB1Id}';
-- expect: 0

-- Confirm no event row
SELECT COUNT(*) FROM "ActivityEvent"
WHERE "entityId" = '{glovesId}'
  AND "toValue" = '{siteB1Id}'
  AND "createdAt" > now() - interval '5 minutes';
-- expect: 0
```

Repeat for the kit axis (`intent=move-kit`, smuggle an Org-B kit ID as
`toKitId`).

**Status:** ⬜ Not run

---

## §8 — Activity-feed + Notes audit (Phase 4e cross-check)

Walking §1 through §5, every move must produce notes + events with the
quantity-aware phrasing that Phase 4e established for `QUANTITY_TRACKED`
assets. INDIVIDUAL assets (if you exercise §6 case 1) must produce
byte-for-byte legacy wording.

### Per-axis expectations

| Flow                                  | Note phrasing                                                      | Event meta                                                                            |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| §1 Location move                      | `You moved 25 pairs from Warehouse A to Warehouse B.` (both sides) | `ASSET_LOCATION_CHANGED`, `meta.quantity = 25`, `meta.moveCorrelationId = <uuid>`     |
| §2 Source exhaustion                  | Same as §1 (from-side Note pre-dates the row delete and survives)  | Paired `ASSET_LOCATION_CHANGED` with `moveCorrelationId`; from-side `toValue = NULL?` |
| §3 Kit move                           | `You moved 10 pairs from kit Field Kit to kit Office Kit.`         | `ASSET_KIT_CHANGED`, `meta.quantity = 10`, `meta.moveCorrelationId`, `meta.fromKitId` |
| §5 Place unplaced                     | `You placed 10 pairs at Office.`                                   | Single `ASSET_LOCATION_CHANGED`, `meta.quantity = 10`, NO `moveCorrelationId`         |
| §6 case 1 (INDIVIDUAL — if exercised) | Not applicable — affordance is hidden                              | Not applicable                                                                        |

### Verify with MCP

```sql
-- Pull the last 10 events on Gloves; eyeball every one of them
SELECT "createdAt", action, "fromValue", "toValue", meta
FROM "ActivityEvent"
WHERE "entityId" = '{glovesId}'
ORDER BY "createdAt" DESC LIMIT 10;

-- Pull the last 10 notes; eyeball the markdown body
SELECT "createdAt", content
FROM "Note"
WHERE "assetId" = '{glovesId}'
ORDER BY "createdAt" DESC LIMIT 10;
```

Cross-checks:

- Every paired event has a matching twin with the same `meta.moveCorrelationId`
- Every Note that mentions a unit count uses the helper-rendered phrase
  (e.g. `"25 pairs"`, not `"25 units"` — Gloves has `unitOfMeasure = "pairs"`)
- INDIVIDUAL siblings of any of these flows (not exercised in 4c, but
  cross-checked via §5 for the type-check) produce NO `meta.quantity` key

**Status:** ⬜ Not run

---

## §9 — Validate green + tests pass

Wave 4 closes the loop:

1. `pnpm webapp:validate` — exit 0
2. Kill stray vitest processes after (per `feedback_kill_vitest` memory)
3. New test count documented vs. baseline:
   - Baseline: _TBD_ (capture before Wave 1 starts)
   - Post-Wave-3: baseline + Agent-G's new tests for
     `moveAssetLocationUnits`, `moveAssetKitUnits`, `placeUnplacedUnits`,
     `MoveUnitsDialog` component tests
4. `pnpm exec tsc -b` clean
5. `pnpm webapp:lint` clean
6. CLAUDE-CONTEXT.md updated with the Phase 4c delivered-scope entry
7. PRD `docs/proposals/quantitative-assets.md` Phase 4c bullet flipped to done
   (optional — may land in a follow-up commit batch)

**Status:** ⬜ Not run

---

## Known intentional deviations (not bugs)

- **Custody rebalance is deferred to Phase 4d** — moving kit units that are
  currently covered by operator custody is **blocked** with a 400 ("release
  custody first") rather than cascaded. See Risk Register option (a) in
  `superpowers/PHASE-4C-SPLIT-MERGE-UX.md`.
- **Booking-slice cascade on kit moves IS performed** — kit-driven
  `BookingAsset.quantity` follows the moved kit slice (see §3 SQL).
- **Location detail page "Move out" entry point** is deferred to a polish PR.
  The asset detail page is the only entry point in this release.
- **Kit detail page "Move asset to another kit"** is deferred to the same
  polish PR.
- **Bulk move (multi-asset selection)** is deferred — single-asset UX
  validates first. Mirrors `bulk-kit-update-dialog.tsx` warning pattern.
- **Mobile companion app integration** is out of scope (companion-app-store
  review timeline owns its own).
- **Place-unplaced is one-sided** — only one `ASSET_LOCATION_CHANGED` event,
  no `moveCorrelationId`. Reports treat it as a "place" not a "move".
