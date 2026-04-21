# Context: Activity Event — Integration Map

> Companion to `CONTEXT-activity-event.md`. This file is the source of truth for **where events are emitted and what's deliberately not wired**. If you're wondering whether a specific mutation path produces an event, look it up here.
>
> Line numbers are approximate and may drift with future edits. When you need precision, `grep -nE 'recordEvent\(|recordEvents\(' <file>` is authoritative.

---

## 1. Summary — every integration point

| Module / file | Events emitted | Transactional |
|---|---|---|
| `modules/asset/service.server.ts` | `ASSET_CREATED`, `ASSET_NAME/DESCRIPTION/CATEGORY/VALUATION_CHANGED`, `ASSET_LOCATION_CHANGED`, `ASSET_TAGS_CHANGED`, `ASSET_CUSTOM_FIELD_CHANGED`, `ASSET_DELETED`, `CUSTODY_ASSIGNED` / `CUSTODY_RELEASED` | Partially (bulk paths use `tx`) |
| `modules/kit/service.server.ts` | `KIT_CREATED`, `KIT_UPDATED`, `CUSTODY_ASSIGNED` / `CUSTODY_RELEASED` (via kit assignment), `ASSET_KIT_CHANGED` | Yes for custody flows |
| `modules/booking/service.server.ts` | `BOOKING_CREATED`, `BOOKING_ASSETS_ADDED` / `_REMOVED`, `BOOKING_STATUS_CHANGED` (centralised), `BOOKING_CHECKED_OUT`, `BOOKING_CHECKED_IN`, `BOOKING_PARTIAL_CHECKIN`, `BOOKING_CANCELLED`, `BOOKING_ARCHIVED` | Yes for status transitions + partial checkin |
| `modules/audit/service.server.ts` | `AUDIT_CREATED`, `AUDIT_STARTED`, `AUDIT_ASSET_SCANNED`, `AUDIT_COMPLETED`, `AUDIT_CANCELLED`, `AUDIT_ASSETS_ADDED` / `_REMOVED`, `AUDIT_ARCHIVED` | Yes |
| `modules/location/service.server.ts` | `LOCATION_CREATED`, `LOCATION_UPDATED`, `ASSET_LOCATION_CHANGED` (bulk via `updateLocationAssets`) | No (follows existing pattern) |
| `routes/_layout+/assets.$assetId.overview.assign-custody.tsx` | `CUSTODY_ASSIGNED` | No (post-tx) |
| `routes/_layout+/assets.$assetId.overview.release-custody.tsx` | `CUSTODY_RELEASED` | No (post-tx) |
| `routes/_layout+/kits.$kitId.assets.assign-custody.tsx` | `CUSTODY_ASSIGNED` per asset in kit | No |

~ 25 call sites total across these files.

---

## 2. `modules/asset/service.server.ts`

### `createAsset`

Every new asset emits `ASSET_CREATED` after the `db.asset.create` call, outside any transaction (the create itself is not transactional).

```ts
// Search for: "ASSET_CREATED" in asset/service.server.ts
await recordEvent({
  organizationId,
  actorUserId: userId,
  action: "ASSET_CREATED",
  entityType: "ASSET",
  entityId: asset.id,
  assetId: asset.id,
});
```

Called by: every asset-creation flow (UI form, content import via `createAssetsFromContentImport` — which internally calls `createAsset`, so no separate wiring needed there).

### `updateAsset`

Per-field `*_CHANGED` events are emitted as a batched `recordEvents([...])` call after the note-writing `Promise.all`. Events only fire for fields that *actually changed*:

- `ASSET_NAME_CHANGED` — when `before.title !== after.title`
- `ASSET_DESCRIPTION_CHANGED` — when description differs (null-normalized with `?? null`)
- `ASSET_CATEGORY_CHANGED` — when `category.id` differs
- `ASSET_VALUATION_CHANGED` — when valuation differs

Each event carries `field`, `fromValue`, `toValue`. The valuation uses the raw numeric (not currency-formatted); the category uses the id (not the name).

### `updateAsset` — location change branch

When `isChangingLocation` is true and the location changed:

```ts
// Search for: "ASSET_LOCATION_CHANGED" at ~1475 in asset/service.server.ts
await recordEvent({ action: "ASSET_LOCATION_CHANGED", ... });
```

One event per single-asset location change. Bulk location changes are handled in `bulkUpdateAssetLocation` — see below.

### `updateAsset` — tag-change branch

Tag changes emit a single `ASSET_TAGS_CHANGED` event when the before/after tag-id sets differ:

```ts
// Uses set comparison to detect changes, then a single recordEvent with
// fromValue/toValue = full tag-id arrays.
```

**Note:** for tag changes we chose a single event with arrays (not per-item `_ADDED`/`_REMOVED`) because we don't have separate `TAG_ADDED`/`TAG_REMOVED` actions in the enum. This is one of the few places where an array goes into `toValue`. If we want per-item events for tags in the future, add the enum values first.

### `updateAsset` — custom fields

One `ASSET_CUSTOM_FIELD_CHANGED` per detected change:

```ts
// Search for: "ASSET_CUSTOM_FIELD_CHANGED"
await recordEvents(changes.map(change => ({
  action: "ASSET_CUSTOM_FIELD_CHANGED",
  field: change.customFieldName,  // the custom field's human-readable name
  fromValue: change.previousValue ?? null,
  toValue: change.newValue ?? null,
  meta: { isFirstTimeSet: change.isFirstTimeSet },
})));
```

### `deleteAsset`

Accepts a new optional `actorUserId` parameter. If provided, an `ASSET_DELETED` event fires after the delete. If not provided (e.g., a system-initiated delete), a system event is written with `actorUserId: null`.

**Caller impact:** existing callers don't pass `actorUserId` and thus produce system-authored delete events. If a caller wants attribution, they should supply it. Search the codebase for `deleteAsset(` to find callers if you want to update them.

### `createAssetsFromBackupImport`

Emits `ASSET_CREATED` once per imported asset with `meta: { source: "backup_import" }`. Notable: this runs **inside** the existing import `Promise.all(...)` map, so events are written per-asset as it's created.

The per-asset `db.note.createMany` that follows is **deliberately not event-emitting** — it's re-importing historical activity notes with their original `createdAt` timestamps. Those are historical activity, not new events. Re-emitting them would produce events dated "now" for activity that happened years ago.

### `createAssetsFromContentImport`

Calls `createAsset` internally, which emits `ASSET_CREATED`. No separate wiring needed.

### `bulkCheckOutAssets`

Emits one `CUSTODY_ASSIGNED` event per asset, **inside the `db.$transaction(tx => ...)` block**, alongside the existing `tx.note.createMany`. `teamMemberId` and optional `targetUserId` are populated.

### `bulkCheckInAssets`

Emits one `CUSTODY_RELEASED` event per asset, inside the tx, next to the note createMany.

### `bulkUpdateAssetLocation`

Emits one `ASSET_LOCATION_CHANGED` per asset whose location actually changed, inside the `db.$transaction(tx => ...)`. `fromValue` and `toValue` hold the previous/new `locationId` (nullable).

---

## 3. `modules/kit/service.server.ts`

### `createKit`

Emits `KIT_CREATED` after the `db.kit.create`. Outside transaction (create is not transactional in this function).

### `updateKit`

Emits `KIT_UPDATED` after the update. **Does not emit per-field events** — the plan treats kit updates as coarser-grained than asset updates. If per-field reporting on kits becomes necessary, add per-field events or new `KIT_*_CHANGED` action values.

### Kit-level bulk custody assign (inside bulk flow)

A `db.$transaction` assigns custody to multiple kits → cascades to all assets in those kits → writes custody notes on those assets via `tx.note.createMany`. We emit one `CUSTODY_ASSIGNED` per asset, inside the tx, with `kitId` populated and `meta: { viaKit: true }` to distinguish from direct custody.

### Kit-level bulk custody release

Mirror of the above — one `CUSTODY_RELEASED` per asset with `viaKit: true` in meta.

### `releaseCustody` (single kit)

Called by the `kits.$kitId.assets.release-custody.tsx` route. Service function emits one `CUSTODY_RELEASED` per asset in the kit after the note createMany (outside the tx — the existing note-write pattern is also outside the tx, so this matches).

### `updateKitAssets`

This is the add/remove assets to/from a kit flow. We emit `ASSET_KIT_CHANGED` per asset that actually changed:

- For each newly added asset: `fromValue: previousKitId (or null)`, `toValue: kit.id`
- For each removed asset (when not in addOnly mode): `fromValue: kit.id`, `toValue: null`

Plus downstream custody inheritance/release may fire CUSTODY events through `createNotes` calls that don't yet have recordEvent wiring — **see known gaps below**.

---

## 4. `modules/booking/service.server.ts`

### `createStatusTransitionNote` — the centralised emission point

Every booking status transition in the codebase goes through this helper (around line 208). We emit `BOOKING_STATUS_CHANGED` inside the helper, after the `createSystemBookingNote` call:

```ts
await recordEvent({
  organizationId,
  actorUserId: userId ?? null,
  action: "BOOKING_STATUS_CHANGED",
  entityType: "BOOKING",
  entityId: bookingId,
  bookingId,
  field: "status",
  fromValue: fromStatus,
  toValue: toStatus,
});
```

Call sites that benefit automatically: `reserveBooking`, `checkoutBooking`, `checkinBooking` (both explicit and partial-complete paths), `archiveBooking`, `cancelBooking`, `revertBookingToDraft`, overdue-handler paths, etc. ~12 callers total.

### `createBooking`

Emits:
- `BOOKING_CREATED` (one event, after the `db.booking.create`)
- `BOOKING_ASSETS_ADDED` per asset attached at creation (via `recordEvents`)

### `checkoutBooking`

After `createStatusTransitionNote` (which emits `BOOKING_STATUS_CHANGED`), emits one `BOOKING_CHECKED_OUT` per asset in `bookingFound.assets`. Not in a transaction — follows the existing post-tx note pattern.

### `checkinBooking`

After either the partial-completion note branch or the standard status-transition note, emits one `BOOKING_CHECKED_IN` per asset. Mirror of checkout.

### Partial check-in path (inside `checkinBooking` or the partial variant)

Emits one `BOOKING_PARTIAL_CHECKIN` per asset being partially checked in, **inside the existing `db.$transaction(tx => ...)` block** that also creates the `PartialBookingCheckin` row.

### `archiveBooking`

Emits `BOOKING_ARCHIVED` (single event) after `createStatusTransitionNote`. The status transition helper also emits `BOOKING_STATUS_CHANGED`, so both fire. This is intentional (see architecture file §7 "Semantic booking events" rationale).

### `cancelBooking`

Same pattern — `BOOKING_CANCELLED` semantic event plus the auto-emitted `BOOKING_STATUS_CHANGED`. `cancellationReason` goes into `meta` if supplied.

### `updateBookingAssets`

Emits one `BOOKING_ASSETS_ADDED` per newly-attached asset at the end of the flow. The `$transaction` here only handles the `_AssetToBooking` insert + status updates; note writes and events happen after the transaction commits (matching the existing pattern).

### `removeAssets`

Emits one `BOOKING_ASSETS_REMOVED` per asset detached. Same post-tx pattern.

### Not currently wired (future enhancements)

- `BOOKING_DATES_CHANGED` — the enum value exists; no emitter yet. The `updateBasicBooking` and related date-update paths don't emit it. Add this when a report needs it.
- Kit-level booking events — the booking service has logic for kits-in-bookings but doesn't emit separate kit events. Asset-level coverage is adequate for current reports.

---

## 5. `modules/audit/service.server.ts` + `helpers.server.ts`

### `createAuditSession`

Emits `AUDIT_CREATED` **inside the existing `db.$transaction(tx => ...)`** after the `createAuditCreationNote` helper. `meta: { expectedAssetCount: assets.length }`.

### `recordAuditScan` — first scan path

When the first scan of an audit happens and the session is promoted from PENDING to ACTIVE, we emit `AUDIT_STARTED` inside the transaction (alongside the existing `createAuditStartedNote` helper call).

### `recordAuditScan` — every scan

After the `createAssetScanNote` helper, emits `AUDIT_ASSET_SCANNED` inside the same transaction:

```ts
await recordEvent({
  organizationId,
  actorUserId: userId,
  action: "AUDIT_ASSET_SCANNED",
  entityType: "AUDIT",
  entityId: auditSessionId,
  auditSessionId,
  auditAssetId: auditAssetId ?? undefined,
  assetId,
  meta: { isExpected },
}, tx);
```

The `auditAssetId` is the specific `AuditAsset` row ID (not the `Asset` ID). `isExpected` differentiates expected-asset scans from unexpected-asset scans.

### `completeAuditSession`

Emits `AUDIT_COMPLETED` inside the transaction, after `createAuditCompletedNote`. **Meta contains the full counter set** consumed by `reports.auditCompletionStats`:

```ts
meta: {
  expectedCount,
  foundCount,
  missingCount,
  unexpectedCount,
}
```

This is the single most valuable event in the system for reporting — compliance / completion-rate / missing-rate reports all read from here.

### `cancelAuditSession`

Emits `AUDIT_CANCELLED` after the existing `auditNote.create`. Not in a transaction (the cancel flow doesn't use one).

### `archiveAuditSession`

Emits `AUDIT_ARCHIVED` inside the `db.$transaction(tx => ...)` that already updates status and writes the note.

### `bulkArchiveAudits`

Emits one `AUDIT_ARCHIVED` per archived audit inside the bulk transaction, with `meta: { bulk: true }` to distinguish from single-archive events.

### `addAssetsToAudit`

Emits one `AUDIT_ASSETS_ADDED` per asset added, inside the transaction.

### `removeAssetFromAudit` (single)

Emits one `AUDIT_ASSETS_REMOVED` inside the transaction.

### `removeAssetsFromAudit` (bulk)

Emits one `AUDIT_ASSETS_REMOVED` per audit-asset removed, inside the transaction.

### Not currently wired

- `AUDIT_UPDATED` — enum exists, no emitter. `updateAuditSession` doesn't emit yet. Add when a report needs it.
- `AUDIT_DUE_DATE_CHANGED` — similar. Would be a field-change variant.
- `AUDIT_ASSIGNEE_ADDED` / `AUDIT_ASSIGNEE_REMOVED` — assignment changes aren't yet emitted.
- `AUDIT_ASSET_SCAN_REMOVED` — the removal of a scan (different from removing an asset). No emitter yet.

---

## 6. `modules/location/service.server.ts`

### `createLocation`

Emits `LOCATION_CREATED` after the create.

### `updateLocation`

Emits `LOCATION_UPDATED` after the update. Coarse-grained (no per-field events for locations — matches the `KIT_UPDATED` decision).

### `updateLocationAssets`

Bulk asset-to-location assignment. Emits one `ASSET_LOCATION_CHANGED` per affected asset:
- Newly added: `fromValue: null`, `toValue: locationId`
- Removed: `fromValue: locationId`, `toValue: null`

**Note:** this is an asset-scoped event (`entityType: "ASSET"`), not a location-scoped one. It mirrors the semantics of `bulkUpdateAssetLocation` in the asset service.

---

## 7. Custody routes

### `routes/_layout+/assets.$assetId.overview.assign-custody.tsx`

After `createNote` for the custody-assignment note:

```ts
await recordEvent({
  organizationId,
  actorUserId: userId,
  action: "CUSTODY_ASSIGNED",
  entityType: "ASSET",
  entityId: asset.id,
  assetId: asset.id,
  teamMemberId: custodianId,
  targetUserId: custodianTeamMember.user?.id ?? undefined,
});
```

Outside the transaction — follows the existing note pattern in this route.

### `routes/_layout+/assets.$assetId.overview.release-custody.tsx`

Same pattern for `CUSTODY_RELEASED`.

### `routes/_layout+/kits.$kitId.assets.assign-custody.tsx`

This route directly creates notes for every asset in the kit via `createNotes`. We added a `recordEvents(...)` call right after with one `CUSTODY_ASSIGNED` per asset (all with `meta: { viaKit: true }` and `kitId: kit.id`).

### `routes/_layout+/kits.$kitId.assets.release-custody.tsx`

**Not modified at the route level.** This route delegates to `kit/service.server.ts:releaseCustody`, which is instrumented in the service file. So events fire correctly without touching the route.

---

## 8. Intentionally NOT wired (with reasons)

### `modules/scan/service.server.ts`

This module handles **asset QR code scans** (a user pointing their phone at an asset to view it). It writes notes but we don't emit activity events. There's no matching `ActivityAction` value for "asset QR viewed". If/when a "asset scans per period" report is requested, add `ASSET_SCANNED` to the enum and wire it in.

Note: this is **different** from `AUDIT_ASSET_SCANNED`, which is asset scans during an **audit session**. Those are fully covered in `audit/service.server.ts`.

### `modules/location-note/service.server.ts`

Creates `LocationNote` rows — these are notes on **locations**, not on assets. Examples: "John added 5 assets to Main Warehouse". They're workspace-scoped activity that lives on the Location entity.

Since `ActivityEvent` already covers asset-level location changes (`ASSET_LOCATION_CHANGED`) and location-level metadata changes (`LOCATION_CREATED` / `LOCATION_UPDATED`), these notes don't need separate event emission. If a "location activity" report is ever wanted, reconsider.

### Historical notes inside `createAssetsFromBackupImport`

The `db.note.createMany` in this function restores historical notes with their original `createdAt` timestamps. These represent events from the past. Emitting new `ActivityEvent` rows for them would date those rows as "now", producing a misleading timeline.

One `ASSET_CREATED` event per asset is emitted at import time (that IS a current event — the asset was just created in our DB), but the historical notes inside it are not emitted.

### Kit update's status change on assets

When `kit/service.server.ts:updateKit` sets a kit's status, it doesn't cascade to per-asset `ASSET_STATUS_CHANGED` events. Asset status transitions are covered by the specific semantic actions (CUSTODY_ASSIGNED/RELEASED, BOOKING_CHECKED_OUT/IN) — a generic `ASSET_STATUS_CHANGED` is only needed for edge cases (e.g., admin manual status override) that aren't yet wired.

### `scan.bulk-assign-custody.ts` / `scan.bulk-release-custody.ts` (api routes)

These API routes delegate to `bulkCheckOutAssets` / `bulkCheckInAssets` in the asset service, which are instrumented. Events fire through the service. No route-level wiring needed.

### `changeAssetQrCode` and similar

Emits a note via `createNote` around line ~4173 in `asset/service.server.ts` but no matching enum value exists for "QR code swap". Skipped deliberately. Add `ASSET_QR_CHANGED` and wire it if a report needs it.

### `asset-reminder/worker.server.ts`

The plan mentioned instrumenting the reminder worker. For this PR, we didn't — the worker is a background scheduler and its existing note-writing is minimal. Add emission if a "reminder-triggered events" report ever appears.

### Direct `db.asset.update` calls elsewhere

If someone bypasses the `updateAsset` service and updates an asset directly (e.g., `db.asset.update({...})` from a route), no event is emitted. This is by design — the service is the canonical write path. If such bypasses exist and they matter for reporting, they should be refactored to go through the service.

---

## 9. Known small gaps in coverage

These aren't intentional skips — they're places where coverage could be improved but weren't prioritised in this PR:

1. **`updateKitAssets` downstream custody events** — when a kit with custody gets new assets, those assets inherit custody via per-asset updates that call `createNotes`. Some of these per-asset custody inherits may not yet emit `CUSTODY_ASSIGNED` / `CUSTODY_RELEASED` events. If compliance reports start showing undercount for kit-related custody changes, revisit this code path.
2. **Booking date changes** — `BOOKING_DATES_CHANGED` not emitted anywhere yet. Probably worth adding to `updateBasicBooking` and the update-dates paths.
3. **Audit assignee changes** — enum values exist, no emitter. `AUDIT_ASSIGNEE_ADDED` and `_REMOVED` would go in the assignment create/delete paths in `audit/service.server.ts`.
4. **Asset archive** — `ASSET_ARCHIVED` enum exists but isn't emitted. If there's an archive flow separate from delete, wire it.

These are all "add when a report needs them" — each is a small targeted change.

---

## 10. Test coverage

`modules/activity-event/service.server.test.ts` tests:

- `recordEvent` with full actor resolution (fetches user, populates snapshot)
- `recordEvent` with pre-supplied `actorSnapshot` (no DB fetch)
- `recordEvent` with no actor (system event, `actorSnapshot: null`)
- Field-change payload passthrough (`field`, `fromValue`, `toValue`)
- `tx` client routing (supplied tx receives both user lookup and event create)
- Error wrapping with label `"Activity"`
- `recordEvents` empty-input no-op
- `recordEvents` deduplication of user lookups by `actorUserId` (bulk writes fetch each user once)

`modules/activity-event/reports.server.test.ts` tests:

- `assetChangeHistory` uses the right `where` clause (`in: ASSET_ACTIONS`, `occurredAt: { gte, lte }`) and transforms rows correctly
- `bookingStatusTransitionCounts` coerces BigInt counts from `$queryRaw` to Number
- `auditCompletionStats` filters out rows missing `auditSessionId`
- `custodyDurationsByAsset` computes `durationSeconds` from paired timestamps (null when still held)
- Error wrapping includes `helper` name in additionalData

Both test files mock `db` and `ShelfError` at the module level per the established Shelf pattern.

---

## 11. Verifying completeness

If you want to audit whether every note-writing site has a matching `recordEvent`, here's the systematic check:

```bash
# 1. Find every *Note.create with type UPDATE (potential event sites)
grep -rnE '(Note|notes)\.create[A-Za-z]*\(' apps/webapp/app/modules apps/webapp/app/routes \
  | grep -v '\.test\.ts'

# 2. Find every recordEvent call (actual event sites)
grep -rnE 'recordEvent\(|recordEvents\(' apps/webapp/app/modules apps/webapp/app/routes \
  | grep -v '\.test\.ts'
```

Spot-check that every group 1 site near a mutation has a group 2 companion. The intentional gaps documented in §8 above are expected misses.
