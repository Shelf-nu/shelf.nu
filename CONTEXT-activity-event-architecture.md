# Context: Activity Event Architecture

> Companion to `CONTEXT-activity-event.md`. This file explains the design — schema, types, service, reports, conventions, and the decisions behind them. If you're extending the system or trying to understand why it looks the way it does, start here.

---

## 1. The `ActivityEvent` table

Defined in `packages/database/prisma/schema.prisma`. Full shape:

```prisma
model ActivityEvent {
  id             String   @id @default(cuid())
  organizationId String
  occurredAt     DateTime @default(now()) @db.Timestamptz(3)

  // Who
  actorUserId   String?
  actorSnapshot Json?    // { firstName, lastName, displayName } captured at write time

  // What
  action     ActivityAction
  entityType ActivityEntity
  entityId   String

  // Sparse cross-refs — populate whichever apply to the event.
  assetId        String?
  bookingId      String?
  auditSessionId String?
  auditAssetId   String?
  kitId          String?
  locationId     String?
  teamMemberId   String?
  targetUserId   String?

  // Typed field-change payload (*_CHANGED actions)
  field     String?
  fromValue Json?
  toValue   Json?

  // Action-specific extras (e.g. { isExpected } for AUDIT_ASSET_SCANNED).
  meta Json?

  organization Organization @relation(
    fields: [organizationId],
    references: [id],
    onDelete: Cascade,
    onUpdate: Cascade,
  )

  @@index([organizationId, occurredAt])
  @@index([organizationId, action, occurredAt])
  @@index([organizationId, entityType, entityId, occurredAt])
  @@index([actorUserId, occurredAt])
  @@index([assetId, occurredAt])
  @@index([bookingId, occurredAt])
  @@index([auditSessionId, occurredAt])
}
```

### Why these columns

- **`organizationId`** — every row is org-scoped. All report queries filter on it.
- **`occurredAt` with `Timestamptz(3)`** — matches the precision Shelf uses for `Booking.from`/`.to` — 3 ms — so interval math compares apples to apples.
- **`actorUserId` + `actorSnapshot`** — two columns on purpose. The FK is there for joining, the JSON snapshot is there so that **user rename or soft-delete cannot rewrite history**. Historical reports always render as the name that was current at write time.
- **`action` + `entityType` + `entityId`** — the discriminator and subject. `entityType` is the primary entity the event is "about" (e.g., `ASSET` for custody events, `BOOKING` for booking-lifecycle events), and `entityId` is that entity's ID. This matches the activity-feed mental model where each event has a "lives on" entity.
- **Sparse cross-refs (`assetId`, `bookingId`, ...)** — no relation blocks on purpose. If we added `@relation`, the `onDelete` cascade semantics would leak from source entities into the event log. The events are append-only history and should survive source deletions.
- **`field` + `fromValue` + `toValue`** — the typed change payload used only by `*_CHANGED` actions. Primitives are stored as JSON scalars (`"New name"`, `150`, etc.) — Postgres can extract them with `#>> '{}'` for aggregation.
- **`meta` (JSON)** — the overflow bucket for action-specific data that doesn't fit into fixed columns. Examples in code: `{ isExpected }` for `AUDIT_ASSET_SCANNED`, `{ expectedCount, foundCount, missingCount, unexpectedCount }` for `AUDIT_COMPLETED`, `{ viaKit: true }` for kit-originated custody events.

### Why these indexes

Reports queried in `apps/webapp/app/modules/activity-event/reports.server.ts` hit one of:
- `(organizationId, occurredAt)` — generic recent-events feed
- `(organizationId, action, occurredAt)` — "all `BOOKING_STATUS_CHANGED` in last 30d"
- `(organizationId, entityType, entityId, occurredAt)` — "all events on this audit"
- `(assetId, occurredAt)` — asset change history
- `(bookingId, occurredAt)` — booking timeline
- `(auditSessionId, occurredAt)` — audit timeline
- `(actorUserId, occurredAt)` — user activity

Every index includes `occurredAt` as the last column so range scans are cheap. Indexes were kept tight (7 total) — more can be added as new reports appear, but don't pre-optimize.

### Two enums

**`ActivityEntity`** — `ASSET`, `BOOKING`, `AUDIT`, `KIT`, `LOCATION`, `TEAM_MEMBER`, `CUSTODY`, `USER`, `ORGANIZATION`. Identifies what the event is "about".

**`ActivityAction`** — ~40 values, grouped:
- Asset (12): `ASSET_CREATED`, `*_CHANGED` for 8 fields, `_ARCHIVED`, `_DELETED`
- Custody (2): `CUSTODY_ASSIGNED`, `CUSTODY_RELEASED`
- Booking (10): `_CREATED`, `_STATUS_CHANGED`, `_DATES_CHANGED`, `_ASSETS_ADDED/REMOVED`, `_CHECKED_OUT/IN`, `_PARTIAL_CHECKIN`, `_CANCELLED`, `_ARCHIVED`
- Audit (13): `_CREATED`, `_STARTED`, `_ASSETS_ADDED/REMOVED`, `_ASSET_SCANNED`, `_ASSET_SCAN_REMOVED`, `_DUE_DATE_CHANGED`, `_ASSIGNEE_ADDED/REMOVED`, `_UPDATED`, `_COMPLETED`, `_CANCELLED`, `_ARCHIVED`
- Location (2): `LOCATION_CREATED`, `LOCATION_UPDATED`
- Kit (2): `KIT_CREATED`, `KIT_UPDATED`

Some values are defined in the enum but not yet emitted by any call site (e.g. `ASSET_STATUS_CHANGED` via a non-custody path, `BOOKING_DATES_CHANGED`, `AUDIT_DUE_DATE_CHANGED`, `AUDIT_ASSIGNEE_ADDED/REMOVED`, `ASSET_ARCHIVED`). These were defined ahead of time so that adding the emission later is a one-line `recordEvent(...)` call, no schema migration. The integration map in the companion file marks each as wired / not-wired.

### Additive-only policy

**Never rename or remove an enum value.** Historical events keep their original action name forever, and changing it would silently break reports that filter on it. To "rename", add a new value and leave the old in place (queries can `action: { in: [OLD, NEW] }`). Adding new values requires a schema migration.

---

## 2. The module layout

```
apps/webapp/app/modules/activity-event/
├── types.ts                   // public input types (union)
├── service.server.ts          // recordEvent, recordEvents
├── service.server.test.ts
├── reports.server.ts          // read helpers (pure Prisma queries)
└── reports.server.test.ts
```

Follows Shelf's standard module convention (cf. `modules/asset/`, `modules/booking/`, etc.). No routes, no UI — reports are consumed by the future reporting UI (see `CONTEXT-activity-event-next.md`).

---

## 3. `ActivityEventInput` — the type system

`types.ts` defines a discriminated union keyed on `action`, so the TypeScript compiler forces callers to supply the right cross-refs and payload shape per action. This is the compile-time half of the security: the other two halves are the rule files (CI) and JSDoc (humans).

Four variants:

### `FieldChangeEventInput`

For `*_CHANGED` actions (name, description, valuation, status, tags, dates, etc.). **Requires** `field`, `fromValue`, `toValue`. The full list of actions is:

```ts
type FieldChangeAction =
  | "ASSET_NAME_CHANGED"
  | "ASSET_DESCRIPTION_CHANGED"
  | "ASSET_CATEGORY_CHANGED"
  | "ASSET_KIT_CHANGED"
  | "ASSET_LOCATION_CHANGED"
  | "ASSET_TAGS_CHANGED"
  | "ASSET_STATUS_CHANGED"
  | "ASSET_VALUATION_CHANGED"
  | "ASSET_CUSTOM_FIELD_CHANGED"
  | "BOOKING_STATUS_CHANGED"
  | "BOOKING_DATES_CHANGED"
  | "AUDIT_DUE_DATE_CHANGED";
```

### `CustodyEventInput`

For `CUSTODY_ASSIGNED` / `CUSTODY_RELEASED`. **Requires** `entityType: "ASSET"`, `entityId`, `assetId`. Custodian identity goes in `teamMemberId` (required — every custodian is a TeamMember) and optionally `targetUserId` (if the team member has a linked User).

**Convention decision:** entity is the *asset*, not the user. Rationale: the activity-feed mental model treats a custody event as something that happened *to the asset*. Reports like "recent activity on asset X" pick this up via `assetId` index; reports like "user X's custody history" pick it up via `targetUserId`.

### `BookingAssetItemEventInput`

For `BOOKING_ASSETS_ADDED` / `BOOKING_ASSETS_REMOVED`. **Requires** `entityType: "BOOKING"`, `entityId`, `bookingId`, `assetId`. One event per asset added/removed (never an umbrella event with an array in `meta`).

### `GenericEventInput`

Everything else. Only requires the base shape: `organizationId`, `action`, `entityType`, `entityId`. Cross-refs are optional.

### The base shape

```ts
type BaseEventInput = {
  organizationId: string;
  actorUserId?: string | null;
  actorSnapshot?: ActorSnapshot | null;  // pre-supplied; else resolved
  occurredAt?: Date;                      // override now()
  assetId?: string;
  bookingId?: string;
  auditSessionId?: string;
  auditAssetId?: string;
  kitId?: string;
  locationId?: string;
  teamMemberId?: string;
  targetUserId?: string;
  meta?: Prisma.InputJsonValue;
};
```

### Adding a new action

1. Add the enum value in `schema.prisma` (inside `ActivityAction`).
2. Run migration (user runs, per convention: `pnpm db:prepare-migration --name add_X_action`).
3. Classify it:
   - If it's a `*_CHANGED` field action → add to `FieldChangeAction` in `types.ts`.
   - If it's a custody variant → extend `CustodyEventInput`.
   - If it's a booking-asset event → extend `BookingAssetItemEventInput`.
   - Otherwise it falls through to `GenericEventInput` — no type change needed.
4. Call `recordEvent({ action: "NEW_ACTION", ... })` from the mutation site(s).

The compiler tells you if you got the payload shape wrong.

---

## 4. `recordEvent` and `recordEvents`

Defined in `service.server.ts`. Small file — worth reading end-to-end.

### Public signatures

```ts
export async function recordEvent(
  input: ActivityEventInput,
  tx?: RecordEventTxClient,
): Promise<void>;

export async function recordEvents(
  inputs: ActivityEventInput[],
  tx?: RecordEventTxClient,
): Promise<void>;
```

### Why `tx` is optional but strongly advised

Every integration point already either runs inside `db.$transaction(...)` or not. When a caller is inside a transaction and doesn't pass `tx`, the event writes to the top-level `db` and **will be orphaned if the transaction rolls back** — producing an event row for a mutation that never committed. That's a data-integrity bug.

The rule file `use-record-event.md` makes this explicit with a ❌ Bad / ✅ Good pair and the Claude agents in the repo enforce it via that rule. Reviewers should too.

We did not make `tx` required because:
- Not every mutation runs in a transaction (e.g., simple `db.kit.update` with a downstream note).
- Forcing an unused `tx` makes the API awkward and encourages fake wrappers.
- Review + the rule + the ❌ Bad example is the right ergonomic balance.

### `RecordEventTxClient` — the structural type

```ts
export type RecordEventTxClient = {
  activityEvent: {
    create: (args: {
      data: Prisma.ActivityEventUncheckedCreateInput;
    }) => Promise<unknown>;
  };
  user: {
    findUnique: (args: {
      where: { id: string };
      select: { firstName: true; lastName: true; displayName: true };
    }) => Promise<{
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
    } | null>;
  };
};
```

This is typed structurally instead of as `Prisma.TransactionClient` because the actual runtime types (`ExtendedPrismaClient` from `@shelf/database`, and the tx client derived from it via Prisma's `$extends`) don't directly assign to the vanilla `Prisma.TransactionClient` type. A structural type accepts both without the caller needing a cast.

### `actorSnapshot` resolution

Resolution order in `resolveActorSnapshot`:

1. **Caller supplied it** (`input.actorSnapshot`) — used verbatim. Useful when the caller already fetched the user for a note, avoids a second DB hit.
2. **No actor at all** (`input.actorUserId` is `null` / `undefined`) — snapshot is `null`, it's a system event.
3. **Actor exists, no snapshot supplied** — fetch the user: `firstName`, `lastName`, `displayName`. If the user isn't found, snapshot stays `null` but `actorUserId` is still written (handles the "user deleted between write and read" race).

In `recordEvents`, snapshots are memoized per `actorUserId` via a `Map`, so bulk writes with the same actor fetch the user exactly once. This avoids 50 duplicate lookups when checking out a booking with 50 assets.

### Error handling

Any DB failure inside `recordEvent` or `recordEvents` throws `ShelfError` with `label: "Activity"`:

```ts
throw new ShelfError({
  cause,
  label: "Activity",
  message: "Failed to record activity event.",
  additionalData: { action, organizationId, entityId },
});
```

`"Activity"` was added to the `ErrorLabel` union in `apps/webapp/app/utils/error.ts` as part of this PR. Using an accurate label keeps the Sentry / log dashboards clean (previously the closest label would have been `"Report"`, which is semantically wrong — event writes aren't reporting).

### What `toPrismaData` does

It builds the Prisma `create` payload from the input union. Since the union narrows `field`/`fromValue`/`toValue` to field-change variants, we use `"field" in input` checks to extract them safely. Undefineds are mapped to `undefined` (lets Prisma apply column default) or `null` (explicit null value for the column) depending on the semantic — `organizationId` needs to be a value, `occurredAt` should default, JSON columns tolerate either.

---

## 5. Reports module

`reports.server.ts` exports four initial helpers:

```ts
assetChangeHistory({ organizationId, assetId, from, to })
  → ReportEvent[]

bookingStatusTransitionCounts({ organizationId, from, to })
  → { toStatus: string; count: number }[]

auditCompletionStats({ organizationId, from, to })
  → AuditCompletionRow[]  // meta contains expected/found/missing/unexpected

custodyDurationsByAsset({ organizationId, from, to })
  → CustodyWindow[]  // pairs CUSTODY_ASSIGNED with CUSTODY_RELEASED via LEAD()
```

Every helper:
- Takes `organizationId` and a `{ from, to }` window.
- Uses Prisma's typed query API where possible.
- Falls back to `$queryRaw` with tagged templates only when Prisma's API can't express the query:
  - `bookingStatusTransitionCounts` uses a raw groupBy because Prisma's typed `groupBy` doesn't accept JSON columns (the `toValue` JSON scalar is extracted with `#>> '{}'`).
  - `custodyDurationsByAsset` uses a raw window function (`LEAD(...)` over `PARTITION BY assetId`) because Prisma has no native window-function support.
- Wraps any DB error in `ShelfError` with `label: "Activity"` and the helper name in `additionalData`.

**No helper does auth or permission checks.** The consuming route/loader is responsible for calling `requirePermission(...)` before invoking a report helper — the helpers are pure query functions. This matches the separation in Shelf's existing service modules.

### Coverage

The four helpers are **starter examples**, not the full catalog. The prior Reporting v2 plan listed ten reports (R1–R10); most of them become one-liner `findMany` / `groupBy` against `ActivityEvent`. Adding new helpers is cheap. See `CONTEXT-activity-event-next.md` for the mapping between the ten reports and what they'd need.

---

## 6. Activity rule files

`.claude/rules/use-record-event.md` and `.claude/rules/record-event-payload-shapes.md` follow the format established on the `feat-quantities` branch (`use-badge-colors.md`, `self-improve-rules.md`):

- YAML frontmatter with `description` + `globs`
- Under 30 lines each
- One rule per concept
- ❌ Bad / ✅ Good code example
- Auto-discovered by Claude Code based on the `globs` pattern

Both rules together cover:

1. Every state-changing mutation calls `recordEvent` inside the same tx as the mutation.
2. One event per changed field (`*_CHANGED`); one event per array item (`_ADDED` / `_REMOVED`). Never aggregate.

Other conventions (action naming, entityType choice, actor snapshot) live in JSDoc on the module rather than in rules, to keep rules scannable.

---

## 7. Decisions and tradeoffs

These are the non-obvious choices. Each has a reason.

### Dual-write (notes + events) instead of replacing notes

Both notes and events are written for every tracked mutation. Notes remain the source of truth for the existing activity feed UI; events become the source of truth for reports.

**Why:** zero user-facing regression risk at rollout. The note path is battle-tested, the event path is brand new. If events have a bug, the UI still works. A later PR (after feed parity is demonstrated) can migrate the feed to render from events and retire the UPDATE notes.

### No historical backfill

`occurredAt >= deployment_time` is the contract. Old notes are not converted to events.

**Why:**
- The user explicitly decided this — structured tracking starts now.
- Backfilling historical notes would require running the same regex parser we were rejecting, and inheriting its accuracy issues.
- The activity-feed UI still shows historical notes, so users see full history.
- Reports show the start-tracking-at date in the UI when they ship.

### No relation blocks on cross-refs

`assetId`, `bookingId`, etc. are plain `String?` FKs without `@relation(...)`.

**Why:** events are append-only history. We don't want source-entity cascades (e.g., `Asset` deletion setting `assetId` to null or deleting the event row) to leak into the log. If an asset is deleted, its events remain with the original `assetId` — a deliberate choice. Queries that need to join can do so explicitly.

### Structural `RecordEventTxClient` type

Explained above. Summary: Prisma's extended client and TransactionClient don't directly assign to each other, so a narrow structural type accepts both.

### `"Activity"` as a new ErrorLabel value

Not reusing `"Report"`.

**Why:** event writes are *not* reporting failures — they fail during a mutation, not during a query. Putting them under `"Report"` would pollute that bucket in Sentry / log dashboards. Adding a new label is one line in the union and gives clean observability.

### Centralised BOOKING_STATUS_CHANGED via `createStatusTransitionNote`

Instead of adding `recordEvent` to every status-transition call site in `booking/service.server.ts` (there are ~12 of them), we instrumented the central `createStatusTransitionNote` helper at `apps/webapp/app/modules/booking/service.server.ts:208`. Every caller of that helper gets the event for free.

**Why:** DRY. The helper is already a single point of truth for "a booking status changed" — reusing it is an existing pattern, not a new one.

**Tradeoff:** the emission is coupled to the note-writing helper. If a future path ever wants to change status without emitting a note, it would need to bypass both, which is intentional — status changes without notes would also break the activity feed UI, so they shouldn't happen anyway.

### Semantic booking events (CHECKED_OUT, CHECKED_IN, PARTIAL_CHECKIN, CANCELLED, ARCHIVED) in addition to BOOKING_STATUS_CHANGED

Both are emitted. The former is one-event-per-asset; the latter is one-event-per-transition.

**Why:** reports benefit from both.
- "How many status transitions to ONGOING last month?" → `BOOKING_STATUS_CHANGED` groupBy.
- "How many check-ins per asset last month?" → `BOOKING_CHECKED_IN` groupBy by assetId.
- "When was asset X last checked out?" → `BOOKING_CHECKED_OUT` max(occurredAt) filter by assetId.

The latter is much cleaner than deriving asset-level timing from booking-level status transitions and joining on `_AssetToBooking`.

**Tradeoff:** two events per transition instead of one. For a 50-asset booking, this is 51 rows on checkout (1 status + 50 asset). At Shelf's scale (300 orgs, modest booking volume), storage cost is negligible; query cost is lower because reports can filter on the exact action needed.

### Per-field events for `*_CHANGED`

One event per changed field (not an umbrella "ASSET_UPDATED" with all deltas in meta).

**Why:** reports like "how often does valuation change?" need to `COUNT` / `GROUP BY` on the action. Aggregate events require unpacking JSON in every query.

**Tradeoff:** an asset edit that touches 3 fields produces 3 events. Again, cost is negligible; aggregation benefit is large.

### One event per array item (`_ADDED` / `_REMOVED`)

For `BOOKING_ASSETS_ADDED`, `BOOKING_ASSETS_REMOVED`, `ASSET_KIT_CHANGED` etc.

**Why:** same reasoning — per-item events let `groupBy` / `count` work directly. Arrays in `toValue` force JSON parsing in every query.

**Tradeoff:** high write amplification on bulk ops (e.g., adding 200 assets to a booking → 200 events). Mitigated by `recordEvents(...)` which does the multi-insert in a single loop inside the same tx. At realistic operation sizes this is fine.

### Custom field changes go through `ASSET_CUSTOM_FIELD_CHANGED` with `field` holding the custom-field name

Per-field still, but `field` is the custom field's name rather than a schema column. `meta.isFirstTimeSet` is populated.

**Why:** reports that ask "how often did users change the Asset Tag Number custom field last quarter?" work out of the box with `action = 'ASSET_CUSTOM_FIELD_CHANGED' AND field = 'Asset Tag Number'`.

### JSON shape for `fromValue` / `toValue`

Primitives are stored as JSON scalars. Object refs (e.g. a category) are stored as the ID string, not the full object. Arrays are stored as arrays of IDs.

**Why:** minimises row size, keeps the column queryable, and decouples the event log from source-entity shape changes. A consumer that needs the current name of a former category can look it up.

### `organization.activityEvents` back-relation on Organization

Prisma-only (no FK change on DB side). Lets us write `organization.activityEvents.findMany(...)` if we ever want.

**Why:** free, idiomatic Prisma pattern. No cost.

---

## 8. What's NOT in this module

- No routes, loaders, or actions — the module is service-layer only.
- No UI components — those come in the reporting UI PR.
- No CSV export — same.
- No scheduled jobs — the system is pull-based (reports query on demand).
- No background worker integrations — events are emitted synchronously inside the originating transaction.

See `CONTEXT-activity-event-next.md` for the roadmap.

---

## 9. Troubleshooting reference

### "Type X is not assignable to PrismaLike"

If you hit this in your own code calling `recordEvent`, don't cast — the structural type should accept any Prisma client or tx. If you see it, the issue is usually a different problem (e.g., passing the wrong variable name). If you're sure the object is a Prisma client, the structural type can be widened — update `RecordEventTxClient` in `service.server.ts`.

### "Property 'activityEvent' does not exist on type 'ExtendedPrismaClient'"

Prisma client hasn't been regenerated after the migration. Run `pnpm db:generate` (or `pnpm db:deploy-migration` if you also need to apply migrations).

### "Enum value 'X' does not exist"

Same — client out of sync with schema. Regenerate.

### Event rows appearing without `actorSnapshot`

Either the caller is a system context (no `actorUserId`), or the `User.findUnique` for that id returned `null` (user deleted). Both are intended behaviors.

### Wrong `entityType` on an event

Likely a convention slip. The rule: `entityType` is the entity the event is primarily about, matching what the activity-feed UI would show it under. Custody events are `ASSET` (the asset is the subject; the custodian is in `targetUserId`). Booking events are `BOOKING`. Audit events are `AUDIT`. The discriminated union narrows this for the two specific cases (custody + booking asset items), so TypeScript will catch most mistakes at compile time.
