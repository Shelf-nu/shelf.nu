# TESTING — Bulk-create + CSV import upgrade (AssetModel + qty-tracked)

End-to-end walk-through for the work delivered under `compiled-meandering-yeti`
(plan file: `~/.claude/plans/compiled-meandering-yeti.md`). Run sequentially
against a fresh dev DB with **at least one existing AssetModel**, **two
locations**, **one kit**, **one tag**, and **one ONE_WAY custom field
attached to a category**.

This doc is intentionally NOT committed to the repo — it lives at the worktree
root alongside `TESTING-PHASE-4E.md` and gets deleted before merge.

---

## §0 — Pre-flight

- [x] `pnpm webapp:validate` is green on the branch (lint + prettier + typecheck
  - tests).
- [x] `pnpm webapp:dev` starts cleanly on `http://localhost:3000`.
- [x] Sign in to a workspace with at least the `BASE` role and asset/create
      permission.

---

## §1 — Single-create regression (no `?bulk` param)

The bulk feature MUST NOT change anything about the legacy single-create path.

- [x] Visit `/assets/new`. The header reads "Untitled Asset" (or the dynamic
      title once you start typing).
- [x] The Title input is the first field; the Tracking method cards render
      exactly as before; the Barcodes block (or upgrade banner) renders below
      Valuation.
- [x] Fill in Title + Category + Location and submit. Asset is created; you
      land on `/assets` with a success toast.
- [x] Open the new asset's overview → exactly one `ASSET_CREATED` ActivityEvent
      was written (`SELECT count(*) FROM "ActivityEvent" WHERE "assetId"=$id`).
- [x] On `/assets`, the "+New asset" button still default-clicks to
      `/assets/new`.
- [x] On `/assets/new`, picking the **Tracked by quantity** card hides the
      Asset Model selector entirely (models are INDIVIDUAL-only — they
      group N distinguishable units; qty-tracked is itself one stock pool).
      Switching back to **Individually tracked** re-shows the selector.
- [x] On an existing QUANTITY_TRACKED asset's edit page
      (`/assets/$assetId/edit`), the Asset Model selector is not rendered.
- [x] (Server-side defence) POSTing a tampered form payload with
      `assetModelId=<some-id>` and `type=QUANTITY_TRACKED` to `/assets/new`
      returns a 400 with "Asset models can only be linked to individually
      tracked assets…" rather than silently linking the model.

---

## §2 — `+New` Popover dropdown

- [ ] On `/assets`, click the **caret** to the right of "New asset". A popover
      opens with two items:
  - **Bulk create from model** → `/assets/new?bulk=1`
  - **Import from CSV** → `/assets/import` (hidden if `canImportAssets` is
    false for the workspace)
- [ ] Clicking outside the popover closes it.
- [ ] Default-clicking the "New asset" label itself still navigates to
      `/assets/new` (not `?bulk=1`).
- [ ] Keyboard navigation (Tab, Enter) reaches both the main button and the
      caret trigger.

---

## §3 — Bulk-create happy path

- [x] Visit `/assets/new?bulk=1` (or trigger via the dropdown). Header reads
      "Bulk create assets". The page banner reads "Bulk create from model". The
      Title input is replaced by **Name template / Count / Start at**.
- [x] The Tracking method cards are HIDDEN (qty-tracked stock pools are
      single-create + restock per the modal copy / no rebind here).
- [x] The Barcodes + PreferredBarcode sections are HIDDEN.
- [x] The Asset Model selector is required (visual indicator on the row).
- [x] Name template defaults to `"Asset {i}"` and Count defaults to `5`.
- [x] Live preview renders **5** entries (`Asset 1, Asset 2, …, Asset 5`).
- [x] Type `"Dell Latitude {i}"`, set Count `20`, Start at `1`. Preview reads
      `"Dell Latitude 1, Dell Latitude 2, …, Dell Latitude 5 …and 15 more"`.
- [x] Pick an AssetModel, a Location, a Kit, and 1+ Tag.
- [x] Submit. Success modal pops with title **"Created 20 assets"** + the
      first 3 preview titles + `…and 17 more`.
- [x] Click "View assets". You land on `/assets?assetModel=<modelId>` and the
      20 created assets are listed (filtered by the chosen model).
- [x] Each created asset has its own QR code row
      (`SELECT count(*) FROM "Qr" WHERE "assetId" IN (...)` = 20).
- [x] Each created asset has type `INDIVIDUAL`, quantity `1`, the chosen
      `assetModelId`, and the inherited category/valuation.
- [x] `SELECT count(*) FROM "ActivityEvent" WHERE action='ASSET_CREATED' AND
"createdAt" > now() - interval '5 minutes'` increments by exactly 20.

---

## §4 — Bulk-create token edge cases

For each case, set Count `5` and submit (or just inspect the live preview).

- [ ] `"Drone-{i}"` → `Drone-1, Drone-2, …, Drone-5` (suffix substitution).
- [ ] `"{i}-Item"` → `1-Item, 2-Item, …` (prefix substitution).
- [ ] `"Multi-{i}-{i}"` → `Multi-1-1, Multi-2-2, …` (every `{i}` substituted).
- [ ] `"Battery"` (no token) → `Battery 1, Battery 2, …, Battery 5` (auto-append).
- [ ] Start at `100`, template `"Box {i}"` → `Box 100, Box 101, …, Box 104`.
- [ ] Submit Count `1` → rejected with "Asset count must be a whole number
      between 2 and 100." (client OR server).
- [ ] Submit Count `101` → same rejection at the upper bound.
- [ ] Submit template `"{i}"` only → rejected with "Name template must
      include some text…" (server validation; client may also block).
- [ ] Submit template `"   "` (whitespace) → rejected with "Name template is
      required."

---

## §5 — Success modal behaviour

- [ ] Closing the modal with the X button or overlay click leaves the form
      intact, ready for another batch.
- [ ] Clicking "Close" stays on the form (no navigation).
- [ ] Clicking "View assets" navigates to `/assets?assetModel=…`.
- [ ] Submitting another batch reopens the modal with the new totals.

---

## §6 — CSV import: AssetModel round-trip

- [ ] Create 5 INDIVIDUAL assets manually via single-create, each linked to a
      different AssetModel.
- [ ] On `/assets`, select all 5 and use the asset-index export to download a
      CSV (use the Asset Index column settings to ensure the `assetModel` column
      is visible if it's not the default).
- [ ] Open the CSV in Excel; the `assetModel` column contains the **name** of
      each model.
- [ ] (Optional) Edit one row's `assetModel` cell to a new name that doesn't
      exist in the workspace.
- [ ] On `/assets/import`, upload the edited CSV.
- [ ] After import, the 5 assets re-imported preserve their model links
      (existing models reused, the new name auto-created as a new AssetModel row).
- [ ] No silent drops: every row that had a non-empty `assetModel` cell ends
      up with a non-null `assetModelId`.

---

## §7 — CSV import: quantity-tracked rows

Prepare a CSV with the headers (mirror the template at
`public/static/shelf.nu-example-asset-import-from-content.csv`). Note that
QUANTITY_TRACKED rows must leave `assetModel` blank — models are an
INDIVIDUAL-only concept:

```
title,category,location,assetModel,type,quantity,minQuantity,unitOfMeasure,consumptionType
"Office Pens","Office Supplies","Sofia office",,"QUANTITY_TRACKED",500,50,boxes,ONE_WAY
"Server Rack U6","Hardware","Dutch office",,"QUANTITY_TRACKED",8,2,units,TWO_WAY
"AMD Ryzen","CPU","Sofia office","Ryzen 9 7950X","INDIVIDUAL",,,,,
```

- [ ] Import succeeds with no errors.
- [ ] `SELECT type, quantity, "minQuantity", "unitOfMeasure", "consumptionType"
FROM "Asset" WHERE title IN ('Office Pens','Server Rack U6')` returns the
      expected values.
- [ ] The INDIVIDUAL `AMD Ryzen` row has `quantity=1` (DB default) and
      `consumptionType=null`.

---

## §8 — CSV import: validation rejections

For each case below, prepare a one-row CSV with the malformation and confirm
the importer surfaces a labelled 400 error mentioning the row's title.

- [ ] `type=QUANTITY_TRACKED` with no `quantity` → "Quantity is required …".
- [ ] `type=QUANTITY_TRACKED` with `quantity=0` → same.
- [ ] `type=QUANTITY_TRACKED` with no `consumptionType` → "Consumption type
      is required …".
- [ ] `type=INDIVIDUAL` with `quantity=5` → "INDIVIDUAL assets must have
      quantity 1 …".
- [ ] `type=banana` → "Invalid type ...".
- [ ] `consumptionType=banana` → "Invalid consumptionType …".
- [ ] `unitOfMeasure="{% link to='/admin' /%}"` → stored as `link to='/admin'`
      (Markdoc tokens stripped by `sanitizeUnitOfMeasureLabel`; rows still import).
- [ ] `type=QUANTITY_TRACKED` + non-empty `assetModel` cell → "Asset models
      can only be linked to INDIVIDUAL assets…" (the cross-surface rule;
      blocked at row-level so the importer can name the offending title).

---

## §9 — Activity-event parity spot check

After the §3 and §7 runs:

- [ ] `SELECT action, count(*) FROM "ActivityEvent" WHERE "createdAt" > now() -
interval '30 minutes' GROUP BY action;` shows `ASSET_CREATED = N` matching
      the totals from §3 + §7.
- [ ] Reports → Activity feed lists every created asset under its own row
      (no merging / no orphans).

---

## §10 — Back-compat regression sweep

- [ ] CSV without any of the new columns still imports (only the original
      columns are required).
- [ ] Backup import still works for an existing backup file from before this
      change (extra columns are ignored gracefully).
- [ ] Asset index column settings still let you toggle the existing fixed
      fields (`quantity`, `type`, `assetModel`); nothing crashes.

---

## §11 — Final validation

- [ ] `pnpm webapp:validate` green: lint + prettier + typecheck + tests.
- [ ] No new react-doctor errors in `pnpm webapp:doctor`.
- [ ] Manual sanity browse: `/assets/new`, `/assets/new?bulk=1`,
      `/assets/import`, `/assets/import-update` all load without console errors.
