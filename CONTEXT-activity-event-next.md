# Context: Activity Event — What's Next

> Companion to `CONTEXT-activity-event.md`. This PR is the **data-collection foundation**. It deliberately stops short of the UI, the feed migration, and the report catalog expansion. This file covers everything the colleague might be expected to pick up after this lands.

---

## 1. What this PR deliberately does NOT do

| Deferred item | Why deferred | Where to start |
|---|---|---|
| Reporting UI (routes, filters, tables, charts, CSV) | Keeps PR reviewable; UI needs its own plan | §2 below |
| Activity-feed UI migration to `ActivityEvent` | Wait for feed parity confirmation first | §3 below |
| Retiring `type = UPDATE` note writes | Depends on feed migration | §3 below |
| Historical backfill | User decision: tracking starts now | §4 below |
| Full event coverage (array changes, assignees, dates) | Add as reports demand | `CONTEXT-activity-event-integration.md` §8–9 |

---

## 2. The reporting UI — next plan

This is the immediate follow-up. There's enough in the current module to start consuming right away.

### Scope

Design and build a `/reports` route hierarchy that lets users answer operational questions without SQL. The prior "Reporting v2" plan (which we rejected its data approach but kept the UI structure) listed ten target reports. Most of them map cleanly to `ActivityEvent`:

| Report | Data source | Notes |
|---|---|---|
| R1. Asset Inventory (snapshot) | `Asset` table directly | Current-state, no events |
| R2. Booking Compliance | `ActivityEvent` — `BOOKING_STATUS_CHANGED` + `BOOKING_CHECKED_IN` + `bookingStatusTransitionCounts` helper | Was the hardest one under the old plan; trivial now |
| R3. Top Booked Assets | `ActivityEvent` — `BOOKING_CHECKED_OUT` groupBy assetId | |
| R4. Idle Assets | `Asset` + `ActivityEvent` — `BOOKING_CHECKED_OUT` max(occurredAt) per asset | Mixed |
| R5. Custody Snapshot (live) | `Custody` table directly | Current-state |
| R6. Overdue Items (live) | `Booking` table directly | Current-state |
| R7. Asset Activity Summary | `ActivityEvent` — `assetChangeHistory` helper + counts | Fully event-driven |
| R8. Asset Utilization | `ActivityEvent` — `custodyDurationsByAsset` + booking event intervals | Interval math |
| R9. Monthly Booking Trends | `ActivityEvent` — `BOOKING_CREATED` groupBy `date_trunc('month', occurredAt)` | |
| R10. Distribution (Category/Location) | `Asset` with groupBy | Current-state |

Reports split cleanly: half are event-driven (reports over time), half are current-state snapshots (reports of now). The existing `reports.server.ts` covers the event-driven side; snapshot reports query operational tables directly.

### UI primitives needed

From the earlier UI plan (see `remote-plan-extracted.md`):

- `<TimeframePicker>` — preset grid (today / this week / this month / last N days / custom range). Wraps `calendar-input.tsx` for custom.
- `<FilterBar>` — renders the report's declared filter set as URL-bound controls.
- `<ReportTable>` — thin wrapper over existing `<List>` with `ColumnDef[]` config → `headerChildren` + `ItemComponent`.
- `<KPICards>` — big-number cards with optional period-over-period delta.
- `<ReportShell>` — page layout (header, filter bar, saved-views row, results, export).
- `<ExportReportButton>` — parallel to `<ExportAssetsButton>`, hits a reports CSV endpoint.
- Chart primitives via `@tremor/react` — already a dependency (used in `asset-growth-chart.tsx`, `assets-by-status-chart`, `inventory-value-chart`).

### Route shape

Match Shelf's conventions:

```
apps/webapp/app/routes/_layout+/
├── reports._index.tsx                          — list of available reports + saved-view tiles
├── reports.$reportId.tsx                       — runner: filters + results
└── reports.$reportId.export.$fileName[.csv].tsx — CSV export (pattern matches assets.export.*)
```

API route for JSON (v1.1, optional):

```
apps/webapp/app/routes/api+/reports.$reportId[.json].ts
```

### Saved views

The prior plan proposed extending `AssetFilterPreset` → `FilterPreset` with a `scope` column (`'ASSET_INDEX' | 'BOOKING_INDEX' | 'REPORT:<reportId>'`) and an `isShared` flag. That's still a good idea — **additive migration (no rename)**. Touches `AssetFilterPreset` schema + `modules/asset-filter-presets/service.server.ts`.

### Auth

Add `PermissionEntity.reports` to the existing permission enum. Actions:

- `read` — list + run + view
- `export` — download CSV
- `createSavedView` — save personal preset
- `shareSavedView` — mark as team-shared

`read` and `export` already exist as `PermissionAction` values. `createSavedView` / `shareSavedView` are new. Role mapping: OWNER/ADMIN auto-pass; BASE gets read+export+createSavedView; SELF_SERVICE currently debated — the earlier review flagged that exposing aggregate workspace data to self-service users may over-share.

### Caching (open question)

The old plan proposed a `report_cache` table for compute-on-read caching with TTLs. Worth doing **if** reports become slow or frequent. Premature now — start without it, add if `computedMs` logs justify it.

### Starting material to reuse

- `reports.server.ts` — already has 4 helper queries.
- The earlier Reporting-v2 review (folded into these context files) documented:
  - CSV should be buffered (not streamed) in v1 with a 10 000-row cap — matches Shelf's existing `assets.export.*` pattern.
  - Rate-limit `?refresh=true` bypass requests via a DB-backed limiter (multi-instance Fly deploys make in-memory limiters unreliable).
  - KPIs must be computed via SQL aggregates, not in-process from truncated row arrays.

### What doesn't apply from the old plan

- Postgres views (`vw_asset_activity` et al.) — not needed; Prisma queries on `ActivityEvent` replace them.
- Regex dedup logic — not needed.
- Note-content classification patterns — not needed.
- `pg_cron` cache cleanup — not needed until a cache is introduced.
- The SQL-review checklist re: "highlight `WHERE organization_id = ?` in diff" — still good practice for any raw SQL, but most queries go through Prisma which enforces org scoping naturally.

---

## 3. Feed migration + retiring UPDATE notes

After the reporting UI ships and events are proving reliable in production, a later PR can:

1. **Verify feed parity** — write a script that replays the last 30 days of note activity for a representative org and confirms `ActivityEvent` rows cover the same events at the same timestamps. Any gap gets fixed in the integration points.
2. **Migrate the feed UI** to render from `ActivityEvent`. The rendering template picks the right copy based on `action` + `field` + `fromValue`/`toValue`. User-facing string changes can now happen in one place (the renderer) without breaking reports.
3. **Retire UPDATE-type note writes** everywhere. `COMMENT`-type notes (user-authored) stay. This is a potentially risky change — should be behind a feature flag and rolled out carefully.

This is deliberately not in scope now. Doing it too early would:
- Require feed parity proof that we don't yet have.
- Lock us into the current event coverage, which is tuned for reports — the feed may need additional events (e.g., comments, custom-field notes with richer formatting).

---

## 4. Historical backfill (if ever)

The decision on this PR: **no backfill**. Tracking starts at deploy. This is the right call because:

- Backfilling would require re-running the note-regex parser we were rejecting.
- The activity feed UI still shows all historical notes, so users aren't losing anything visible.
- Reports that span months will show a "tracking started on X" indicator.

If the business later wants historical reporting:

### Option A: selective backfill for specific events

A one-off migration that populates `ActivityEvent` from notes for a known-good regex set (e.g., "CHECK_IN" events from the clear `"checked in asset"` note pattern). Accept that coverage is incomplete.

### Option B: full regex backfill with opt-in

Run the regex parser once across all historical notes, populating `ActivityEvent` with `occurredAt = note.createdAt`. Mark those events with `meta: { source: "backfill" }` so reports can exclude them if questioned. Flag the cutover date.

### Option C: never

Accept the current-forward-only model. Reports get better over time; historical insights come from running the old report-from-notes pattern as a one-off SQL query when a stakeholder asks.

C is the current posture. If that changes, pick A or B based on how much confidence you want.

---

## 5. Open questions worth raising with the team

### a) Should `SELF_SERVICE` role have report read access?

The old Reporting-v2 review flagged this. Reports aggregate workspace-wide data. Self-service users are often external renters / borrowers. Seeing "workspace had 87 bookings last month" may be fine, or it may be information leakage depending on the workspace's threat model. Default-allow might be wrong.

Propose: default-deny for SELF_SERVICE in v1 of the reporting UI; add a per-report opt-in (`report.audience: ["BASE", "ADMIN"]`) if specific reports should be more open.

### b) Tier gating

The old plan proposed making reports included in all tiers for v1 ship simplicity, with a future `report.requiredTier` config. Probably right — revisit if specific reports become competitive differentiators.

### c) RLS on `ActivityEvent`

The Reporting-v2 review noted that most Shelf tables (Asset, Booking, Note, etc.) don't actually have Row Level Security policies — the runtime assertion / `WHERE organizationId` is the only barrier. `ActivityEvent` is the same. For defense-in-depth, adding RLS policies on `ActivityEvent` and the source tables would be valuable, but it's out-of-scope for this PR and the reporting UI PR. Worth a separate project.

### d) Retention / archival

At 3M events/year × 7 indexes, storage is manageable but unbounded. No archival strategy now. Revisit at 10M rows, or partition by month (Postgres 10+ supports declarative partitioning on `occurredAt` cleanly).

### e) Idempotency

No dedup key. If a mutation retries (network error, webhook redelivery), duplicate events are possible. Inside transactions this is rare. Webhook-triggered mutations would be the main risk. Address by adding a unique constraint on `(organizationId, action, entityId, occurredAt, <some key>)` if/when this becomes a real problem.

---

## 6. Coordination with other branches

### `feat-quantities`

Introduces `.claude/rules/` with `use-badge-colors.md` and `self-improve-rules.md`. Our two new rule files follow the same format and don't overlap. When both land, `.claude/rules/` accumulates four files — no conflicts.

### `feat/bulk-update-assets-via-import`

Recently merged (in current `main`). The bulk-update flow doesn't currently emit `ActivityEvent` rows — if that flow is going to be a significant source of asset edits, it should get instrumented following the same per-field pattern as `updateAsset`. This is follow-up work, not blocker.

### `feat/audit-archive`

Recently merged. Audit archival is covered by our `AUDIT_ARCHIVED` emission in both single and bulk flows (see integration map §5).

### `fix-create-note-permissions`

Unmerged branch fixing a permission bug. Probably independent of this PR. No coordination needed.

---

## 7. Tips for the next Claude

Things that would have saved me time:

### Do the typecheck-lint loop frequently

After every block of edits: `pnpm exec tsc --noEmit --project apps/webapp/tsconfig.json` and `pnpm --filter @shelf/webapp lint`. The typechecker catches 90% of mistakes (wrong enum value, wrong cross-ref, payload shape) at compile time thanks to the discriminated union.

### Don't fight Prisma's extended client type

The `RecordEventTxClient` structural type is there for a reason. Don't try to re-type `tx` as `Prisma.TransactionClient` in call sites — it won't assign cleanly. Trust the structural type.

### Check if events fire in the expected code path

Some mutation functions are "inner helpers" called by other service functions. When wiring, always think: "who calls this?" If `checkinBooking` is called both directly by a route and indirectly by a partial-check-in finalisation, both paths get the event automatically because it's in the helper. Easy to over-wire if not careful.

### Use `recordEvents` for bulk

If you find yourself writing a for-loop of `recordEvent` calls, replace with a single `recordEvents([...])` — same semantics, and it dedupes user lookups across the batch.

### `meta` is for extras, not payload

Don't put `fromValue`/`toValue` in `meta`. They have their own columns. `meta` is for action-specific extras that don't fit anywhere else (like `{ isExpected }` on scan events or `{ viaKit: true }` on kit-sourced custody events). Keeping this clean matters for `groupBy` queries.

### When extending the enum, also update `types.ts`

Adding a new `*_CHANGED` action to `ActivityAction` isn't enough — if it's a field-change, also add it to the `FieldChangeAction` union in `types.ts`, otherwise the compiler won't require `field`/`fromValue`/`toValue` at call sites.

---

## 8. Quick reference — files and commands

### Files you'll most often touch

- `apps/webapp/app/modules/activity-event/service.server.ts` — the core service
- `apps/webapp/app/modules/activity-event/types.ts` — when adding actions
- `apps/webapp/app/modules/activity-event/reports.server.ts` — when adding report helpers
- `packages/database/prisma/schema.prisma` — when adding enum values or columns
- `.claude/rules/*` — when documenting new conventions

### Commands

```bash
# After schema changes (the colleague runs these; Claude shouldn't):
pnpm db:prepare-migration --name <name>
pnpm db:deploy-migration

# Typecheck and lint (fast):
pnpm exec tsc --noEmit --project apps/webapp/tsconfig.json
pnpm --filter @shelf/webapp lint
pnpm --filter @shelf/webapp lint:fix

# Full validate (slow, and tests currently fail due to the pre-existing MSW issue):
pnpm webapp:validate
```

### Where reports go

```ts
// New helper in reports.server.ts:
export async function myReport({
  organizationId,
  from,
  to,
  ...otherParams
}: ReportScope & { ... }): Promise<MyReportRow[]> {
  try {
    const rows = await db.activityEvent.findMany({
      where: {
        organizationId,
        occurredAt: { gte: from, lte: to },
        action: "MY_ACTION",
        // ... any other filters
      },
      // Use indexed columns in where/orderBy for performance.
      orderBy: { occurredAt: "desc" },
      select: /* minimal shape */,
    });
    return rows.map(transformToReportShape);
  } catch (cause) {
    throw wrap(cause, "myReport", { organizationId });
  }
}
```

---

## 9. TL;DR

- **This PR** is data collection: `ActivityEvent` table + module + rule files + 25 call sites.
- **Not in this PR:** UI, saved views, permission entity, cache, feed migration, historical backfill.
- **Main follow-up:** build the reporting UI on top of `modules/activity-event/reports.server.ts`.
- **Later follow-up:** feed migration and retiring `UPDATE` notes.
- **Maybe-ever follow-up:** historical backfill.

Read `CONTEXT-activity-event.md` if you haven't. Read `CONTEXT-activity-event-architecture.md` for design rationale. Read `CONTEXT-activity-event-integration.md` for exact call-site coverage. Then pick whatever's next.
