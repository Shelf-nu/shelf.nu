# Asset Import (CSV)

This guide documents the CSV columns supported by Shelf's **asset import**
flow at `/assets/import` (create-from-content, a background job described below)
and `/assets/import-update` (update-from-content, synchronous). It is the source-of-truth reference customers see
embedded in the import dialog. Keep it in sync with
`apps/webapp/app/components/assets/import-content/index.tsx`.

## Templates

Two ready-to-use CSV templates ship with the app and are linked from the
import dialog:

- `public/static/shelf.nu-example-asset-import-from-content.csv` - the
  baseline template (no barcode columns).
- `public/static/shelf.nu-example-asset-import-from-content-with-barcodes.csv`
  - the same template plus the five `barcode_*` columns. Shown only when
    the workspace has the barcodes add-on.

Each template includes two example INDIVIDUAL rows (with an `assetModel`
and a `valuation`) and two example QUANTITY_TRACKED rows so customers
can copy a working starting point.

## Base rules

- Use `,` (comma) or `;` (semicolon) as the column delimiter.
- The first row is the header row and is NOT imported.
- Each row creates a **new** asset - existing assets are never merged or
  overwritten on the create path. To bulk-update existing assets, use
  the **Bulk Update** flow at `/assets/import-update`.
- Related-entity columns (`kit`, `category`, `location`, `custodian`)
  are matched by name; unknown values are created automatically.
- `tags` is comma-separated; unknown tags are created automatically.

## Quantity-tracked + asset-model columns

Six optional columns let customers onboard stock-room consumables
(boxes, batteries, fasteners) and link individually-tracked assets to
a reusable asset model.

| Column            | Required?                               | Allowed values                                   | Notes                                                                                                                                          |
| ----------------- | --------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`            | Optional; defaults to `INDIVIDUAL`      | `INDIVIDUAL` or `QUANTITY_TRACKED`               | On **update**: silently ignored - `type` cannot be changed via import once the asset exists.                                                   |
| `quantity`        | Required when `type = QUANTITY_TRACKED` | Positive integer                                 | Ignored on `INDIVIDUAL` rows. On the create path, `INDIVIDUAL` rows with a quantity > 1 are rejected.                                          |
| `minQuantity`     | Optional                                | Non-negative integer                             | Sets the low-stock alert threshold. Ignored on `INDIVIDUAL` rows.                                                                              |
| `unitOfMeasure`   | Optional                                | Free-text label (e.g. `boxes`, `liters`, `kg`)   | Markdoc injection characters (`{`, `%`, `}`) are stripped at parse time.                                                                       |
| `consumptionType` | Required when `type = QUANTITY_TRACKED` | `ONE_WAY` or `TWO_WAY`                           | `ONE_WAY` consumes on checkout (no return); `TWO_WAY` returns with a consumption report. Ignored on `INDIVIDUAL` rows.                         |
| `assetModel`      | Optional                                | Asset model name (created on the fly if missing) | **INDIVIDUAL rows only.** On a `QUANTITY_TRACKED` row during update, the cell is skipped with a warning and the rest of the row still applies. |

### Why asset models are INDIVIDUAL-only

An asset model groups multiple physically-distinguishable items that
share a make/model (e.g. five MacBook Pro M3 laptops, each with its
own serial). A `QUANTITY_TRACKED` asset is already a single stock pool
with a `quantity` field - modelling it under an asset-model parent
would double-count. The import enforces this both server-side (a
`QUANTITY_TRACKED` row with an `assetModel` cell is rejected on create
and warned-and-skipped on update) and in the asset-form UI.

## Example CSV (create path)

```csv
title,description,kit,category,tags,location,valuation,custodian,bookable,assetModel,type,quantity,minQuantity,unitOfMeasure,consumptionType
"MacBook Pro 16\"","M3 dev laptop",Working gear,Laptop,"High priority",Dutch office,2500,Thea,no,MacBook Pro 16-inch (M3),INDIVIDUAL,,,,
"Cardboard boxes","Shipping stock",,Supplies,small,Sofia office,,,yes,,QUANTITY_TRACKED,250,50,boxes,ONE_WAY
```

- Row 1 - `INDIVIDUAL` MacBook with an `assetModel` (auto-created if
  missing). `quantity` / `minQuantity` / `unitOfMeasure` /
  `consumptionType` left blank.
- Row 2 - `QUANTITY_TRACKED` consumable with the four qty columns
  filled and `assetModel` deliberately left blank.

## Update path (`/assets/import-update`)

The update import accepts the same columns as the create path for
fields that are safe to round-trip. As of the qty-tracked support
rollout, the updatable set is: `name`, `category`, `location`, `tags`,
`valuation`, `availableToBook`, `quantity`, `minQuantity`,
`unitOfMeasure`, `consumptionType`, `assetModel` + any custom fields.

- The `type` column is **read but ignored** - asset type is
  immutable once the asset exists.
- `quantity`, `minQuantity`, `unitOfMeasure`, `consumptionType` cells
  on `INDIVIDUAL` rows are silently ignored. Customers who exported
  their workspace and re-imported it to bulk-edit a few cells won't
  hit spurious errors.
- An `assetModel` cell on a `QUANTITY_TRACKED` row is skipped with a
  warning surfaced in the import response; other cells in the row
  still apply.

## QR codes and barcodes

See the in-app help text for the full rules. These aren't specific to
qty-tracked imports.

Enter External QR values exactly as the label encodes them, including
`https://`. The preview flags values that look like a web address without a
protocol (`example.com/abc`); the warning never blocks the import.

## How a create import runs

Create-from-content is a browser-driven flow backed by a background job. The
update path (`/assets/import-update`) is unchanged and still runs inside the
request.

```
upload ──> preview ──> confirm ──> [ queue: asset-import-queue ]
(file)     DRAFT       QUEUED      PREPARE ──> ROWS x N ──> FINALIZE
read-only  rows stored             claim QR,   100 rows     kit custody,
           50-row grid             create      per job,     COMPLETED,
                                   entities    one tx       email
```

1. **Upload and preview** (`intent=preview` on `assets.import.tsx`). The CSV is
   parsed and validated in full without writing anything to the workspace
   (`validate.server.ts`). The parsed rows, each with a pre-allocated `assetId`,
   are stored on a new `AssetImport` row with status `DRAFT`
   (`preview.server.ts`). The response carries the first 50 rows
   (`PREVIEW_DISPLAY_LIMIT`) as a grid plus the entities that will be created
   (`missing-entities.server.ts`): categories, locations, tags, kits,
   custodians, custom fields and asset models the workspace does not have yet.
2. **Confirm** (`confirmAssetImport` in `service.server.ts`). The stored rows are
   validated again, because the workspace may have changed since the preview. A
   DRAFT older than 24 hours (`ASSET_IMPORT_DRAFT_TTL_HOURS`) cannot be
   confirmed. The import moves to `QUEUED` and a PREPARE job is sent. Only one
   `QUEUED` or `RUNNING` import may exist per workspace: the partial unique
   index `AssetImport_one_active_per_organization` enforces it, and the
   service turns the violation into a user-facing error.
3. **PREPARE** (`prepare.server.ts`). Marks the import `RUNNING`, re-checks that
   the creator still holds `asset: import`, claims the file's unclaimed QR
   codes, and finds or creates every category, location, tag, kit, custodian,
   custom field and asset model. The name to id maps are stored as `resolved`
   on the import. Every write is find-or-create, so PREPARE can run again.
4. **ROWS** (`worker.server.ts`, `chunk-writer.server.ts`). One job per chunk of
   100 rows (`ASSET_IMPORT_CHUNK_SIZE`). A chunk downloads its images, then
   writes assets, QR codes, tags, placement, kit pivots, direct custody, custom
   field values, barcodes and `ASSET_CREATED` events with one `createMany` per
   table in a single transaction. Each job queues the next one.
5. **FINALIZE** (`finalize.server.ts`). Assigns kit custody for rows that name a
   kit and a custodian (through `bulkAssignKitCustody`), marks the import
   `COMPLETED`, clears the stored rows and emails the creator
   (`emails/asset-import-finished.tsx`).

## Reliability model

Constants live in `modules/asset-import/constants.ts`.

- **Retries.** Every step is sent with `ASSET_IMPORT_JOB_OPTIONS`: `retryLimit`
  3, exponential backoff from 5 seconds, 15 minute expiry. A step that throws is
  retried; a step whose process died is retried once it expires. Only the last
  attempt marks the import `FAILED` (`failure.server.ts`), with a message the
  user can act on, and emails the creator. Each job also has a singleton key
  per import and step, so sending a queued step twice is a no-op.
- **Lease.** `AssetImport.lockedUntil` (`lease.server.ts`) lets one step of an
  import run at a time. A step claims it for 14 minutes, one less than the job
  expiry, never renews it, and releases it when done. Because the lease always
  ends before the job expires, the retry of a step whose process died always
  finds the lease lapsed and continues the chain. A duplicate job that cannot
  claim it returns quietly; the holder continues the chain.
- **Exactly-once chunks.** The first statement of a chunk transaction advances
  `processedRows`, guarded on the chunk's start offset. A retried chunk that
  already committed matches nothing and writes nothing; a concurrent duplicate
  waits on the row lock and then fails the guard.
- **Deterministic ids.** `assetId` is allocated at preview time and stored on
  the row (`StoredImportRow` in `types.ts`), so a retried chunk writes the same
  asset ids and the same image paths (`<userId>/<assetId>/main-image-import`).
- **Image budget.** A chunk spends at most 8 minutes
  (`ASSET_IMPORT_IMAGE_BUDGET_MS`) downloading images before it writes. Rows not
  reached are imported without an image and get a warning. The budget keeps a
  live step well inside its 14 minute lease, which is never renewed.
- **Stall detection.** A `QUEUED` or `RUNNING` import whose `updatedAt` has not
  moved for 30 minutes (`ASSET_IMPORT_STALL_MINUTES`) is marked `FAILED` the
  next time it is read (`markStalledImportIfNeeded`), so a dead job never shows
  as active forever, and an import whose first job never ran cannot hold the
  workspace's single active-import slot. Loading the import and claiming the
  lease sit inside the job's error handling, so a failure there on the last
  attempt marks the import `FAILED` straight away.
- **Resume.** A `FAILED` import can be resumed from the status page
  (`resumeAssetImport`). It goes back to `QUEUED` and PREPARE runs again: it
  re-checks the creator's permission and recreates anything deleted meanwhile.
  Rows continue from `processedRows`, so nothing already written is repeated.

## Warnings and failures

A conflict that arises after the preview never fails a chunk if the row can
still be imported without the conflicting piece. These become row **warnings**
(stored on the import, capped at 500 by `MAX_STORED_IMPORT_WARNINGS`;
`warningCount` keeps the exact total):

| Situation                                             | Result                          |
| ----------------------------------------------------- | ------------------------------- |
| QR code from the file was linked elsewhere meanwhile  | Asset gets a new QR code        |
| Barcode value taken by another item                   | Barcode skipped                 |
| Custom field deleted or retyped, value no longer fits | Value skipped                   |
| Image download failed or the chunk's budget ran out   | Asset imported without an image |
| Kit custody could not be assigned in FINALIZE         | Kit left without custody        |

Other conflicts **fail** the import: a category, location, kit, custodian or
asset model that PREPARE resolved but that was deleted before its chunk ran.
The import stops as `FAILED` with progress kept. **Resume** recreates the
deleted entity in PREPARE and continues.

## UI

- **Status page** `/assets/import/:importId`, in
  `routes/_layout+/assets.import_.$importId.tsx`. The trailing `_` in
  `import_` opts the route out of nesting under `assets.import.tsx` (the upload
  page), so the status page does not render inside it. Its loader reads status
  plus stored warnings; its `resume` action calls `resumeAssetImport`.
- **Polling.** `ImportProgress` (`components/assets/import-content/`) fetches
  `GET /api/asset-imports/:importId` (`routes/api+/asset-imports.$importId.ts`)
  every 2 seconds (`ASSET_IMPORT_POLL_INTERVAL_SECONDS`), pauses while the tab
  is hidden and catches up when it becomes visible. It stops on `COMPLETED` and
  `FAILED`. The endpoint never returns rows or warnings.
- **Floating card.** `components/layout/asset-import-card.tsx`, rendered by
  `routes/_layout+/_layout.tsx`, follows the importer across the app while
  their import is active.
- **Assets-list notice.** `components/assets/assets-index/asset-import-notice.tsx`
  tells every workspace member that an import is running, on `/assets` only.
  `viewer-payload.ts` shapes the payload: members without `asset: import` get
  only status and counts, with no id, file name, error text or warning count.
- All three routes require `asset: import`; the status page and endpoint return
  404 for a DRAFT or another workspace's import.

## Limits

- File size: 2 MB, the default limit of the multipart parser.
- Rows: 1000 data rows (`MAX_CONTENT_IMPORT_ROWS` in
  `modules/asset/import-preflight.server.ts`).
- Row errors reported per preview are capped by `MAX_REPORTED_ROW_ERRORS`.

## Where the code lives

`apps/webapp/app/modules/asset-import/`:

- `constants.ts`: chunk size, poll interval, lease, stall, image budget, TTL, job options.
- `types.ts`: stored row, resolved maps, warning, status and notice payloads.
- `validate.server.ts`: read-only validation of a file or stored rows.
- `preview.server.ts`: builds the DRAFT and the 50-row preview grid.
- `missing-entities.server.ts`: names of entities the import will create.
- `service.server.ts`: confirm, resume, status reads, active-import lookup.
- `worker.server.ts`: pg-boss queue, step runner, image downloads, retry handling.
- `prepare.server.ts`: PREPARE step and the import-permission re-check.
- `chunk-writer.server.ts`: one ROWS transaction and its warnings.
- `finalize.server.ts`: FINALIZE step, kit custody, completion.
- `lease.server.ts`: claim and release `lockedUntil`.
- `failure.server.ts`: `FAILED` transition, stall detection, failure email.
- `progress.server.ts`: pure readers for stored rows and next step.
- `viewer-payload.ts`: permission-based shaping of the active import.

Also: `app/emails/asset-import-finished.tsx`; routes
`assets.import.tsx`, `assets.import_.$importId.tsx` and
`api+/asset-imports.$importId.ts`; UI in
`components/assets/import-content/` (upload flow, preview stage, progress) and
`components/assets/import-preview/` (grid, confirm dialog, error details, new
entities notice). Other references: `modules/asset/service.server.ts`
(`parseQtyTrackedCsvRow()`), `modules/asset-model/service.server.ts`
(`createAssetModelsIfNotExists()`) and `utils/import-update-types.ts`
(`UPDATABLE_FIELDS` for the update path).

## Operational notes

- Two migrations ship with the feature in `packages/database/prisma/migrations/`:
  `20261015120000_add_asset_import` (the `AssetImport` table and enums) and
  `20261015120100_asset_import_one_active_per_workspace` (the partial unique
  index; Prisma cannot express it, so it exists only in the SQL). Deploy them
  before the code serves. The layout loader tolerates a missing table so the
  app stays up during that window.
- The webapp sits at TypeScript's instantiation ceiling. Status reads therefore
  return hand-typed rows instead of inferring Prisma payload types, and the
  assets-list notice renders from the layout rather than the assets index route,
  which adds no query or type weight there. Keep new import reads hand-typed.
