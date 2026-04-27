# PRD: Audit Lifecycle — Duplicate, Archive & Delete

## Overview

Three features that extend the audit lifecycle beyond its current terminal states (COMPLETED / CANCELLED). Together they let power users run recurring monthly audits without manually recreating them, keep the main list clean, and safely remove audits they no longer need.

**Target user:** IT teams running 100+ audits monthly across large estates (offices, floors, equipment zones).

---

## Feature 1: Duplicate Audit

### What it does

Copies a completed or cancelled audit into a new PENDING audit with fresh assets, following the same pattern as "Duplicate booking."

### User flow

1. User opens a completed or cancelled audit.
2. In the Actions dropdown, clicks **"Duplicate audit."**
3. A confirmation dialog appears: _"Duplicate audit [Audit Name]?"_
4. On confirm, the system creates a new audit and redirects the user to it.

### Behavior

| Field                        | Behavior                                                 |
| ---------------------------- | -------------------------------------------------------- |
| Name                         | Original name + `" (Copy)"` suffix                       |
| Description                  | Copied as-is                                             |
| Scope metadata (`scopeMeta`) | Copied as-is                                             |
| Assets                       | Re-resolved from current scope (see Asset Refresh below) |
| Assignments                  | Cleared — no assignees on the new audit                  |
| Status                       | `PENDING`                                                |
| Due date                     | Cleared (`null`) — user sets it manually via Edit        |
| Creator                      | Set to the current user                                  |
| Notes, scans, images         | NOT copied — new audit starts clean                      |

### Asset refresh with warning (not error)

When duplicating, the system re-fetches assets that match the original scope. If some assets from the original audit no longer exist (deleted, moved to another org), the system:

1. **Does NOT throw an error.**
2. Shows a **warning** in the confirmation dialog listing which assets were dropped: _"2 of 25 assets from the original audit no longer exist and will not be included."_
3. User can **acknowledge and proceed** or cancel.
4. If ALL assets are gone, show a blocking error: _"None of the original assets exist anymore. Cannot duplicate."_

### Asset resolution strategy

The system needs to re-query assets based on the original scope. This requires `scopeMeta` to store queryable identifiers, not just display names.

**Current `scopeMeta` structure:**

```json
{ "contextType": "tag", "contextName": "Canary PCs" }
```

**Required `scopeMeta` structure (add `targetId`):**

The `targetId` field already exists on `AuditSession` (schema line 1540). When creating audits by tag/category/location, `targetId` should store the tag/category/location ID. For audits created from a manual asset selection, `targetId` remains null and assets are resolved from the original `AuditAsset` records.

**Resolution logic:**

```text
if targetId exists AND contextType is "tag" | "category" | "location":
  → re-query assets matching that tag/category/location in the org
else:
  → copy asset IDs from the original audit's AuditAsset records
  → validate they still exist
```

### Availability

- Available on audits with status: `COMPLETED`, `CANCELLED`, `ARCHIVED`
- Available to: Admin and Owner roles (same as "create audit" permission)
- NOT available on `PENDING` or `ACTIVE` audits (use Edit instead)

### Implementation notes

- **Route:** New route `audits.$auditId.duplicate.tsx` (matches booking pattern `bookings.$bookingId.overview.duplicate.tsx`)
- **Service function:** `duplicateAuditSession()` in `service.server.ts`
- **UI component:** Confirmation dialog in `components/audit/duplicate-audit-dialog.tsx`
- **Actions dropdown:** Add "Duplicate audit" button, visible when `isCompleted || isCancelled || isArchived`

---

## Feature 2: Archive Audit

### What it does

Moves a completed audit out of the main list into an archived state, viewable via the status filter. Follows the booking archive pattern — `ARCHIVED` is an enum value on `AuditStatus`, not a separate field.

### User flow

1. User opens a completed audit.
2. In the Actions dropdown, clicks **"Archive."**
3. Audit status changes to `ARCHIVED`.
4. Audit disappears from the default list view.
5. User can find it again by selecting "ARCHIVED" in the status filter dropdown.

### Schema change

Add `ARCHIVED` to the `AuditStatus` enum:

```prisma
enum AuditStatus {
  PENDING
  ACTIVE
  COMPLETED
  CANCELLED
  ARCHIVED     // new
}
```

Migration: enum addition only, no data backfill needed.

### Behavior

| Aspect            | Detail                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| Prerequisite      | Audit must be `COMPLETED` (same rule as bookings)                                |
| Reversibility     | Not reversible (same as bookings — no "unarchive")                               |
| Main list default | Exclude `ARCHIVED` by default (cancelled audits remain visible — see note below) |
| Visibility        | Viewable via status filter dropdown                                              |
| Bulk archive      | Yes — follow the same bulk action pattern as bookings                            |
| Activity note     | Auto-create: _"[User] archived the audit"_                                       |

**Note on CANCELLED visibility:** Unlike bookings, which hide both `ARCHIVED` and `CANCELLED` by default, audits only hide `ARCHIVED`. Cancelled audits currently show in the main list and provide useful context (who cancelled, why). Changing this would be a silent behavior change for existing users. If we want to align with the booking pattern later, that's a separate, intentional decision.

### What stays the same after archiving

- All `AuditAsset`, `AuditScan`, `AuditNote`, `AuditImage` records preserved
- PDF receipt still downloadable
- Audit detail page still accessible (read-only)

### Availability

- Available on audits with status: `COMPLETED` only
- Available to: Admin and Owner roles
- NOT available on `PENDING`, `ACTIVE`, `CANCELLED`

### Main list filter change

In `getAuditsForOrganization()`, update the default status filter:

```typescript
// Current: no default exclusion
// New: exclude ARCHIVED by default (match booking pattern)
if (status) {
  where.status = status;
} else {
  where.status = { notIn: [AuditStatus.ARCHIVED] };
}
```

### Implementation notes

- **Service function:** `archiveAuditSession()` in `service.server.ts`
- **Bulk service:** `bulkArchiveAuditSessions()` for bulk action
- **Actions dropdown:** Add "Archive" button, visible when `isCompleted && !isArchived`
- **Status filter:** Already exists (`audit-status-filter.tsx`) — will automatically pick up the new enum value
- **Route action:** Add `intent === "archive-audit"` handler in `audits.$auditId.tsx`

---

## Feature 3: Delete Audit

### What it does

Permanently removes an audit and all its associated data. Requires the audit to be **archived first** (two-step safety). Confirmation requires typing the audit name (custom field delete pattern).

### User flow

1. User has an archived audit they want to permanently remove.
2. In the Actions dropdown, clicks **"Delete."**
3. A confirmation dialog appears with:
   - Warning text: _"This will permanently delete this audit and all its data (scans, notes, images). This action cannot be undone."_
   - Input field: _"To confirm, type the audit name below."_
   - Expected input shown: _"Expected input: First Floor Blue A"_
   - Delete button disabled until input matches (case-insensitive)
4. On confirm, audit and all cascade data are hard-deleted.

### Schema impact

No schema change. The existing cascade rules handle everything:

- `AuditAsset` → `onDelete: Cascade` from `AuditSession`
- `AuditScan` → `onDelete: Cascade` from `AuditSession`
- `AuditNote` → `onDelete: Cascade` from `AuditSession`
- `AuditImage` → `onDelete: Cascade` from `AuditSession`
- `AuditAssignment` → `onDelete: Cascade` from `AuditSession`

### Behavior

| Aspect        | Detail                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Prerequisite  | Audit must be `ARCHIVED`                                                                                                |
| Confirmation  | Type the audit name (case-insensitive match)                                                                            |
| Deletion type | **Hard delete** — `db.auditSession.delete()` with cascades                                                              |
| Image cleanup | Delete associated images from Supabase storage                                                                          |
| Bulk delete   | Yes — with individual name confirmation per audit NOT required for bulk. Bulk uses standard "Are you sure?" with count. |
| Reversibility | **Irreversible**                                                                                                        |

### Bulk delete

For bulk delete of archived audits:

- Confirmation dialog: _"Permanently delete {count} archived audits? This will remove all scan data, notes, and images. This action cannot be undone."_
- Single confirmation input NOT required for bulk (too cumbersome for 50+ audits)
- Requires typing `"DELETE"` (literal string) to confirm bulk operations
- Only archived audits can be bulk-deleted

### Availability

- Available on audits with status: `ARCHIVED` only
- Available to: Admin and Owner roles
- NOT available on `PENDING`, `ACTIVE`, `COMPLETED`, `CANCELLED`

### Implementation notes

- **Service function:** `deleteAuditSession()` and `bulkDeleteAuditSessions()` in `service.server.ts`
- **UI component:** `delete-audit-dialog.tsx` (follows `components/custom-fields/delete-dialog.tsx` pattern)
- **Actions dropdown:** Add "Delete" button, visible only when `isArchived`
- **Image cleanup:** Call existing `deleteAuditImage()` pattern for Supabase storage cleanup before DB delete
- **Route action:** Add `intent === "delete-audit"` handler in `audits.$auditId.tsx`

---

## Build Order

```text
Feature 2 (Archive) → Feature 3 (Delete) → Feature 1 (Duplicate)
```

**Rationale:**

- Archive is the simplest (enum addition + status change + filter update)
- Delete depends on Archive (prerequisite: must be archived first)
- Duplicate is independent but most complex (asset refresh logic, warning UX)
- Shipping Archive first gives immediate value (clean up completed audits)

---

## Status Lifecycle (Updated)

```text
PENDING → ACTIVE → COMPLETED → ARCHIVED → [DELETE]
                 ↘ CANCELLED

COMPLETED / CANCELLED / ARCHIVED → [DUPLICATE] → new PENDING audit
```

---

## Scope Exclusions

The following were discussed but are explicitly **not in scope**:

- **Previous Rounds / audit history grouping** — Users manage this via naming conventions and PDF receipt comparisons. No `auditGroupId` or `roundNumber` schema changes.
- **Auto-archive** — No automatic archiving of audits after N days (bookings have this; audits do not need it yet).
- **Unarchive** — Not supported (matches booking pattern). User can duplicate an archived audit if they need to re-run it.
- **Recurring/scheduled audits** — No cron-based audit creation. Duplicate is the manual equivalent.

---

## File Impact Summary

| Area                     | Files                                                                      |
| ------------------------ | -------------------------------------------------------------------------- |
| Schema                   | `packages/database/prisma/schema.prisma` (add `ARCHIVED` to enum)          |
| Migration                | New migration for enum addition                                            |
| Service                  | `apps/webapp/app/modules/audit/service.server.ts` (3 new functions)        |
| Route — detail           | `apps/webapp/app/routes/_layout+/audits.$auditId.tsx` (new intents)        |
| Route — duplicate        | `apps/webapp/app/routes/_layout+/audits.$auditId.duplicate.tsx` (new)      |
| Route — index            | `apps/webapp/app/routes/_layout+/audits._index.tsx` (default filter)       |
| Component — actions      | `apps/webapp/app/components/audit/actions-dropdown.tsx` (new items)        |
| Component — dialogs      | New: `duplicate-audit-dialog.tsx`, `delete-audit-dialog.tsx`               |
| Component — status badge | `apps/webapp/app/components/audit/audit-status-badge.tsx` (ARCHIVED style) |
| Helpers                  | `apps/webapp/app/modules/audit/helpers.server.ts` (archive note)           |
