# State of Equipment Management 2026 — Extraction Kit

This directory holds the data-extraction script for the **State of Equipment Management 2026** industry report published on `shelf.nu`. The script aggregates anonymized telemetry from the production Shelf database into a single JSON file that the marketing team copies into the public report.

**Public report:** [shelf.nu/reports/state-of-equipment-management-2026](https://www.shelf.nu/reports/state-of-equipment-management-2026)

**Companion website PR (where the JSON values land):** `shelf-nu/website-v2#142`

---

## Scope (v1.2)

The report has been through two editorial pivots:

- **v1.0 → v1.1** — Cut from 30-stat "comprehensive" scaffold to 8 prioritized stats organized around one viral headline (ghost-asset dollar value).
- **v1.1 → v1.2** — Pivoted the headline from ghost-asset dollar value (depended on the paid Audits add-on) to **idle-asset dollar value** (universal `ActivityEvent` telemetry; no paid-feature dependency). Ghost-asset stats survive as a properly-qualified audit-enabled subset finding.

The v1.2 pivot exists because honest CEO risk-management asked the right question: if a feature has bounded adoption, framing "median workspace's value of X" as a platform stat is dishonest when X depends on that feature. The new headline survives even if Audits adoption is low.

**The 8 stats:**

| # | Key | Source | Cohort |
|---|---|---|---|
| 1 | `ds_idle_asset_dollar_value_median_workspace` (**THE HEADLINE**) | `queries/disorder.ts` | Universal (all eligible orgs) |
| 2 | `ds_idle_asset_rate` | `queries/disorder.ts` | Universal |
| 3 | `pct_assets_with_active_custody` | `queries/visibility.ts` | Universal |
| 4 | `bk_pct_returned_late` | `queries/bookings.ts` | Bookings-using subset |
| 5 | `ds_recovery_dollar_value_total` | `queries/disorder.ts` | Universal (requires anonymous-scan detection) |
| 6 | `ds_ghost_asset_rate` | `queries/disorder.ts` | **Audit-enabled subset (qualified)** |
| 7 | `au_pct_audited_assets_missing` | `queries/audits.ts` | **Audit-enabled subset (qualified)** |
| 8 | `survey_hours_lost_per_month_median` | external survey tool | survey respondents |

7 of 8 come from this script; the 8th is plugged in manually after the external admin survey runs (see `content/reports/research-inputs/survey-design.md` on the website-v2 PR).

---

## What this script does

1. Parses CLI arguments (data window, output path, dry-run, probe mode, internal allowlist).
2. Builds an **eligible-workspace cohort** per the published methodology:
   - `Organization.type = TEAM`
   - `Organization.workspaceDisabled = false`
   - Owner `User.deletedAt IS NULL`
   - `Organization.id NOT IN` the internal staff/demo allowlist
   - `>= 10 assets` tracked over the data window
3. **`--probe` mode (run this FIRST)** — measures feature adoption (audits enabled, audits run, bookings active, valuation coverage, anonymous-scan capability) against published thresholds and writes a probe report. Tells you which stats survive to publication BEFORE you implement queries. See `./probe.ts`.
4. Otherwise — runs the v1.2 query modules (`visibility`, `audits`, `bookings`, `disorder`).
5. Applies the **anonymization layer**:
   - **K-anonymity floor**: every aggregate must include >= N=20 workspaces (configurable). Sub-cohorts (audit-enabled, bookings-using) apply the floor independently.
   - **One significant figure rounding**.
6. Writes the result to a JSON file matching the typed structure the website expects.
7. (Future) Writes a companion CSV for publication alongside the report.

---

## Quick start

From the monorepo root:

```bash
# Step 1 (DO THIS FIRST) — feature-adoption probe:
pnpm webapp:report:state-of-em-2026 -- --probe

# Step 2 — dry run to verify cohort + surface unimplemented queries:
pnpm webapp:report:state-of-em-2026 -- --dry-run

# Step 3 — full extraction:
pnpm webapp:report:state-of-em-2026 -- --output ./output/aggregates.json
```

Full flag reference: see `cli.ts`.

---

## Why `--probe` runs first

The probe is the v1.2 risk-discipline layer.

It runs five measurements against the eligible cohort:

1. **Audits add-on enabled** — how many Team workspaces have the paid Audits feature on? Editorial context for the audit-subset narrative.
2. **Audits actually run in window** — how many of those workspaces ran a COMPLETED audit? Gates `ds_ghost_asset_rate` and `au_pct_audited_assets_missing`.
3. **Bookings activity in window** — how many workspaces used bookings? Gates `bk_pct_returned_late`.
4. **`Asset.valuation` coverage** — what % of cohort assets have a workspace-entered valuation? Below 30%, dollar headlines convert to percentage headlines.
5. **Anonymous-scan capability** — does `Scan.userId IS NULL` produce a usable signal for Found-via-Scan recovery? Gates `ds_recovery_dollar_value_total`.

Each measurement is compared against a published threshold (see `probe.ts`, `ADOPTION_THRESHOLDS`). The probe writes a JSON report listing which stats survive, which need qualification, and which should be dropped from v1 entirely. **The website MDX is updated to match the probe's recommendations before the aggregates are computed** — that's the workflow.

This is the discipline that earns the citation. A report that openly publishes "we measured audit-feature adoption at X%, dropped the headline that depended on it, and pivoted to universal telemetry" is materially more citable than one that quietly published the headline anyway.

---

## Implementing the query modules

Four files to implement, in priority order:

1. **`queries/disorder.ts`** — the most important file. Contains the headline idle stat, the rate companion, recovery dollars, and the demoted ghost-asset rate. Idle-asset detection is a LEFT JOIN over `ActivityEvent` (and `Scan` as a fallback signal); likely cleaner as raw SQL than Prisma ORM. Ghost-asset detection is a window function over `AuditAsset` rows ordered by `AuditSession.startedAt` per asset.

2. **`queries/audits.ts`** — one subset stat (`au_pct_audited_assets_missing`). The probe should have already confirmed audit-run rate clears the threshold; if not, this stat should be removed before publication.

3. **`queries/bookings.ts`** — un-deferred in v1.2 for one stat (`bk_pct_returned_late`). Booking model has no `actualReturnAt` column; reconstruct from `ActivityEvent` BOOKING_CHECKED_IN.

4. **`queries/visibility.ts`** — one universal stat (`pct_assets_with_active_custody`). Straightforward.

Each query function uses `reportable({ ... })` from `../anonymize.ts` to wrap results. Do not construct `ReportableAggregate` directly — the wrapper enforces the k-anonymity check + sig-fig rounding.

Estimated engineering: **~30 hours** across the four files. `disorder.ts` is the bulk (≈15h), with the idle LEFT JOIN being the new piece; `bookings.ts` is ≈6h; `audits.ts` is ≈5h; `visibility.ts` is ≈4h.

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

2. Probe feature adoption to know which stats survive v1.2:
   pnpm webapp:report:state-of-em-2026 -- --probe

   Read the probe output. For every stat marked DROP, update the website MDX
   on website-v2#142 to remove or down-weight the corresponding section.
   For every stat marked QUALIFY, confirm the qualification text is present
   in the MDX prose.

3. Dry-run to verify cohort size + surface unimplemented queries:
   pnpm webapp:report:state-of-em-2026 -- --dry-run

4. Implement the v1.2 query modules (disorder, audits, bookings, visibility).
   Re-run dry-run after each to confirm aggregates flip from
   `not_implemented` to `ok`.

5. Real extraction:
   pnpm webapp:report:state-of-em-2026 -- --output ./output/aggregates.json

6. Copy 7 values from `aggregates.json` into the website-v2 PR's
   `src/data/state-of-equipment-management-2026.ts` data file.

7. Plug the 8th value (survey_hours_lost_per_month_median) from the
   external survey tool result.

8. Marketing runs customer outreach for the 3 <MiniCaseStudy /> blocks.

9. Designer produces cover image + PDF layout + 3 inline data-viz images.

10. Marketing picks one external benchmark per
    `content/reports/research-inputs/external-benchmarks.md`.

11. Editorial: flip `seo.noindex: true → false` in the MDX, remove the
    publication note.

12. Publish.
```

---

## Security and review notes

This script does cross-organization aggregation, which is unusual in the Shelf codebase. Things to keep clean:

- **No customer data ever leaves an aggregate.** Aggregates only — no names, titles, emails.
- **Each query gets its own k-anonymity check.** The audits-enabled sub-cohort, the bookings-using sub-cohort, the assets-with-valuation sub-cohort, etc.
- **`reportable()` is mandatory.** Direct `ReportableAggregate` construction bypasses safety; flag in code review.
- **Round before output.** Rounding in the script means the JSON itself doesn't carry leakable precision.
- **No raw SQL except via Prisma's `$queryRaw` with parameterized inputs.** The idle and ghost-asset queries may require raw SQL — parameterize.
- **Probe output is internal.** `probe.json` reveals feature-adoption rates that we deliberately do not publish. Treat it as internal data; do not commit it to the public repo, do not paste it into customer-facing materials.

---

## What was deferred to 2027

The v1.1 editorial review (Musk-mode critique) cut these from the published report. v1.2 added `bookings.ts` back for one stat; the rest are still deferred:

- **`queries/bookings.ts`** — un-deferred in v1.2 for `bk_pct_returned_late` only. The other six stats from v1.0 (conflict averted, lead time, peak day, overdue hours, etc.) remain deferred.
- **`queries/custody.ts`** — handover-rate stats were not in the top-8 priority list; the headline custody stat (`pct_assets_with_active_custody`) moved to `visibility.ts`.
- **`queries/industries.ts`** — deferred until the sample is large enough to break out by industry segment with confidence.
- **`queries/top-performers.ts`** — the stub itself admitted these were correlations, not causal claims. Either run a real difference-in-differences in 2027, or kill the section.

The stub files remain in the repo. Restoring them is a matter of uncommenting the imports + `runSection` calls in `state-of-em-2026.ts`.

---

## License

The methodology and queries here are published in the open as a reproducibility artifact for the public report. CC BY 4.0, same as the report itself — see `./methodology.md`.
