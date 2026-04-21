# Context: Activity Event Feature — Start Here

> **Read this first.** This file gives a colleague (and their Claude) the full picture of the `ActivityEvent` / structured-activity-tracking PR on branch `feat-reporting`. Three companion files go deeper:
>
> - `CONTEXT-activity-event-architecture.md` — design, schema, module internals, type system, decisions.
> - `CONTEXT-activity-event-integration.md` — every call site that emits events, with file paths and line refs, plus what was deliberately skipped.
> - `CONTEXT-activity-event-next.md` — what this PR does **not** do, the UI follow-up plan, open questions, known edge cases.
>
> Prior planning artifact still in the repo:
>
> - `remote-plan-extracted.md` — the structured-event plan produced by a remote `/ultraplan` session (original source). An earlier review of the rejected "reports-over-regex-on-notes" approach existed as a working doc during planning; its conclusions are folded into this family of CONTEXT files and the `remote-plan-extracted.md` file itself.

---

## 1. Why this PR exists

### The original approach and why we rejected it

Shelf's earlier reporting-v2 plan built reports on top of **regex-parsing `Note.content`** (the existing activity-feed UPDATE notes). Four Postgres views classified note text into event types using `ILIKE` patterns. It would have worked as a quick one-off for reports, but as a shipped feature it's dangerous:

- Note copy changes silently break every report.
- "value" / "category" / "custody" patterns are too broad and produce false positives.
- Some notes are route-coupled (e.g. check-out notes at `bookings.$bookingId.overview.tsx:863`), so moving a mutation between layers breaks the view.
- Three different check-in flows write three different note strings — one of which does not match the classification pattern at all (silent CHECK_IN drop).
- `Note` has no `organizationId` (must join Asset), no typed `from`/`to`, no structured `action`, and no cross-entity references.

The full list of P0/P1 issues that surfaced during the earlier review is summarised inline in `remote-plan-extracted.md` — those are the problems this PR eliminates by **never** relying on note parsing for reports.

### What we built instead

A single structured event log, written in parallel with the existing notes:

```
┌─────────────────────┐           ┌─────────────────────┐
│  Mutation (e.g.     │           │  Existing activity  │
│  updateAsset,       │──writes──▶│  notes (Note /      │
│  checkoutBooking,   │           │  BookingNote /      │
│  recordAuditScan)   │           │  AuditNote)         │
│                     │           │   → UI feed         │
│                     │           └─────────────────────┘
│                     │           ┌─────────────────────┐
│                     │──writes──▶│  ActivityEvent      │
│                     │  (same tx)│  (typed columns +   │
│                     │           │  JSON meta)         │
└─────────────────────┘           │   → reports         │
                                  └─────────────────────┘
```

**Invariants:**
- The existing activity-feed UI keeps rendering from the note tables unchanged — zero user-facing regression.
- Every mutation that writes a system note (`type: "UPDATE"`) also calls `recordEvent(...)` inside the same Prisma transaction.
- Reports are pure Prisma queries against indexed `ActivityEvent` columns — no view, no regex, no content parsing, no raw SQL except one `LEAD()` window function.
- Tracking starts at deploy — we do **not** backfill historical data. The activity feed still shows pre-rollout history; reports only show post-rollout.

The downstream reporting UI (routes, `<TimeframePicker>`, `<FilterBar>`, tables, Tremor charts, CSV export) is **not in this PR**. That is the next plan — see `CONTEXT-activity-event-next.md`.

---

## 2. Status

**Plan:** approved (`/home/donkoko/.claude/plans/logical-stirring-brooks.md` on the author's machine; the text is included verbatim in `remote-plan-extracted.md` with three adjustments the approver added: no migrations by Claude, rule files in `.claude/rules/`, UI as a follow-up).

**Phases 1–12 from the plan are complete.** Specifically:

| Step | Status | Notes |
|---|---|---|
| 1. Schema edit | ✅ | `packages/database/prisma/schema.prisma` |
| 2. Rule files in `.claude/rules/` | ✅ | Two files — `use-record-event.md`, `record-event-payload-shapes.md` |
| 3. **User ran migration** | ✅ | `pnpm db:prepare-migration --name add_activity_event` + `pnpm db:deploy-migration` |
| 4. User confirmed migration done | ✅ | |
| 5. `activity-event` module — types + service + tests | ✅ | `apps/webapp/app/modules/activity-event/` |
| 6. Reports module + tests | ✅ | 4 initial report helpers |
| 7. Wire asset module | ✅ | All asset-scoped `ActivityAction` values covered |
| 8. Wire kit + custody routes | ✅ | 4 custody routes + kit service + kit-assignment flows |
| 9. Wire booking service | ✅ | Centralised via `createStatusTransitionNote` helper + semantic events at checkout/checkin/partial/cancel/archive |
| 10. Wire audit service + helpers | ✅ | All 12 audit actions covered |
| 11. Wire location / scan | ✅ (location) / ⏭️ (scan — intentional skip; see integration map) | |
| 12. `pnpm webapp:validate` | partial — see "Tests" below | |

### Build / lint / typecheck

- `pnpm exec tsc --noEmit --project tsconfig.json` — **clean for all files touched by this PR.** (There are pre-existing errors in `app/modules/user/service.server.test.ts` from an MSW version drift, unrelated to this work.)
- `pnpm --filter @shelf/webapp lint` — **clean.** Five initial import-order errors were auto-fixed via `lint:fix` during development.
- Formatter (Prettier) runs on every edit via the worktree's `.claude/settings.json` PostToolUse hook — so all files are pre-formatted.

### Tests

- Two new test files:
  - `apps/webapp/app/modules/activity-event/service.server.test.ts` — covers `recordEvent` / `recordEvents` happy paths, `actorSnapshot` resolution precedence, tx client passthrough, caching actor lookups in bulk writes, error-wrapping with label `"Activity"`.
  - `apps/webapp/app/modules/activity-event/reports.server.test.ts` — covers all four report helpers with mocked Prisma.
- **Known pre-existing test-env issue:** Vitest fails to load any test file in this branch (including tests that existed before this PR) because `test/mocks/handlers.ts` uses an `msw` API that isn't in the installed version (`http.post` is `undefined`). Every test run errors out with `TypeError: Cannot read properties of undefined (reading 'post')`. **This is not caused by this PR** — verified by running an unmodified existing test. Fix is an `msw` version bump or API migration; suggest doing that in a separate PR so this one stays focused.

### Database state

Migration `add_activity_event` is applied on the author's local dev database and the Prisma client is regenerated. **Anyone pulling this branch must re-run `pnpm db:deploy-migration` on their local DB** before the code will run, because the generated Prisma client types reference the new `ActivityEvent` model / enums.

---

## 3. Shape of the change, at a glance

### New files

```
.claude/rules/
├── use-record-event.md                               ← core rule (call it, in-tx, with actor)
└── record-event-payload-shapes.md                    ← per-field + per-array-item rule

apps/webapp/app/modules/activity-event/
├── types.ts                                          ← ActivityEventInput discriminated union
├── service.server.ts                                 ← recordEvent, recordEvents
├── service.server.test.ts
├── reports.server.ts                                 ← 4 report helpers
└── reports.server.test.ts

CONTEXT-activity-event.md                             ← this file
CONTEXT-activity-event-architecture.md
CONTEXT-activity-event-integration.md
CONTEXT-activity-event-next.md
```

### Modified files

```
packages/database/prisma/schema.prisma                ← +ActivityEvent model, +2 enums, +Organization relation
apps/webapp/app/utils/error.ts                        ← +"Activity" in ErrorLabel union

apps/webapp/app/modules/asset/service.server.ts
apps/webapp/app/modules/kit/service.server.ts
apps/webapp/app/modules/booking/service.server.ts
apps/webapp/app/modules/audit/service.server.ts
apps/webapp/app/modules/location/service.server.ts

apps/webapp/app/routes/_layout+/
├── assets.$assetId.overview.assign-custody.tsx
├── assets.$assetId.overview.release-custody.tsx
└── kits.$kitId.assets.assign-custody.tsx
```

(`kits.$kitId.assets.release-custody.tsx` was **not** modified at the route level because it delegates to `kit/service.server.ts:releaseCustody`, which is instrumented there.)

---

## 4. How to read the existing code

If your Claude is diving in, the recommended reading order is:

1. **`packages/database/prisma/schema.prisma`** — search for `model ActivityEvent`. Read the model + `ActivityEntity` + `ActivityAction` enums at the bottom of the file.
2. **`apps/webapp/app/modules/activity-event/types.ts`** — the discriminated union `ActivityEventInput`. This is the compile-time contract.
3. **`apps/webapp/app/modules/activity-event/service.server.ts`** — `recordEvent`, `recordEvents`, `resolveActorSnapshot`, `toPrismaData`. Small file, read end-to-end.
4. **`.claude/rules/use-record-event.md`** + **`record-event-payload-shapes.md`** — the two rules. Both short. They're auto-discovered by Claude Code via their `globs` frontmatter — your colleague's Claude will pick them up when editing files under `apps/webapp/app/modules/**`.
5. **One example call site** — e.g., `apps/webapp/app/modules/booking/service.server.ts` → search for `recordEvent(` to see the pattern in action, especially inside `createStatusTransitionNote` and `checkoutBooking`.
6. **`apps/webapp/app/modules/activity-event/reports.server.ts`** — how queries look.

Then `CONTEXT-activity-event-integration.md` is the exhaustive "what's wired where" map — use it when wondering whether a specific mutation path emits an event, or when adding a new event for an existing action.

---

## 5. How to verify it's working (manual)

On a local dev DB with the migration applied:

### a) ASSET_CREATED on new asset

```bash
pnpm webapp:dev
```

Create a new asset via the UI (`/assets/new`). Then:

```sql
SELECT id, action, "entityId", "actorSnapshot", "occurredAt"
FROM "ActivityEvent"
ORDER BY "occurredAt" DESC
LIMIT 5;
```

You should see an `ASSET_CREATED` row for that asset, with `actorSnapshot` populated (`{firstName, lastName, displayName}`).

### b) Field-change events on asset edit

Edit the asset's name, description, valuation, and category in a single save. You should get **four separate events** (one per changed field), each with `field`, `fromValue`, `toValue` set. Unchanged fields produce no events.

### c) Booking status transitions

Walk a booking through `DRAFT → RESERVED → ONGOING → COMPLETE`. You should see:
- 3 × `BOOKING_STATUS_CHANGED` rows (one per transition, with the new status in `toValue`)
- 1 × `BOOKING_CHECKED_OUT` row per asset in the booking
- 1 × `BOOKING_CHECKED_IN` row per asset in the booking

### d) Transactional atomicity

Provoke a mid-transaction failure (easiest: temporarily throw inside a `$transaction` callback in a dev branch). Confirm that neither the note nor the event row is persisted — both roll back together.

### e) Reports smoke test

In a REPL or test file:

```ts
import { bookingStatusTransitionCounts, auditCompletionStats }
  from "~/modules/activity-event/reports.server";

await bookingStatusTransitionCounts({
  organizationId: "<org-id>",
  from: new Date("2026-01-01"),
  to: new Date(),
});
// → [{ toStatus: "ONGOING", count: 4 }, { toStatus: "COMPLETE", count: 2 }, ...]
```

### f) Activity feed UI unchanged

Navigate to any asset's activity tab. The feed should render identically to before — it still reads from the `Note` table. If anything looks different, that's a regression.

---

## 6. What to watch for in code review

Apart from the usual things, pay attention to:

1. **`organizationId` is always passed to `recordEvent`.** The type enforces it, but reviewers should spot-check that the right org-id is threaded in.
2. **`tx` is passed whenever the mutation runs in a transaction.** The rule file flags this, but it's easy to miss at a call site that calls `recordEvent` from outside the `$transaction` closure. If you see a `recordEvent` call after a `$transaction(...)` block rather than inside it, ask whether that's intentional.
3. **Per-field granularity for `*_CHANGED` actions.** One event per changed field, not an umbrella "updated" event. (See `record-event-payload-shapes.md`.)
4. **Array changes use `_ADDED` / `_REMOVED` per item.** Not a single event with the whole array in `toValue`.
5. **`entityType` + `entityId` convention.** For custody events, entity is `ASSET`; the custodian goes in `teamMemberId` and `targetUserId`. For booking asset events, entity is `BOOKING` and the asset goes in `assetId`.

A reviewer who wants to audit systematically can `grep -nE 'recordEvent\(|recordEvents\(' apps/webapp/app/modules apps/webapp/app/routes` to enumerate every call site (expect ~25 sites).

---

## 7. Conventions the colleague's Claude should already get from the rule files

The two rule files in `.claude/rules/` cover the main things and they're auto-discovered:

- `use-record-event.md` — every state-changing mutation calls `recordEvent` inside the same tx.
- `record-event-payload-shapes.md` — one event per changed field / per array item, never aggregate.

Beyond the rules, the architectural conventions (entityType/entityId choice, action naming policy, actor snapshot semantics) are documented in JSDoc on `recordEvent` and the `ActivityEventInput` discriminated union in `types.ts`. Anything not obvious from code is in `CONTEXT-activity-event-architecture.md`.

---

## 8. Branch + PR context

- Branch: `feat-reporting` (worktree at `shelf.nu/.worktrees/feat-reporting`)
- Forks off: `main`
- Related unmerged branch: `feat-quantities` — this is where `.claude/rules/` was first introduced (with `use-badge-colors.md` and `self-improve-rules.md`). This PR follows the format that branch established. If both PRs land, there is no conflict: the `.claude/rules/` directory accumulates files, no rule overlaps.
- The author's personal Claude is enabling `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` via `.claude/settings.json` — this is fine to keep; it doesn't affect runtime behavior.
- `.claude/settings.json` also has a Prettier PostToolUse hook — be aware it runs on every Edit/Write. Files will be reformatted automatically after agent edits.

---

## 9. Quick handoff checklist for the colleague

Before the colleague's Claude starts work:

- [ ] Pull branch `feat-reporting`
- [ ] `pnpm install`
- [ ] `pnpm db:deploy-migration` (applies the pending `add_activity_event` migration + regenerates Prisma client)
- [ ] `pnpm exec tsc --noEmit --project apps/webapp/tsconfig.json` to confirm clean typecheck
- [ ] Read `CONTEXT-activity-event-architecture.md` (for the "why")
- [ ] Read `CONTEXT-activity-event-integration.md` (for the "where")
- [ ] Skim `.claude/rules/use-record-event.md` and `record-event-payload-shapes.md` (for the "how")
- [ ] If starting the UI follow-up, read `CONTEXT-activity-event-next.md`
