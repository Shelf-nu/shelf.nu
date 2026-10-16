# AI-assisted Import Mapping

The asset importer (`/assets/import`) accepts any spreadsheet export, not only
Shelf's template. Before anything is imported, Shelf shows a **mapping review**:
one row per column of the file, with the Shelf field it will become, a few
sample values and a confidence dot. The user adjusts the mapping, confirms the
"I AGREE" dialog, and the existing importer runs on the renamed columns.

## How a mapping is proposed

1. **Rules, always.** `modules/import-mapping/heuristics.ts` matches each
   header by exact Shelf name, then case- and separator-insensitive name, then
   the workspace's existing custom fields, then a synonym table ("Qty" to
   `quantity`, "Serial No." to a new "Serial number" custom field, and so on).
   Anything unmatched is skipped. This needs no network and no key.
2. **Model, when enabled.** If `ANTHROPIC_API_KEY` is set and the workspace is
   under its daily limit, `modules/import-mapping/model.server.ts` asks Claude
   Haiku 5.5 (`claude-haiku-5-5`) to improve the rules proposal. The answer is
   constrained to a JSON schema, then checked column by column: a column the
   model dropped, answered twice or mapped somewhere the importer cannot take
   keeps its rules row.
3. **The importer decides.** Applying a mapping only renames and drops
   columns (`modules/import-mapping/apply.ts`). Cell values are never changed,
   so every existing import rule (dates as YYYY-MM-DD, quantity-tracked
   columns, barcodes, QR codes, the 1,000 row limit) still applies, and row
   errors are shown in the same table as before.

The page looks the same with or without the model. Only the privacy line under
the table changes when the model was used.

## What is sent to Anthropic

Per upload, one request containing only:

- the column names;
- up to 3 non-empty sample cells per column, each cut to 60 characters;
- the number of rows;
- the names and types of up to 100 existing custom fields in the workspace;
- whether the workspace has the barcode add-on;
- the rules proposal.

The file itself, other rows, user names and workspace names are never sent.
The API key is read only in `modules/import-mapping/client.server.ts`, is never
sent to the browser and is never logged.

## Cost guards

- **Who can trigger it:** signed-in members with the asset import permission,
  on a plan that allows importing.
- **Bounded input and output:** the inputs above, at most 200 columns per
  file, `max_tokens` 2,000 per answer, a 20 second timeout and no retries.
- **Daily limit:** 50 model calls per workspace per UTC day
  (`modules/import-mapping/usage.server.ts`). Past the limit the rules
  proposal is used. The counter is held in memory: it resets when a server
  restarts and each machine counts separately, so the real ceiling is 50 times
  the number of machines. A database-backed counter is the planned follow-up.
- **Failures are free:** a timeout, error, refusal or unusable answer returns
  the rules proposal and logs a warning. The user sees no error.

## Configuration

| Variable            | Required | Effect                                                  |
| ------------------- | -------- | ------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | No       | Enables the model step. Unset it to use the rules only. |

To turn the model off in production, remove `ANTHROPIC_API_KEY` from the
environment and restart. The importer keeps working with the rule-based
proposal. Setting a monthly spend limit on the key in the Anthropic console is
recommended as a hard backstop.

## Analytics

The import route sends three PostHog events, with counts only:

- `import_mapping_proposed`: columns, low-confidence columns, proposer.
- `import_mapping_confirmed`: columns, columns changed in the review, new
  custom fields, proposer.
- `import_completed`: assets created, proposer (`none` for a file imported
  without a mapping).

## Related

- [Asset Import (CSV)](./asset-import.md) for the importer's own rules.
