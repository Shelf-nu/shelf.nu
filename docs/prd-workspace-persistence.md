# PRD: Server-Side Workspace Persistence

## Problem Statement

Users who belong to multiple workspaces (personal + organization) experience confusion when logging in from different devices. The current cookie-based approach stores the last selected organization **per-device**, causing users to land in the wrong workspace when:

1. **New device login**: User enters data on desktop (org workspace) → logs in on mobile → lands in personal workspace → thinks data is lost
2. **Cleared cookies**: Browser clears cookies → falls back to first organization in list (arbitrary)
3. **Incognito/private browsing**: No cookie history → defaults to wrong workspace

### Real User Impact

> "We did the trial and entered 7 yrs of Amazon assets and switched over to a paid subscription but can't find any of the assets entered... only the categories..."

This user's data was safe in their organization workspace, but they logged in on mobile and landed in their personal workspace, causing panic and confusion.

## Goals

1. **Cross-device consistency**: User's last selected workspace persists across all devices
2. **Zero friction**: No workspace selection screen on login (as shown in screenshot reference)
3. **Minimal changes**: Simplest possible implementation with existing patterns
4. **Backward compatible**: Works seamlessly with existing cookie system

## Non-Goals

- Workspace picker on login
- Complex preference management UI
- Per-device workspace preferences
- Workspace "pinning" or favorites

---

## Solution: Database-Backed Workspace Persistence

### Overview

Add a single field `lastSelectedOrganizationId` to the User model. This becomes the **source of truth** for which workspace to show when no valid cookie exists.

### Why This Approach?

| Approach                      | Pros                                           | Cons                                  |
| ----------------------------- | ---------------------------------------------- | ------------------------------------- |
| **Database field on User** ✅ | Simplest, single source of truth, cross-device | Tiny extra DB write on switch         |
| Separate preferences table    | More flexible                                  | Over-engineered for single field      |
| Session storage               | Already server-side                            | Sessions expire, not truly persistent |
| Extend UserOrganization table | Could add "lastAccessedAt"                     | More complex queries                  |

The single field on User is the **most elegant** solution—it requires minimal schema change, no new tables, and leverages existing update patterns.

---

## Technical Specification

### 1. Schema Change

```prisma
model User {
  // ... existing fields ...

  /// The organization ID the user last selected/visited.
  /// Used as default workspace when cookie is missing or invalid.
  lastSelectedOrganizationId String?

  // ... existing relations ...
}
```

**Migration**: Simple `ALTER TABLE` adding nullable column. No data backfill required.

### 2. Update on Workspace Switch

**File**: `app/routes/api+/user.change-current-organization.ts`

When user switches workspace:

1. Set cookie (existing behavior)
2. **NEW**: Update `user.lastSelectedOrganizationId` in database

```typescript
export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = isAuthenticated(context);
  const { organizationId, redirectTo } = parseData(
    await request.formData(),
    organizationSchema
  );

  // NEW: Persist to database for cross-device consistency
  await db.user.update({
    where: { id: userId },
    data: { lastSelectedOrganizationId: organizationId },
  });

  return redirect(safeRedirect(redirectTo), {
    headers: [setCookie(await setSelectedOrganizationIdCookie(organizationId))],
  });
}
```

### 3. Organization Selection Logic

**File**: `app/modules/organization/context.server.ts`

Update the fallback logic when cookie is missing/invalid:

```typescript
// Current logic (simplified):
if (!organizationId || !userOrganizationIds.includes(organizationId)) {
  organizationId = userOrganizationIds[0]; // First org - arbitrary!
}

// NEW logic:
if (!organizationId || !userOrganizationIds.includes(organizationId)) {
  // Priority 1: User's last selected (from database)
  if (
    user.lastSelectedOrganizationId &&
    userOrganizationIds.includes(user.lastSelectedOrganizationId)
  ) {
    organizationId = user.lastSelectedOrganizationId;
  } else {
    // Priority 2: Personal workspace (safe default)
    const personalOrg = organizations.find((o) => o.type === "PERSONAL");
    organizationId = personalOrg?.id ?? userOrganizationIds[0];
  }
}
```

### 4. Fallback Hierarchy

When determining which workspace to show:

1. **Cookie value** (if valid and user still has access)
2. **Database `lastSelectedOrganizationId`** (if valid and user still has access)
3. **Personal workspace** (safe default)
4. **First available organization** (edge case fallback)

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER SWITCHES WORKSPACE                       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────┐
              │  POST /api/user/change-current-organization │
              └─────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐
        │   Set Cookie      │           │  Update Database  │
        │  (device-local)   │           │  (cross-device)   │
        └───────────────────┘           └───────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│                      USER LOGS IN (ANY DEVICE)                       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
              ┌─────────────────────────────────────────┐
              │          getOrganizationContext()       │
              └─────────────────────────────────────────┘
                                    │
                                    ▼
                        ┌───────────────────┐
                        │  Check Cookie     │
                        └───────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
             Cookie Valid                    Cookie Missing/Invalid
                    │                               │
                    ▼                               ▼
           ┌──────────────┐              ┌────────────────────┐
           │ Use Cookie   │              │ Check DB field     │
           │   Value      │              │ lastSelectedOrgId  │
           └──────────────┘              └────────────────────┘
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │                               │
                              DB Value Valid                 DB Value Invalid
                                    │                               │
                                    ▼                               ▼
                           ┌──────────────┐              ┌──────────────────┐
                           │ Use DB Value │              │ Use Personal Org │
                           └──────────────┘              └──────────────────┘
```

---

## Implementation Plan

### Phase 1: Schema & Migration (Low Risk)

1. Add `lastSelectedOrganizationId` to User model in `schema.prisma`
2. Create migration: `npm run db:prepare-migration`
3. Deploy migration

### Phase 2: Write Path (Low Risk)

1. Update `change-current-organization.ts` action to write to database
2. Add database update alongside cookie set

### Phase 3: Read Path (Low Risk)

1. Update `context.server.ts` to include new fallback logic
2. Ensure user query includes `lastSelectedOrganizationId` field

### Testing Checklist

- [ ] User switches org → DB field updated
- [ ] User logs in new device without cookie → lands in last selected org
- [ ] User removed from org → falls back to personal org (not crash)
- [ ] New user with no history → lands in personal org
- [ ] Cookie still works for same-device preference

---

## Files to Modify

| File                                                  | Change                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| `app/database/schema.prisma`                          | Add `lastSelectedOrganizationId String?` to User |
| `app/routes/api+/user.change-current-organization.ts` | Add DB update on switch                          |
| `app/modules/organization/context.server.ts`          | Update fallback logic                            |

**Total: 3 files, ~20 lines of code**

---

## Edge Cases

### User Removed from Organization

If user's `lastSelectedOrganizationId` points to an org they no longer have access to:

- Fall back to personal workspace
- Do NOT clear the DB field (they might be re-added)

### New User (No History)

- `lastSelectedOrganizationId` will be null
- Default to personal workspace

### Organization Deleted

- Same as "removed from org" - fall back to personal workspace

### User Has Only One Organization

- No switching possible
- Field still works, just always points to the one org

---

## Success Metrics

1. **Reduced support tickets** about "missing data" after login
2. **Zero additional screens** in user flow
3. **Cross-device consistency** - same workspace on all devices

---

## Alternatives Considered

### 1. Workspace Selection Screen on Login

**Rejected**: Adds friction, user wants to get to their data immediately.

### 2. "Last Accessed" Timestamp on UserOrganization

**Rejected**: More complex queries, requires sorting. Single field is simpler.

### 3. User Preferences Table

**Rejected**: Over-engineered for a single preference. Can add later if needed.

### 4. Smart Default (Most Recently Active Org)

**Rejected**: Requires tracking activity across orgs, complex and potentially wrong.

---

## Appendix: Current Cookie Implementation

For reference, current cookie behavior in `context.server.ts`:

```typescript
const selectedOrganizationIdCookie = createCookie("selected-organization-id", {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secrets: [SESSION_SECRET],
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365, // 1 year
});
```

The cookie remains useful for:

- Fast access without DB query
- Device-specific temporary overrides
- Reducing DB writes on every page load

The database field acts as the **persistent backup** when cookie is unavailable.
