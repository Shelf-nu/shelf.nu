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

## Definitions

Where a stat could be defined multiple ways, we picked the most conservative definition.

### Ghost asset

An `Asset` that:

1. Exists in the workspace's asset inventory,
2. Was on the expected list of two or more consecutive `AuditAsset` rows with status `MISSING`,
3. Has had **no `AuditScan` or `Scan` event between those audits anywhere on the platform**.

The last clause is what makes the definition useful: an asset that moves without a location update is not a ghost (it gets scanned at the new location). A ghost is an asset that has genuinely vanished from operational reality.

### Ghost-asset dollar value (THE HEADLINE)

For each ghost asset, use the workspace-entered `Asset.valuation` field.

**Asset.valuation coverage caveat:** the `valuation` field is workspace-entered and not universal. Approximately **{{TODO: pct_assets_with_valuation}}%** of tracked assets carry a valuation. Ghost-asset dollar figures are computed only over the assets with a valuation, then median-extrapolated per workspace. **The published dollar figure is a conservative lower bound** — it excludes ghost assets with no valuation entirely.

Mechanic for `ds_ghost_asset_dollar_value_median_workspace`:
- For each workspace: sum `Asset.valuation` over its identified ghost assets where valuation is set.
- `published value` = median of those per-workspace sums.

The median is used rather than the mean because the distribution is right-skewed (a few workspaces with very high asset values would dominate a mean).

### Active custody

An asset has a `Custody` row (current custodian) at the moment of measurement. Historical custody transfers are tracked via `ActivityEvent` rows and could be used for handover-rate calculations in future editions; the v1 report uses only the current-state measurement.

### Idle asset

An asset with no activity events (scan, custody change, booking, location update, audit scan) in the prior 90 days at end of window. Assets created within the 90-day idle window are excluded — brand-new assets without history are not "idle", they're just new.

### Idle-asset dollar value

Same mechanic as ghost-asset dollar value. Per-workspace sum of `Asset.valuation` over idle assets where valuation is set, then median across workspaces. Same coverage caveat applies.

### Recovery via Found-via-Scan

A `Scan` event whose source indicates an anonymous (non-Shelf-account) scanner, where the scanned asset was previously marked Missing in an audit within the same window. The dollar total `ds_recovery_dollar_value_total` sums `Asset.valuation` over all recovered assets across all workspaces in the window — a single platform-wide number, not per-workspace.

Verify the anonymous-source flag exists on the `Scan` model before publication. If it does not, this stat is `not_implemented` until telemetry is added (or the definition is loosened, which the editorial team would have to approve).

### Audit completion

An `AuditSession` that reached the `COMPLETED` status within the data window. Used in `au_pct_workspaces_running_audits` (distinct organizations with at least one COMPLETED session) and `au_pct_audited_assets_missing` (sum of `missingAssetCount` / sum of `expectedAssetCount` across sessions).

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

This methodology is published as **version 1.0**. Subsequent annual editions of this report will track methodology diffs; the 2027 edition will publish a "what changed" note alongside any version bump.

## Reproducibility

The extraction script that produced the telemetry aggregates is published in the open at [github.com/Shelf-nu/shelf.nu](https://github.com/Shelf-nu/shelf.nu) under `apps/webapp/scripts/state-of-em-2026/`. The script contains no customer data — only the queries and aggregation logic. Independent researchers can read the queries to verify the methodology matches the published numbers.

## Limitations

- **Self-hosted Shelf instances** are not included — the report reflects hosted-cloud usage only. Self-hosted patterns may differ.
- **`Asset.valuation` coverage is partial.** Dollar figures are conservative lower bounds; they exclude assets whose workspace did not enter a valuation. The methodology section discloses the coverage percentage.
- **"Missing" in an audit context** is what was scanned-or-not-scanned during a specific audit session, not a permanent property of the asset. We use it as input to the ghost-asset definition, which requires the additional condition of no scan activity between audits.
- **Survey N is small.** ~200 responses is adequate for medians and reportable themes; it is not sufficient to break out reliably by industry. The 2027 survey will aim for n=500.
- **Sample skew.** The population is Shelf customers — teams that have already opted into a structured asset-management practice. Industry-wide rates of ghost assets, idle assets, and missing items are likely higher than what we observe.
