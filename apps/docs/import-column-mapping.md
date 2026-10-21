# Import Column Mapping

The asset importer (`/assets/import`) accepts any spreadsheet export, not only
Shelf's template. Before anything is imported, Shelf shows a **mapping review**:
one row per column of the file, with a few sample values, the Shelf field the
column will become, and a dot for how sure the match is (green sure, amber a
guess). The user adjusts the mapping and presses **Preview import**; from there
the import continues as before: the server validates the renamed rows into a
draft, the preview stage shows them, and confirming queues the background
import.

The steps on `/assets/import` are: pick a file (`intent=analyze`), review the
mapping, preview (`intent=preview` with the reviewed `mapping`), confirm
(`intent=confirm`).

A file that already uses Shelf's headers (the template, or an Import-ready
export) shows the same review, all green, with the message "Your file already
matches Shelf's format".

## How a mapping is proposed

`modules/import-mapping/heuristics.ts` proposes a destination for every column,
trying in order:

1. **Exact Shelf header**, for example `title` or `cf:Serial number, type:text`.
   The import-ready export's `id` column is always skipped: it holds Shelf's
   own asset ids, which the importer ignores.
2. **Same name ignoring case and punctuation**, for example `Title` or
   `Unit of measure`. A `type` or `Type` column whose values are not
   `INDIVIDUAL` or `QUANTITY_TRACKED` is read as a category instead.
3. **An existing custom field** of the workspace with the same name. Its stored
   type is kept, because the importer refuses a header that contradicts it.
4. **A synonym** from `modules/import-mapping/synonyms.ts`, which lists over
   150 headings from Sortly, Asset Panda, Snipe-IT and hand-made spreadsheets:
   "Item Name" becomes the title, "Qty" the quantity, "Serial No." a new
   "Serial number" custom field, "Purchased" a new "Purchase date" date field,
   and so on. Barcode synonyms are used only when the workspace has the barcode
   add-on. A heading listed under `guesses` only loosely means its destination
   ("Variant Details" for description), so it is proposed as a guess.
5. **Skip**, for anything else. Columns that hold another system's ids
   ("Sortly ID", "ID") are not in the synonym table, so they are skipped
   unless an earlier rule matched them, such as an existing custom field with
   the same name.

When two columns resolve to the same destination, one keeps it and the others
are skipped. A sure match beats a guess, so an exact "Category" column keeps
the category over a "Type" column read as categories, and "Notes" keeps the
description over "Variant Details"; between equals, the first column wins. The proposal also carries short notes about values the
importer will refuse, for example a date column in DD/MM/YYYY.

`modules/import-mapping/propose.ts` is the single entry point. It accepts an
optional refiner that returns the same `MappingProposal` shape, so a second
proposer can be added later without changing the route or the review table.

## The review step

- Every row has a dropdown with all Shelf fields, "Custom field..." and "Skip".
  A custom field shows its name and type in two labelled inputs under the
  dropdown.
- Two columns aimed at one destination are flagged inline and block Preview
  import.
- A line under the table says how many rows will be imported and which custom
  fields will be created. When a column is skipped, the count reads "Up to N",
  because rows whose only values sit in skipped columns are left out. New
  categories, locations, tags, kits and custodians are listed by the preview
  that follows, which also gives the exact row count.
- Format notes (dates that are not YYYY-MM-DD real days, yes/no values) use the
  importer's own rules from `~/utils/custom-fields`, so they warn about exactly
  what the import will refuse or leave empty.
- When a quantity column is mapped and no type column is (every Sortly export),
  the review asks how the rows are tracked: individual assets (every quantity
  must be 1), stock returned after use, or stock used up. A stock answer makes
  every row quantity-tracked with that consumption type. The review starts on
  individual assets when every sampled quantity is 1, and otherwise waits for
  an answer before Preview import.
- A skipped `id` column (Shelf's own export) does not turn the count into
  "Up to N".
- Preview import is held while another import runs in the workspace.

## What the importer still checks

Applying a mapping renames and drops columns
(`modules/import-mapping/apply.ts`), drops any row left blank once its skipped
columns are gone, and adds the `type` and `consumptionType` columns of a stock
answer (a mapped `consumptionType` column is kept as it is). Cell values are
never changed, so every
existing import rule still applies: dates as YYYY-MM-DD, yes/no fields,
quantity-tracked columns, barcodes, QR codes and the 10,000-row limit of the
background import. Row
problems are listed in the same error table as before, and nothing is imported
until the whole file is valid.

A file posted without a mapping (the admin dashboard import, older clients)
runs exactly as it always did.

## Analytics

The importer sends these PostHog events. Each one is sent under the acting
user's id and carries the workspace's `organizationId`; beyond that it holds
counts, and `import_failed` a reason category. No file names, headings or cell
values are sent.

- `import_mapping_proposed`: columns, low-confidence columns.
- `import_mapping_confirmed`: columns, columns changed in the review, new
  custom fields.
- `import_completed`: assets created (sent by the background job when the import finishes).
- `import_failed`: a reason from the fixed list in
  `modules/import-mapping/failure.ts`.

## Related

- [Asset Import (CSV)](./asset-import.md) for the importer's own rules.
