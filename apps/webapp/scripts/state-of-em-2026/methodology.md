# Methodology — State of Equipment Management 2026

This file mirrors the published methodology section of the public report at [shelf.nu/reports/state-of-equipment-management-2026](https://www.shelf.nu/reports/state-of-equipment-management-2026#methodology). It is duplicated here so the extraction script and the published report cannot drift out of sync.

When the report's methodology changes, **change it in both places in the same commit**. Bump the `methodologyVersion` string in both the report MDX frontmatter and this file's footer.

---

## Data source

Anonymized telemetry from production Shelf workspaces. No customer-identifying data is used. All numbers in the report are aggregates over cohorts of at least **20 workspaces**; cohorts smaller than 20 are not reported.

## Time window

The 12 months ending **April 30, 2026** (data window: 2025-05-01 through 2026-04-30).

If you re-run the script with different `--data-window-start` / `--data-window-end` flags, document the change in the report's published methodology before publishing the new numbers.

## Inclusion criteria

A workspace is included in the report if it meets all of the following at the end of the data window:

- `Organization.type = TEAM` — Personal workspaces are excluded; they are individual sandboxes that don't reflect organizational behavior.
- `Organization.workspaceDisabled = false` — disabled workspaces don't contribute to the year's operational signal.
- Owner `User.deletedAt IS NULL` — workspaces whose owner has been soft-deleted are excluded.
- The workspace has tracked **at least 10 assets** during the data window. Workspaces below this threshold typically reflect trial / evaluation activity.
- The workspace ID is **not on the internal allowlist** (`./allowlist/internal-orgs.json`). The allowlist excludes Shelf employees, demo workspaces, and support workspaces. The allowlist is committed to the repo as a placeholder; the data team maintains the real list.
- Where a stat requires a specific feature (e.g. audits, bookings), the workspace must have that feature enabled. Feature-enabled subsets are computed per-query.

## Anonymization

- No customer names, workspace names, user names, asset titles, or location names appear in any aggregate.
- Numerical aggregates are rounded to **one significant figure** before output (e.g. 3,047 workspaces is published as approximately 3,000).
- Every aggregate must include at least **20 workspaces**. Aggregates whose underlying cohort is smaller are reported as `null` in the output JSON with a `cohort_too_small` status flag, and the published report omits them or states explicitly that they are unreportable.
- Quotes attributed to specific customers in the report are published with that customer's explicit permission. Quotes are NOT pulled from the database — they come from marketing's outreach process.

## Definitions

Where a stat could be defined multiple ways, we picked the most conservative definition.

- **Active custody.** An asset has a `Custody` row (current custodian) at the moment of measurement. Historical custody transfers are tracked via `ActivityEvent` and used for handover-rate calculations.
- **Custody handover.** An `ActivityEvent` row where `action` indicates a custody transfer event (release, assign, transfer between custodians).
- **Ghost asset.** An asset that was marked Missing in two or more consecutive audits within the window AND had no scan activity (`AuditScan` or QR scan) between those audits.
- **Idle asset.** An asset with no activity events (scan, custody change, booking, location update) in the prior 90 days at the end of the window.
- **Booking conflict averted.** An attempted booking creation that failed the conflict-prevention check (caught at the API layer; logged as a distinct event).
- **Audit completion duration.** `completedAt - startedAt`, measured for `AuditSession` rows that reached the `COMPLETED` status within the window.
- **Recovery via Found-via-Scan.** An asset previously marked Missing whose next scan after the audit was via the public Found-via-Scan flow (anonymous scanner notifies owner).
- **Industry assignment.** Best-effort match using `UserBusinessIntel.primaryUseCase` and `UserBusinessIntel.industry` on the workspace owner's record. Workspaces without filled-in business intel are bucketed as "Unspecified" and reported separately.

## Confidence levels

Each stat in the report carries a confidence level. The extraction script attaches this label per stat in the output JSON.

- **High** — derived from a comprehensive telemetry source covering the entire eligible cohort.
- **Medium** — derived from a partial telemetry source (e.g. opt-in feature usage) or a definition that involves a judgement call.
- **Low** — reported with the figure but flagged in copy; do not cite without checking the underlying definition.

## Methodology version

This methodology is published as **version 1.0**.

When the methodology changes for the 2027 edition, increment the version. Diffs between methodology versions will be published alongside the 2027 report so readers can see what changed.

## Reproducibility

The extraction script that produced these aggregates is published in the open at [github.com/Shelf-nu/shelf.nu](https://github.com/Shelf-nu/shelf.nu) under `apps/webapp/scripts/state-of-em-2026/`. The script does not include customer data — only the queries and aggregation logic.

Independent researchers can:

1. Read the queries to verify the methodology matches the published numbers.
2. (With access to a Shelf production-data clone) re-run the script and verify the output is consistent.
3. Submit issues if a query appears inconsistent with the published methodology.

## Limitations

- **Self-hosted Shelf instances** run on customer-owned databases and are not included in this dataset — the report reflects hosted-cloud usage only. Self-hosted patterns may differ.
- **Feature adoption is not uniform.** Stats restricted to feature-enabled workspaces are noted as such; the unrestricted aggregates may not be representative of teams that haven't enabled the feature.
- **"Missing" in an audit context** is what was scanned-or-not-scanned during a specific audit session. It is not a permanent property of the asset. We use it to size operational gaps, not to imply asset destruction.
- **Industry segmentation is best-effort.** Workspaces that didn't complete onboarding or that span multiple industries are classified by best-guess via `UserBusinessIntel`. Cohort sizes per industry are disclosed in the report.
- **Sample skew.** The population is Shelf customers — teams that have already opted into a structured asset-management practice. Industry-wide rates of ghost assets and similar pathologies are likely higher than what we observe.
