# Import Column Mapping

The asset importer (`/assets/import`) accepts any spreadsheet export, not only
Shelf's template. Before anything is imported, Shelf shows a **mapping review**:
one row per column of the file, with a few sample values, the Shelf field the
column will become, and a dot for how sure the match is (green sure, amber a
guess). The user adjusts the mapping, confirms the "I AGREE" dialog, and the
existing importer runs on the renamed columns.

A file that already uses Shelf's headers (the template, or an Import-ready
export) shows the same review, all green, with the message "Your file already
matches Shelf's format".

## How a mapping is proposed

`modules/import-mapping/heuristics.ts` proposes a destination for every column,
trying in order:

1. **Exact Shelf header**, for example `title` or `cf:Serial number, type:text`.
2. **Same name ignoring case and punctuation**, for example `Title` or
   `Unit of measure`. A `Type` column whose values are not `INDIVIDUAL` or
   `QUANTITY_TRACKED` is read as a category instead.
3. **An existing custom field** of the workspace with the same name. Its stored
   type is kept, because the importer refuses a header that contradicts it.
4. **A synonym** from `modules/import-mapping/synonyms.ts`, which lists over
   150 headings from Sortly, Asset Panda, Snipe-IT and hand-made spreadsheets:
   "Item Name" becomes the title, "Qty" the quantity, "Serial No." a new
   "Serial number" custom field, "Purchased" a new "Purchase date" date field,
   and so on. Barcode synonyms are used only when the workspace has the barcode
   add-on.
5. **Skip**, for anything else. Columns that hold another system's ids
   ("Sortly ID", "ID") are not in the table, so they are skipped.

When two columns resolve to the same destination, the first keeps it and the
later one is skipped. The proposal also carries short notes about values the
importer will refuse, for example a date column in DD/MM/YYYY.

`modules/import-mapping/propose.ts` is the single entry point. It accepts an
optional refiner that returns the same `MappingProposal` shape, so a second
proposer can be added later without changing the route or the review table.

## The review step

- Every row has a dropdown with all Shelf fields, "Custom field..." (name and
  type) and "Skip".
- Two columns aimed at one destination are flagged inline and block Import.
- A line under the table says how many rows will be imported and which custom
  fields, categories and locations will be created.

## What the importer still checks

Applying a mapping only renames and drops columns
(`modules/import-mapping/apply.ts`). Cell values are never changed, so every
existing import rule still applies: dates as YYYY-MM-DD, yes/no fields,
quantity-tracked columns, barcodes, QR codes and the 1,000 row limit. Row
problems are listed in the same error table as before, and nothing is imported
until the whole file is valid.

A file posted without a mapping (the admin dashboard import, older clients)
runs exactly as it always did.

## Analytics

The import route sends these PostHog events, with counts only:

- `import_mapping_proposed`: columns, low-confidence columns.
- `import_mapping_confirmed`: columns, columns changed in the review, new
  custom fields.
- `import_completed`: assets created.
- `import_failed`: a reason from the fixed list in
  `modules/import-mapping/failure.ts`.

## Related

- [Asset Import (CSV)](./asset-import.md) for the importer's own rules.
