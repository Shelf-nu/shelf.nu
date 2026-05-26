# State of Equipment Management 2026 — Extraction Kit

This directory holds the data-extraction script for the **State of Equipment Management 2026** industry report published on `shelf.nu`. The script aggregates anonymized telemetry from the production Shelf database into a single JSON file that the marketing team copies into the public report.

**Public report:** [shelf.nu/reports/state-of-equipment-management-2026](https://www.shelf.nu/reports/state-of-equipment-management-2026)

**Companion website PR (where the JSON values land):** `shelf-nu/website-v2#142`

---

## Scope (v1.1)

The report was pivoted after editorial review from a "thorough" 30-stat scaffold to a focused **8-stat structure** organized around one viral headline: the median workspace's dollar value of ghost assets.

This script implements only the queries that produce those 8 stats. Other query modules (`bookings.ts`, `custody.ts`, `industries.ts`, `top-performers.ts`) remain in the repo for restoration in the 2027 edition but are not invoked by the orchestrator.

**The 8 stats:**

| # | Key | Source | Owner |
|---|---|---|---|
| 1 | `ds_ghost_asset_dollar_value_median_workspace` (THE HEADLINE) | `queries/disorder.ts` | this script |
| 2 | `ds_ghost_asset_rate` | `queries/disorder.ts` | this script |
| 3 | `pct_assets_with_active_custody` | `queries/visibility.ts` | this script |
| 4 | `au_pct_workspaces_running_audits` | `queries/audits.ts` | this script |
| 5 | `au_pct_audited_assets_missing` | `queries/audits.ts` | this script |
| 6 | `ds_idle_asset_dollar_value_median_workspace` | `queries/disorder.ts` | this script |
| 7 | `ds_recovery_dollar_value_total` | `queries/disorder.ts` | this script |
| 8 | `survey_hours_lost_per_month_median` | external survey tool | marketing |

7 of 8 come from this script; the 8th is plugged in manually after the external admin survey runs (see `content/reports/research-inputs/survey-design.md` on the website-v2 PR).

---

## What this script does

1. Parses CLI arguments (data window, output path, dry-run, internal allowlist).
2. Builds an **eligible-workspace cohort** per the published methodology:
   - `Organization.type = TEAM`
   - `Organization.workspaceDisabled = false`
   - Owner `User.deletedAt IS NULL`
   - `Organization.id NOT IN` the internal staff/demo allowlist
   - `>= 10 assets` tracked over the data window
3. Runs the three v1 query modules: `visibility`, `audits`, `disorder`.
4. Applies the **anonymization layer**:
   - **K-anonymity floor**: every aggregate must include >= N=20 workspaces (configurable).
   - **One significant figure rounding**.
5. Writes the result to a JSON file matching the typed structure the website expects.
6. (Future) Writes a companion CSV for publication alongside the report.

---

## Quick start

From the monorepo root:

```bash
pnpm webapp:report:state-of-em-2026 -- --output ./output/aggregates.json --dry-run
```

Dry-run exercises the cohort filter and surfaces unimplemented queries. Run that first.

Full flag reference: see `cli.ts`.

---

## Implementing the query modules

Three files to implement, in priority order:

1. **`queries/disorder.ts`** — the most important file. Contains the headline stat and two other dollar-value stats. Ghost-asset detection is a window function over `AuditAsset` rows ordered by `AuditSession.startedAt` per asset, looking for consecutive MISSING runs with no scan in between. Likely cleaner as raw SQL than Prisma ORM.

2. **`queries/audits.ts`** — two stats from `AuditSession` aggregate counts. Apply k-anonymity to the audits-enabled sub-cohort, not the global eligible cohort.

3. **`queries/visibility.ts`** — one stat. Straightforward asset / custody count.

Each query function uses `reportable({ ... })` from `../anonymize.ts` to wrap results. Do not construct `ReportableAggregate` directly — the wrapper enforces the k-anonymity check + sig-fig rounding.

Estimated engineering: **~30 hours** across the three files. `disorder.ts` is the bulk (≈15h), `audits.ts` is ≈8h, `visibility.ts` is ≈4h. The Musk-mode editorial review noted that ghost-asset detection "likely cleaner as raw SQL than Prisma ORM" — budget extra time there.

---

## Production run guidance

This script needs the real customer data to produce industry-wide aggregates. **No read-replica connection string exists in the codebase today.** Three options:

1. **Run against a fresh staging clone of production data.** Cleanest — zero load on production.
2. **Add `DATABASE_URL_REPLICA` env var** + one-line change in `state-of-em-2026.ts` to use it when present.
3. **Run directly against production** with `--i-know-what-im-doing`. Read-only, paginated, off-peak.

The production guard refuses to run with `NODE_ENV=production` unless `--i-know-what-im-doing` is passed.

---

## Workflow: data team handoff to marketing

```
1. Populate `allowlist/internal-orgs.json` with Shelf staff / demo workspace IDs.

2. Dry-run to verify cohort size:
   pnpm webapp:report:state-of-em-2026 -- --dry-run

3. Implement the three v1 query modules (disorder, audits, visibility).
   Re-run dry-run after each to confirm aggregates flip from
   `not_implemented` to `ok`.

4. Real extraction:
   pnpm webapp:report:state-of-em-2026 -- --output ./output/aggregates.json

5. Copy 7 values from `aggregates.json` into the website-v2 PR's
   `src/data/state-of-equipment-management-2026.ts` data file.

6. Plug the 8th value (survey_hours_lost_per_month_median) from the
   external survey tool result.

7. Marketing runs customer outreach for the 3 <MiniCaseStudy /> blocks.

8. Designer produces cover image + PDF layout + 3 inline data-viz images.

9. Marketing picks one external benchmark per
   `content/reports/research-inputs/external-benchmarks.md`.

10. Editorial: flip `seo.noindex: true → false` in the MDX, remove the
    publication note.

11. Publish.
```

---

## Security and review notes

This script does cross-organization aggregation, which is unusual in the Shelf codebase. Things to keep clean:

- **No customer data ever leaves an aggregate.** Aggregates only — no names, titles, emails.
- **Each query gets its own k-anonymity check.** The audits-enabled sub-cohort, the ghost-assets-with-valuation sub-cohort, etc.
- **`reportable()` is mandatory.** Direct `ReportableAggregate` construction bypasses safety; flag in code review.
- **Round before output.** Rounding in the script means the JSON itself doesn't carry leakable precision.
- **No raw SQL except via Prisma's `$queryRaw` with parameterized inputs.** Ghost-asset window function may require raw SQL — parameterize.

---

## What was deferred to 2027

The v1 editorial review (Musk-mode critique) cut these from the published report:

- **`queries/bookings.ts`** — conflicts-averted required telemetry that doesn't exist today; lead-time-days and peak-day were demographic.
- **`queries/custody.ts`** — handover-rate stats were not in the top-8 priority list; the headline custody stat (`pct_assets_with_active_custody`) moved to `visibility.ts`.
- **`queries/industries.ts`** — deferred until the sample is large enough to break out by industry segment with confidence.
- **`queries/top-performers.ts`** — the stub itself admitted these were correlations, not causal claims. Either run a real difference-in-differences in 2027, or kill the section.

The stub files remain in the repo. Restoring them is a matter of uncommenting the imports + `runSection` calls in `state-of-em-2026.ts`.

---

## License

The methodology and queries here are published in the open as a reproducibility artifact for the public report. CC BY 4.0, same as the report itself — see `./methodology.md`.
