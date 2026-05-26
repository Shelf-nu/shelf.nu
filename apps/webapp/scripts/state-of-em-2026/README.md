# State of Equipment Management 2026 — Extraction Kit

This directory holds the data-extraction script for the **State of Equipment Management 2026** industry report published on `shelf.nu`. The script aggregates anonymized telemetry from the production Shelf database into a single JSON file that the marketing team then copies into the public report.

**Public report:** [shelf.nu/reports/state-of-equipment-management-2026](https://www.shelf.nu/reports/state-of-equipment-management-2026)

**Companion website PR (where the JSON values land):** `shelf-nu/website-v2#142`

---

## What this does

1. Parses CLI arguments (data window, output path, dry-run, internal allowlist).
2. Builds an **eligible-workspace cohort** per the report's published methodology:
   - `Organization.type = TEAM` (Personal workspaces excluded)
   - `Organization.workspaceDisabled = false`
   - Owner `User.deletedAt = null` (not soft-deleted)
   - `Organization.id NOT IN` the internal staff/demo allowlist
   - `≥ 10 assets` tracked over the data window
   - Feature-specific subqueries restrict to feature-enabled workspaces where applicable
3. Runs each query module against that cohort — visibility, bookings, custody, audits, cost-of-disorder, industries, top-performer patterns.
4. Applies the **anonymization layer**:
   - **K-anonymity floor**: every aggregate must include at least N=20 workspaces (configurable via `--min-cohort-size`). Smaller cohorts are reported as `null` with a `cohort_too_small` status flag.
   - **One significant figure rounding**: numerical aggregates are rounded so the published number doesn't leak precision.
5. Writes the result to a JSON file matching the typed structure the website expects.
6. (Optional) Writes a companion CSV of the published aggregates for publication alongside the report.

---

## Quick start

From the monorepo root:

```bash
pnpm webapp:report:state-of-em-2026 -- --output ./output/aggregates.json --dry-run
```

or, equivalently:

```bash
cd apps/webapp
pnpm report:state-of-em-2026 -- --output ./output/aggregates.json --dry-run
```

The `--dry-run` flag exercises the entire pipeline — cohort filter, queries, anonymization, schema validation — without writing the output file. Use it first to confirm the cohort size and surface any not-yet-implemented queries.

Once the dry run looks healthy, drop `--dry-run` to produce the real output:

```bash
pnpm webapp:report:state-of-em-2026 -- --output ./output/aggregates.json
```

The full set of flags:

| Flag | Default | Purpose |
|---|---|---|
| `--output <path>` | `./output/aggregates.json` | Where to write the result JSON |
| `--csv <path>` | (none) | Optional companion CSV for publication |
| `--data-window-start <YYYY-MM-DD>` | `2025-05-01` | Start of the observation window |
| `--data-window-end <YYYY-MM-DD>` | `2026-04-30` | End of the observation window |
| `--min-assets <n>` | `10` | Minimum assets per workspace for inclusion |
| `--min-cohort-size <n>` | `20` | K-anonymity floor; aggregates below this are nulled |
| `--internal-allowlist <path>` | `./allowlist/internal-orgs.json` | JSON file of org IDs to exclude (Shelf staff / demo workspaces) |
| `--dry-run` | `false` | Run the pipeline without writing output |
| `--i-know-what-im-doing` | `false` | Required for `NODE_ENV=production` |
| `--help` | | Print usage and exit |

---

## Running against production

This script is intended to be run against the **production database** — it needs the real customer data to produce industry-wide aggregates. There is currently **no read-replica connection string in the codebase** (see methodology); you have three options, listed from safest to most convenient:

1. **Run against a fresh staging clone of production data.** Cleanest — zero load on production. Document the clone date as the data-window end date.
2. **Add a `DATABASE_URL_REPLICA` env var** pointing at a read-replica, and update `extract.ts` to construct the Prisma client with that URL when present. Best long-term answer; one-line change inside the extract entry point.
3. **Run directly against production** with `--i-know-what-im-doing`. The script holds a single read-only connection, uses small `take`/cursor pages, and never writes. But it does increase query load. Schedule during off-peak hours if you choose this route.

The production guard refuses to run with `NODE_ENV=production` unless `--i-know-what-im-doing` is passed:

```
Refusing to run with NODE_ENV=production without --i-know-what-im-doing.
This script reads from the production database — confirm intent and try again.
```

---

## Workflow: data team handoff to marketing

```
   shelf.nu (this repo)                      website-v2 (companion PR)
   ──────────────────────────────────────────────────────────────────────────────────────
   1. Implement query modules         ├──>  (waits)
      under ./queries/ (one
      per finding section)

   2. Run script in dry-run mode      ├──>  (waits)
      to verify cohort size

   3. Run script for real    │           │
      output/aggregates.json ├─────────▶   src/data/state-of-equipment-
                              │           │   management-2026.ts
                              │           │
   4. Publish CSV companion  ├─────────▶   public/reports/state-of-equipment-
      output/aggregates.csv  │           │   management-2026.csv
                              │           │
                              │           │   (designer)
                              │           ├── public/reports/state-of-equipment-
                              │           │   management-2026.pdf
                              │           │
                              │           ├── public/images/reports/state-of-
                              │           │   equipment-management-2026/cover.png
                              │           │
                              │           │   (marketing)
                              │           ├── Customer-quote outreach
                              │           │
                              │           └── Flip `seo.noindex: true` → false
                              │
   5. Source code stays open  │
      in this repo as the     │
      report's reproducibility────────▶   Linked from the published report's
      artifact                            "About this report" section
```

---

## Implementing the query modules

The stubs under `./queries/` each export one function:

```ts
import type { ExtendedPrismaClient } from "@shelf/database";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runVisibilityQueries(
  db: ExtendedPrismaClient,
  ctx: ExtractorContext,
): Promise<QueryResult> {
  // implementation goes here
}
```

Each function returns a `QueryResult` whose shape is defined in `./output-schema.ts`. The orchestrator at `state-of-em-2026.ts` calls every query and merges the results.

The stubs throw `NotImplementedError` so a partially-implemented run fails loudly. Replace the stub's body with the real query; the rest of the pipeline is already wired.

---

## Adding a new aggregate

1. Define the new key in `./output-schema.ts` under the relevant section.
2. Implement the Prisma query in the relevant `./queries/*.ts` file.
3. Run the script with `--dry-run` and inspect the output for the new key.
4. Update the corresponding entry in `src/data/state-of-equipment-management-2026.ts` on the website-v2 PR with the new value.
5. Reference it from the report MDX via a `<StatBlock />` or inline.

---

## Security and review notes

This script does **cross-organization aggregation**, which is unusual in the Shelf codebase — every other query is org-scoped. Reviewers (and the lefthook Claude security review) will examine this closely. Things to keep clean:

- **No customer data ever leaves an aggregate.** Never write `Organization.name`, `User.email`, `Asset.title`, etc. to the output. Only counts, medians, and percentages.
- **Each query gets its own k-anonymity check.** Don't trust the global cohort floor — a query that subsets to, say, "workspaces with the Audits add-on" needs to verify that sub-cohort is also ≥ N.
- **Round before output, not just before display.** Rounding in the script means the JSON itself doesn't carry leakable precision.
- **No raw SQL except via Prisma's `$queryRaw` with parameterized inputs.** If you have to drop to raw SQL for a complex aggregate, parameterize.
- **Use the dedicated `createDatabaseClient` connection.** Do NOT reuse `app/database/db.server.ts` — it's the Remix singleton and not appropriate for a script.

If in doubt, ask in code review before merging.

---

## License

The **methodology and queries** in this directory are published in the open as a reproducibility artifact for the public report. Releasing them under the same CC BY 4.0 license as the report itself — see `./methodology.md`.

---

## See also

- `./methodology.md` — the full methodology, mirrored from the published report
- `./cli.ts` — argument parsing
- `./context.ts` — shared extractor context (db, data window, options)
- `./cohort.ts` — eligibility filter
- `./anonymize.ts` — k-anonymity + rounding helpers
- `./output-schema.ts` — typed output JSON shape
- `./queries/*.ts` — per-section query modules
- `../state-of-em-2026.ts` — the orchestrator entry point
