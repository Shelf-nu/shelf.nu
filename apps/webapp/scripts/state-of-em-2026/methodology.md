# Methodology — State of Equipment Management 2026

This file mirrors the published methodology section of the public report at [shelf.nu/reports/state-of-equipment-management-2026](https://www.shelf.nu/reports/state-of-equipment-management-2026#methodology). It is duplicated here so the extraction script and the published report cannot drift out of sync.

When the report's methodology changes, **change it in both places in the same commit**. Bump the `methodologyVersion` string in both the report MDX frontmatter and this file's footer.

---

## Data sources

Two sources, paired:

1. **Anonymized telemetry** from production Shelf workspaces. No customer-identifying data is used. All numbers in the report are aggregates over cohorts of at least **20 workspaces**; cohorts smaller than 20 are not reported.

2. **A survey of approximately 200 workspace administrators**, distributed via email and in-app during the publication period. The survey is the source of the "operational tax" stat (median hours lost per month) and the qualitative themes in the report.

The pairing is deliberate: telemetry says what; the survey says why.

## Time window

The 12 months ending **April 30, 2026** for telemetry (data window: 2025-05-01 through 2026-04-30). Survey responses were collected in the publication month.

## Sample

Approximately **{{TODO: workspaces}} workspaces**, **{{TODO: assets}} assets**, spanning **{{TODO: countries}} countries**, plus **{{TODO: ~200} survey responses**.

## Inclusion criteria (telemetry)

A workspace is included in the report if it meets all of the following at the end of the data window:

- `Organization.type = TEAM` — Personal workspaces are excluded; they are individual sandboxes.
- `Organization.workspaceDisabled = false` — disabled workspaces don't contribute to the year's operational signal.
- Owner `User.deletedAt IS NULL` — workspaces whose owner has been soft-deleted are excluded.
- The workspace has tracked **at least 10 assets** during the data window.
- The workspace ID is **not on the internal allowlist** (`./allowlist/internal-orgs.json`).
- Where a stat requires a specific feature (e.g. audits), the workspace must have that feature enabled.

## Anonymization

- No customer names, workspace names, user names, asset titles, or location names appear in any aggregate.
- Numerical aggregates are rounded to **one significant figure** before output.
- Every aggregate must include at least **20 workspaces** in its cohort. Sub-cohort aggregates (e.g. audits-enabled subset) apply the same floor independently.
- Quotes attributed to specific customers in the report are published with that customer's explicit permission. Quotes from the survey's open-ended questions are only published with permission.

## Risk disclosures

This is the section that separates a research artifact from a marketing piece. v1.2 of the report explicitly publishes the risks it manages.

### 1. Feature-adoption risk

Several Shelf features that produce useful operational signal have bounded adoption among Team workspaces:

- **Audits add-on.** A paid feature. Not every Team workspace has it enabled, and of those that do, not every workspace runs audits in any given year.
- **Bookings.** Not every Team workspace uses bookings — some workspaces use Shelf only for custody/QR tracking.

The v1.2 published structure handles this risk explicitly:

- **The headline stat (`ds_idle_asset_dollar_value_median_workspace`) is computed from universal telemetry** — `ActivityEvent` fires for every Shelf workspace, regardless of feature mix. No paid-feature dependency. The headline survives even if audit adoption is low.
- **Audit-derived stats are published only with the qualifier "audit-enabled subset only — N% of cohort"** — never presented as platform medians.
- **Bookings-derived stats are published only with the qualifier "among workspaces that used the bookings feature during the window"** — same discipline.

The thresholds are published explicitly:

| Adoption metric | Threshold | If below threshold |
|---|---|---|
| Audits add-on enabled | 5% of cohort | Drop the audit-subset section entirely |
| Audit sessions run in window | 3% of cohort | Drop ghost-rate and audited-missing-rate from report |
| Bookings activity in window | 10% of cohort | Drop the late-return stat |
| `Asset.valuation` coverage | 30% of cohort assets | Convert dollar headlines to percentage headlines |

The extraction script's `--probe` mode (see `./probe.ts`) measures each rate against its threshold before any aggregate is computed. The published report records which stats survived the probe; those that didn't are listed in this section by name, not silently omitted.

### 2. `Asset.valuation` coverage

The valuation field is workspace-entered and partial. Approximately **{{TODO: pct_assets_with_valuation}}%** of tracked assets in the eligible cohort carry a valuation. Dollar figures are computed only over the assets with a valuation, then median-extrapolated per workspace. **The published dollar figures are conservative lower bounds** — they exclude assets without explicit valuation entirely. If overall coverage falls below the 30% threshold, the dollar headline is replaced with the percentage equivalent.

### 3. Cohort-size enforcement (k-anonymity)

Every aggregate requires a cohort of at least **20 workspaces**. Sub-cohort aggregates (e.g. the audit-enabled subset) apply the same floor independently — the extraction script does not "borrow" the global cohort size to push a small sub-cohort past the floor.

The extraction script returns `cohort_too_small` for any stat whose underlying cohort falls below 20. Those stats are omitted from the published report, not silently rounded down.

### 4. Survey response rate

The survey targeted n=200 admins. Actual responses: **{{TODO: surveyResponses}}**. If responses had fallen below n=50, the survey-derived stat would have been dropped entirely. We disclose the response rate alongside the stat itself in the report copy.

## Definitions

Where a stat could be defined multiple ways, we picked the most conservative definition.

### Idle asset (THE HEADLINE DEFINITION)

An `Asset` with **no `ActivityEvent` of any action — scan, custody change, booking event, location update, audit scan — in the prior 90 days at end of window**. Assets created within the 90-day idle window are excluded — brand-new assets without history are not "idle", they're just new.

This is the v1.2 headline because `ActivityEvent` is universal telemetry: every Shelf workspace produces these events, regardless of feature mix. Idle-asset measurement does not depend on any paid feature.

The implementation also consults `Scan.createdAt` as a fallback signal — if an asset's QR was scanned in the 90-day window but no `ActivityEvent` was recorded (a possible signal-gap case), the asset is **not** counted as idle. This is the conservative bias.

### Idle-asset dollar value (THE HEADLINE)

For each workspace: sum `Asset.valuation` over the workspace's idle assets where valuation is set. The published figure (`ds_idle_asset_dollar_value_median_workspace`) is the median across those per-workspace sums.

Median rather than mean because the distribution is right-skewed (a small number of workspaces with very high-value fleets would dominate a mean).

### Active custody

An asset has a `Custody` row (current custodian) at the moment of measurement. Historical custody transfers are tracked via `ActivityEvent` rows and could be used for handover-rate calculations in future editions; the v1 report uses only the current-state measurement.

### Late return

A `Booking` with one of the following conditions:

1. Status is `COMPLETE` or `ARCHIVED` **and** the most recent `BOOKING_CHECKED_IN` `ActivityEvent` for the booking occurred after `Booking.to`, **or**
2. Status is `ONGOING` or `OVERDUE` **and** the current time is past `Booking.to`.

Sub-cohort: workspaces that had at least one non-`DRAFT`, non-`CANCELLED` booking with `from` inside the data window. Apply k-anonymity to this sub-cohort independently.

### Recovery via Found-via-Scan

A `Scan` event from an anonymous scanner — identified by `Scan.userId IS NULL` — whose associated asset (via `Qr.assetId`) was previously marked Missing in an audit or Idle in the data window. The dollar total `ds_recovery_dollar_value_total` sums `Asset.valuation` over all recovered assets in the window across all workspaces — a single platform-wide number, not per-workspace.

The `Scan` model does not expose an explicit "anonymous" boolean column; the signal is `userId IS NULL`. The `--probe` mode verifies this signal is present and produces a non-zero count before the recovery stat is committed to publication.

### Ghost asset (audit-enabled subset definition)

An `Asset` that:

1. Exists in the workspace's asset inventory,
2. Was on the expected list of two or more consecutive `AuditAsset` rows with status `MISSING`,
3. Has had **no `AuditScan` or `Scan` event between those audits anywhere on the platform**.

The last clause is what makes the definition useful: an asset that moves without a location update is not a ghost (it gets scanned at the new location). A ghost is an asset that has genuinely vanished from operational reality.

**v1.2 scoping note:** the ghost-asset rate (`ds_ghost_asset_rate`) is published only as an **audit-enabled subset finding** — computed across workspaces that ran at least one COMPLETED audit in the window. It is never presented as a platform median. If the probe indicates audit-run rate below 3% of cohort, the stat is dropped from the published report entirely rather than published with a thin disclaimer.

### Audit completion

An `AuditSession` that reached the `COMPLETED` status within the data window. Used in the v1.2 audit-subset stat `au_pct_audited_assets_missing` (sum of `missingAssetCount` / sum of `expectedAssetCount` across sessions in the sub-cohort).

## Confidence levels

Each stat carries a confidence level. The extraction script attaches this label per stat in the output JSON, and the data file mirrors it.

- **High** — derived from a comprehensive telemetry source covering the entire eligible cohort.
- **Medium** — derived from a partial telemetry source, opt-in feature usage, or a definition that involves a judgement call.
- **Low** — reported with the figure but flagged in copy; do not cite without checking the underlying definition.

## Survey methodology

- **Audience:** workspace administrators on the Team or Enterprise tier, active in the previous 30 days.
- **Distribution:** email + in-app banner. 2-week response window. No incentive offered.
- **Sample target:** n = 200 complete responses.
- **Questions:** 5 questions, single page. The full questionnaire is published as a separate PDF alongside the report so journalists and Wikipedia editors can verify the wording.
- **Demographic capture:** industry, workspace size band, subscription tier, workspace age — captured from workspace metadata at submission time, not asked of the respondent.
- **Anonymization:** survey responses are stored separately from telemetry. Aggregate before reporting.

## Methodology version

This methodology is published as **version 1.2**. v1.1 was the trimmed-to-8 ghost-asset-headline scaffold; v1.2 pivoted the headline to idle-asset telemetry (universal `ActivityEvent` signal) and demoted ghost-asset stats to a qualified audit-enabled subset finding. Subsequent annual editions will track methodology diffs; the 2027 edition will publish a "what changed" note alongside any version bump.

## Reproducibility

The extraction script that produced the telemetry aggregates is published in the open at [github.com/Shelf-nu/shelf.nu](https://github.com/Shelf-nu/shelf.nu) under `apps/webapp/scripts/state-of-em-2026/`. The script contains no customer data — only queries and aggregation logic. The `--probe` mode (see `./probe.ts`) is a separate diagnostic that verifies feature adoption before stats are computed, so the methodology can be re-validated by anyone with database access. Independent researchers can read the queries to verify the methodology matches the published numbers.

## Limitations

- **Self-hosted Shelf instances** are not included — the report reflects hosted-cloud usage only. Self-hosted patterns may differ.
- **`Asset.valuation` coverage is partial.** Dollar figures are conservative lower bounds; they exclude assets whose workspace did not enter a valuation. The methodology discloses the coverage percentage and the script's `--probe` mode flags it explicitly.
- **"Missing" in an audit context** is what was scanned-or-not-scanned during a specific audit session, not a permanent property of the asset. We use it as input to the ghost-asset definition, which requires the additional condition of no scan activity between audits. The ghost-asset rate itself is published only as an audit-enabled subset finding, never as a platform median.
- **Idle is per-asset-per-90-days, not permanent.** An idle asset in the data window may have been actively used in a previous window; the stat reflects the snapshot at end of window, not a permanent state of the asset.
- **Survey N is small.** ~200 responses is adequate for medians and reportable themes; it is not sufficient to break out reliably by industry. The 2027 survey will aim for n=500.
- **Sample skew.** The population is Shelf customers — teams that have already opted into a structured asset-management practice. Industry-wide rates of idle assets, late returns, and missing items are likely higher than what we observe.
