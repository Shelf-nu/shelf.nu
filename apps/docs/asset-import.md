# Asset Import (CSV)

This guide documents the CSV columns supported by Shelf's **asset import**
flow at `/assets/import` (create-from-content) and `/assets/import-update`
(update-from-content). It is the source-of-truth reference customers see
embedded in the import dialog — keep it in sync with
`apps/webapp/app/components/assets/import-content.tsx`.

## Templates

Two ready-to-use CSV templates ship with the app and are linked from the
import dialog:

- `public/static/shelf.nu-example-asset-import-from-content.csv` — the
  baseline template (no barcode columns).
- `public/static/shelf.nu-example-asset-import-from-content-with-barcodes.csv`
  — the same template plus the five `barcode_*` columns. Shown only when
  the workspace has the barcodes add-on.

Each template includes two example INDIVIDUAL rows (with an `assetModel`
and a `valuation`) and two example QUANTITY_TRACKED rows so customers
can copy a working starting point.

## Base rules

- Use `,` (comma) or `;` (semicolon) as the column delimiter.
- The first row is the header row and is NOT imported.
- Each row creates a **new** asset — existing assets are never merged or
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
| `type`            | Optional; defaults to `INDIVIDUAL`      | `INDIVIDUAL` or `QUANTITY_TRACKED`               | On **update**: silently ignored — `type` cannot be changed via import once the asset exists.                                                   |
| `quantity`        | Required when `type = QUANTITY_TRACKED` | Positive integer                                 | Ignored on `INDIVIDUAL` rows. On the create path, `INDIVIDUAL` rows with a quantity > 1 are rejected.                                          |
| `minQuantity`     | Optional                                | Non-negative integer                             | Sets the low-stock alert threshold. Ignored on `INDIVIDUAL` rows.                                                                              |
| `unitOfMeasure`   | Optional                                | Free-text label (e.g. `boxes`, `liters`, `kg`)   | Markdoc injection characters (`{`, `%`, `}`) are stripped at parse time.                                                                       |
| `consumptionType` | Required when `type = QUANTITY_TRACKED` | `ONE_WAY` or `TWO_WAY`                           | `ONE_WAY` consumes on checkout (no return); `TWO_WAY` returns with a consumption report. Ignored on `INDIVIDUAL` rows.                         |
| `assetModel`      | Optional                                | Asset model name (created on the fly if missing) | **INDIVIDUAL rows only.** On a `QUANTITY_TRACKED` row during update, the cell is skipped with a warning and the rest of the row still applies. |

### Why asset models are INDIVIDUAL-only

An asset model groups multiple physically-distinguishable items that
share a make/model (e.g. five MacBook Pro M3 laptops, each with its
own serial). A `QUANTITY_TRACKED` asset is already a single stock pool
with a `quantity` field — modelling it under an asset-model parent
would double-count. The import enforces this both server-side (a
`QUANTITY_TRACKED` row with an `assetModel` cell is rejected on create
and warned-and-skipped on update) and in the asset-form UI.

## Example CSV (create path)

```csv
title,description,kit,category,tags,location,valuation,custodian,bookable,assetModel,type,quantity,minQuantity,unitOfMeasure,consumptionType
"MacBook Pro 16\"","M3 dev laptop",Working gear,Laptop,"High priority",Dutch office,2500,Thea,no,MacBook Pro 16-inch (M3),INDIVIDUAL,,,,
"Cardboard boxes","Shipping stock",,Supplies,small,Sofia office,,,yes,,QUANTITY_TRACKED,250,50,boxes,ONE_WAY
```

- Row 1 — `INDIVIDUAL` MacBook with an `assetModel` (auto-created if
  missing). `quantity` / `minQuantity` / `unitOfMeasure` /
  `consumptionType` left blank.
- Row 2 — `QUANTITY_TRACKED` consumable with the four qty columns
  filled and `assetModel` deliberately left blank.

## Update path (`/assets/import-update`)

The update import accepts the same columns as the create path for
fields that are safe to round-trip. As of the qty-tracked support
rollout, the updatable set is: `name`, `category`, `location`, `tags`,
`valuation`, `availableToBook`, `quantity`, `minQuantity`,
`unitOfMeasure`, `consumptionType`, `assetModel` + any custom fields.

- The `type` column is **read but ignored** — asset type is
  immutable once the asset exists.
- `quantity`, `minQuantity`, `unitOfMeasure`, `consumptionType` cells
  on `INDIVIDUAL` rows are silently ignored. Customers who exported
  their workspace and re-imported it to bulk-edit a few cells won't
  hit spurious errors.
- An `assetModel` cell on a `QUANTITY_TRACKED` row is skipped with a
  warning surfaced in the import response; other cells in the row
  still apply.

## QR codes and barcodes

See the in-app help text for the full rules — these aren't specific to
qty-tracked imports.

## Related files

- `apps/webapp/app/components/assets/import-content.tsx` — the in-app
  help text shown next to the upload form.
- `apps/webapp/app/modules/asset/service.server.ts` —
  `parseQtyTrackedCsvRow()` (create-path validator) and
  `createAssetModelsIfNotExists()` (asset-model lookup-or-create).
- `apps/webapp/app/utils/import-update-types.ts` — `UPDATABLE_FIELDS`
  whitelist for the update path.
