# Custody Acknowledgement — Implementation Plan

## Overview

Add verifiable proof that a custodian acknowledged receiving an asset. When an admin assigns custody and checks "Require acknowledgement," the system sends an email (or generates a link) and records the custodian's confirmation with legal-weight timestamps.

**Branch:** `feat/custody-acknowledgement` (from `main` at `d7d20c87f`)

---

## Phase 1: Database Schema Changes

### 1.1 Custody model — add acknowledgement fields

**File:** `packages/database/prisma/schema.prisma` (lines 671-687)

Add to the `Custody` model:

```prisma
model Custody {
  id String @id @default(cuid())

  custodian    TeamMember @relation(fields: [teamMemberId], references: [id])
  teamMemberId String

  asset   Asset  @relation(fields: [assetId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  assetId String @unique

  // Acknowledgement fields
  requiresAcceptance  Boolean   @default(false) // Was acknowledgement requested?
  acceptedAt          DateTime?                 // When custodian acknowledged
  acceptanceMethod    String?                   // "email_link" | "in_app" | "manual_link"
  acceptanceIp        String?                   // IP address at time of acknowledgement
  acceptanceUserAgent String?                   // Browser user-agent string
  assignedByUserId    String?                   // Who assigned custody (for admin notification routing)

  // DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([assetId, teamMemberId], name: "Custody_assetId_teamMemberId_idx")
  @@index([teamMemberId])
}
```

### 1.2 KitCustody model — add same acknowledgement fields

Add identical fields to `KitCustody` for kit-level acknowledgement.

### 1.3 Organization model — add feature toggle

**File:** `packages/database/prisma/schema.prisma` (Organization model, after `customEmailFooter`)

```prisma
// Custody acknowledgement add-on
custodyAcknowledgementEnabled   Boolean   @default(false)
custodyAcknowledgementEnabledAt DateTime?
usedCustodyAcknowledgementTrial Boolean   @default(false)
```

### 1.4 Migration

**File:** `packages/database/prisma/migrations/[timestamp]_add_custody_acknowledgement/migration.sql`

Run: `pnpm db:prepare-migration` then `pnpm db:deploy-migration`

All new columns are nullable or have defaults — zero impact on existing data.

---

## Phase 2: Feature Gating & Environment

### 2.1 Validator

**New file:** `apps/webapp/app/utils/permissions/custody-acknowledgement.validator.server.ts`

Follow the exact pattern from `audit.validator.server.ts`:

```typescript
export function canUseCustodyAcknowledgement(org: Pick<Organization, "custodyAcknowledgementEnabled">): boolean
export function validateCustodyAcknowledgementEnabled(org): void // throws ShelfError if disabled
```

### 2.2 Subscription helper

**File:** `apps/webapp/app/utils/subscription.server.ts`

Add:
```typescript
export const canUseCustodyAcknowledgement = (org: { custodyAcknowledgementEnabled: boolean }) => {
  if (!premiumIsEnabled) return true;
  return org.custodyAcknowledgementEnabled;
};
```

### 2.3 requirePermission return

**File:** `apps/webapp/app/utils/roles.server.ts`

Add `canUseCustodyAcknowledgement` to the return object, following the `canUseBarcodes`/`canUseAudits` pattern.

### 2.4 Addon copy for upsell UI

**File:** `apps/webapp/app/config/addon-copy.ts`

Add:
```typescript
export const CUSTODY_ACKNOWLEDGEMENT_ADDON = {
  label: "Custody Acknowledgement",
  description: "Get verifiable proof that team members received their assigned assets.",
  features: [
    "Send acknowledgement requests via email or shareable link",
    "Track acknowledgement status across all assets",
    "Legal-weight timestamps with IP and method recording",
    "Activity log entries suitable for compliance and audits",
  ],
};
```

### 2.5 How feature gating works in practice

The boolean `custodyAcknowledgementEnabled` on the Organization model is just a **switch**. How it gets flipped on is a business decision:

- **Include in Plus/Team by default** → Set to `true` when they subscribe. No extra purchase.
- **Block for Free tier** → Leave `false`. Show upsell prompting upgrade.
- **Sell as separate addon** → Wire to Stripe like barcodes/audits (v2 if needed).
- **Give to everyone** → Set `ENABLE_PREMIUM_FEATURES=false` and the check is bypassed.

For v1, the simplest path: include it in Plus and Team plans automatically. Free users see the upsell to upgrade. No Stripe addon product needed — just set the flag when the user's tier qualifies.

### 2.6 JWT token — reuse INVITE_TOKEN_SECRET

No new env var. We reuse `INVITE_TOKEN_SECRET` but include `purpose: "custody-ack"` in the JWT payload to prevent cross-use with invite tokens.

---

## Phase 3: Acknowledgement Service

**New file:** `apps/webapp/app/modules/custody/acknowledgement.server.ts`

### 3.1 Token generation

```typescript
export function generateCustodyAcknowledgementToken(custodyId: string): string
// Signs JWT with { id: custodyId, purpose: "custody-ack" }
// No expiry for v1 (token validity = custody record existence)
```

### 3.2 Token verification

```typescript
export function verifyCustodyAcknowledgementToken(token: string): { id: string }
// Verifies JWT, checks purpose === "custody-ack"
// Returns custody ID
```

### 3.3 Record acknowledgement

```typescript
export async function recordCustodyAcknowledgement({
  custodyId,
  method,      // "email_link" | "in_app" | "manual_link"
  ip,
  userAgent,
  organizationId,
}: RecordAcknowledgementParams): Promise<Custody>
// Updates custody: acceptedAt = now(), acceptanceMethod, acceptanceIp, acceptanceUserAgent
// Returns updated custody with asset + custodian data
```

### 3.4 Record decline

```typescript
export async function recordCustodyDecline({
  custodyId,
  reason,
  organizationId,
}: RecordDeclineParams): Promise<void>
// Does NOT change custody status
// Creates activity log note: "Custodian reported they don't have this item"
// Sends notification email to assigning admin
```

### 3.5 Send acknowledgement email

```typescript
export async function sendCustodyAcknowledgementEmail({
  custody,
  asset,
  custodianEmail,
  assignerName,
  organizationName,
  token,
  customFooter,
}: SendAckEmailParams): Promise<void>
// Sends email using the custody acknowledgement template
// try/catch + Logger.error + ShelfError pattern
```

### 3.6 Create acknowledgement activity note

```typescript
export function createAcknowledgementNote({
  userId,
  assetId,
  custodianName,
  method,
  timestamp,
  ip,
}: CreateAckNoteParams): Promise<Note>
// Creates rich UPDATE note with ALL legal details inline
// "Jane Smith acknowledged receipt on March 31, 2026 at 2:47 PM via email link (IP: x.x.x.x)"
// This note IS the permanent legal record (survives custody hard-delete)
```

---

## Phase 4: Email Templates

### 4.1 Custodian acknowledgement email

**New file:** `apps/webapp/app/emails/custody-acknowledgement-template.tsx`

Following the pattern from `app/emails/stripe/audit-trial-welcome.tsx` per CLAUDE.md:

- LogoForEmail at top
- "Hey {firstName}," greeting
- Body: "You've been assigned custody of {assetTitle} by {assignerName} at {orgName}."
- Asset details: title, category (if any), serial/sequential ID
- CTA button: "Acknowledge Receipt" → `${SERVER_URL}/accept-custody/${custodyId}?token=${jwt}`
- Secondary text: "If you don't have this item, click the link above and report it."
- CustomEmailFooter from org settings
- Both HTML + plain text exports
- Send wrapper function with try/catch + Logger.error + ShelfError

### 4.2 Admin notification email (on acknowledgement)

**New file:** `apps/webapp/app/emails/custody-acknowledged-admin-template.tsx`

- Brief notification: "{custodianName} acknowledged receipt of {assetTitle}"
- Timestamp of acknowledgement
- Link to asset detail page
- CustomEmailFooter

### 4.3 Admin notification email (on decline)

**New file:** `apps/webapp/app/emails/custody-declined-admin-template.tsx`

- Alert: "A dispute was reported on the custody assignment of {assetTitle} to {custodianName}"
- Reason text if provided
- Link to asset detail page

---

## Phase 5: Public Acceptance Route

**New file:** `apps/webapp/app/routes/_auth+/accept-custody.$custodyId.tsx`

### 5.1 Add to public paths

**File:** `apps/webapp/server/index.ts` (publicPaths array)

Add: `"/accept-custody/:path*"`

### 5.2 Loader

1. Extract `custodyId` from params, `token` from search params
2. Verify JWT token via `verifyCustodyAcknowledgementToken(token)`
3. Fetch custody record with asset details (title, mainImage, category, sequentialId, organization name)
4. If custody doesn't exist → render "This custody assignment has been released"
5. If already accepted → render "Already acknowledged" confirmation
6. Return asset details + custody info to component

### 5.3 Action

Handle two intents:

**`acknowledge`:**
1. Verify token again
2. Call `recordCustodyAcknowledgement()` with IP + user-agent from request
3. Create acknowledgement activity note (rich, legal-weight)
4. If kit custody → cascade `acceptedAt` to all child custody records + create notes for each asset
5. Send admin notification email
6. Send custodian confirmation email
7. Render success state

**`decline`:**
1. Verify token
2. Call `recordCustodyDecline()` with optional reason
3. Create decline activity note
4. Send admin alert email
5. Render "reported" confirmation

### 5.4 Component (the brand moment page)

```
┌──────────────────────────────────────────┐
│  [Shelf Logo]                            │
│                                          │
│  You've been assigned an asset           │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  [Asset Image]                     │  │
│  │                                    │  │
│  │  MacBook Pro 16"                   │  │
│  │  Category: Electronics             │  │
│  │  ID: SAM-0042                      │  │
│  │  Assigned by: Admin Name           │  │
│  │  Date: March 30, 2026             │  │
│  └────────────────────────────────────┘  │
│                                          │
│  By acknowledging, you confirm you have  │
│  received this asset.                    │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │      [Acknowledge Receipt]         │  │
│  └────────────────────────────────────┘  │
│                                          │
│  I don't have this item                  │
│                                          │
└──────────────────────────────────────────┘
```

After acknowledgement:
```
┌──────────────────────────────────────────┐
│  [Shelf Logo]                            │
│                                          │
│  ✓ Receipt acknowledged                  │
│                                          │
│  You've confirmed receipt of             │
│  MacBook Pro 16" (SAM-0042)              │
│  March 31, 2026 at 2:47 PM              │
│                                          │
│  A confirmation has been sent to your    │
│  email.                                  │
│                                          │
└──────────────────────────────────────────┘
```

---

## Phase 6: Assign Custody Route Changes

### 6.1 Single asset assign custody

**File:** `apps/webapp/app/routes/_layout+/assets.$assetId.overview.assign-custody.tsx`

**Loader changes:**
- Add `canUseCustodyAcknowledgement` from `requirePermission` return
- Pass to component

**Action changes:**
- Parse new `requiresAcceptance` boolean from form data (add to schema)
- If `requiresAcceptance`:
  - Include `requiresAcceptance: true` and `assignedByUserId: userId` in custody create
  - Generate JWT token
  - If custodian has user with email → send acknowledgement email
  - Store token reference (not in DB — token encodes custody ID, verification is stateless)
- Modify activity note: if acknowledgement requested, append "(acknowledgement requested)"

**Component changes:**
- Add checkbox: "Require acknowledgement" (hidden if self-assignment, hidden if feature not enabled)
- Show upsell block if feature not enabled and org is free tier
- After submission with acknowledgement for non-registered member → show copy-link dialog/toast with the generated URL

### 6.2 Kit assign custody

**File:** `apps/webapp/app/routes/_layout+/kits.$kitId.assets.assign-custody.tsx`

Same changes as 6.1 but:
- Checkbox applies to KitCustody AND all child Custody records
- One email/link for the kit (not per-asset)
- Token references the KitCustody ID

### 6.3 Bulk assign custody

**File:** `apps/webapp/app/routes/api+/assets.bulk-assign-custody.ts`
**File:** `apps/webapp/app/modules/asset/service.server.ts` (`bulkCheckOutAssets`)

- Accept `requiresAcceptance` parameter
- Pass through to custody creation
- One email per custodian (bulk assign goes to one custodian)
- Token covers all assets in the batch

### 6.4 Assign custody schema

**File:** `apps/webapp/app/modules/custody/schema.ts`

Add `requiresAcceptance: z.boolean().optional().default(false)` to `AssignCustodySchema`.

---

## Phase 7: Release Custody Changes

### 7.1 Single asset release

**File:** `apps/webapp/app/routes/_layout+/assets.$assetId.overview.release-custody.tsx`

Before releasing, check if `requiresAcceptance` was true and `acceptedAt` is null.
If so, include in the release note: "released {custodian}'s custody (acknowledgement was pending)"

### 7.2 Bulk release

**File:** `apps/webapp/app/modules/asset/service.server.ts` (`bulkCheckInAssets`)

Same: capture pending acknowledgement state in release notes.

### 7.3 Kit release

**File:** `apps/webapp/app/modules/kit/service.server.ts`

Same pattern for kit-level release notes.

---

## Phase 8: Custody Card UI Changes

**File:** `apps/webapp/app/components/assets/asset-custody-card.tsx`

### 8.1 Extend custody prop type

Add to the custody type:
```typescript
requiresAcceptance?: boolean;
acceptedAt?: Date | string | null;
assignedByUserId?: string | null;
```

### 8.2 Render acknowledgement status

After the existing "Since {date}" line:

- If `requiresAcceptance && !acceptedAt`:
  ```
  Awaiting acknowledgement
  [Copy link] · [Resend email]  (conditional on custodian having email)
  ```

- If `requiresAcceptance && acceptedAt`:
  ```
  Acknowledged {date}
  ```

### 8.3 Copy link button

Calls an API endpoint or uses a client-side function to generate/retrieve the token URL.

### 8.4 Resend email button

POST to a new API endpoint that re-sends the acknowledgement email (only if custodian has email).

---

## Phase 9: Asset Index Column

### 9.1 Add to fixed fields

**File:** `apps/webapp/app/modules/asset-index-settings/helpers.ts`

Add `"acknowledgement"` to `fixedFields` array (after `"custody"`).
Add to `columnsLabelsMap`: `acknowledgement: "Acknowledgement"`.
Add to `defaultFields`: `{ name: "acknowledgement", visible: false, position: ... }` (hidden by default).

### 9.2 Render column

**File:** `apps/webapp/app/components/assets/assets-index/advanced-asset-columns.tsx`

Add `case "acknowledgement":` to the switch statement.

Render:
- No custody → `<EmptyTableValue />`
- Custody without `requiresAcceptance` → `<EmptyTableValue />`
- Pending → Amber badge "Pending" with hover popover: "Sent X days ago. [Copy link] [Resend]"
- Acknowledged → Green check + date
- Declined → Red indicator "Disputed"

### 9.3 Asset index loader

**File:** `apps/webapp/app/routes/_layout+/assets._index.tsx` (and the advanced mode loader)

Include `requiresAcceptance`, `acceptedAt` in the custody select when loading assets.

### 9.4 Filter support

Add acknowledgement status as a filterable field in advanced mode filters.
Values: "All", "Pending", "Acknowledged", "Not required"

---

## Phase 10: In-App Acknowledgement for Logged-In Users

### 10.1 Acknowledgement banner component

**New file:** `apps/webapp/app/components/custody/acknowledgement-banner.tsx`

A dismissible banner shown at the top of the assets list:
```
You have {count} items awaiting your acknowledgement. [Review & Acknowledge]
```

### 10.2 Acknowledge in-app route

**New file:** `apps/webapp/app/routes/_layout+/custody.acknowledge.tsx`

Page listing all of the current user's pending acknowledgements.
- Shows asset image, title, assigned date, assigner name
- "Acknowledge" button per item + "Acknowledge All" button
- Uses `recordCustodyAcknowledgement()` with method "in_app"

### 10.3 Permission bypass for acknowledgement

The acknowledge action needs to work for BASE and SELF_SERVICE users who are the custodian.
This is NOT a general custody permission — it's: "you can acknowledge YOUR OWN custody."

In the in-app acknowledge route and the public route action:
- Check that the requesting user's TeamMember ID matches the custody's teamMemberId
- No role-based permission check needed for acknowledging your own custody

### 10.4 Layout integration

**File:** `apps/webapp/app/routes/_layout+/assets._index.tsx` (loader)

Add a query for count of pending acknowledgements for the current user's team member.
Pass to the banner component.

---

## Phase 11: Resend & Copy Link API

**New file:** `apps/webapp/app/routes/api+/custody.acknowledgement.ts`

Handles:
- `POST` with intent `resend-email`: Re-generates token, re-sends email
- `POST` with intent `copy-link`: Returns the signed URL for clipboard copy
- Requires `PermissionAction.custody` on `PermissionEntity.asset` (admin only)

---

## Phase 12: Tier-Based Feature Enablement

### 12.1 Enable for qualifying tiers

The feature is **included in Plus and Team plans** — not a separate addon purchase.

When a user subscribes to Plus or Team (or already has an active subscription), set `custodyAcknowledgementEnabled = true` on their organization. This can be done:

- In the existing Stripe webhook handler that processes subscription changes
- Or via a one-time migration for existing Plus/Team orgs

### 12.2 Upsell for Free tier

When a Free tier user encounters the "Require acknowledgement" checkbox:
- Show a locked/disabled state with an upgrade prompt
- Link to the subscription/upgrade page
- Use the `CUSTODY_ACKNOWLEDGEMENT_ADDON` copy from `addon-copy.ts`

No separate Stripe product, no trial flow, no addon management page needed for v1. The feature just comes with the plan.

---

## Files Summary

### New files (10):
1. `apps/webapp/app/modules/custody/acknowledgement.server.ts` — Core service
2. `apps/webapp/app/emails/custody-acknowledgement-template.tsx` — Custodian email
3. `apps/webapp/app/emails/custody-acknowledged-admin-template.tsx` — Admin success email
4. `apps/webapp/app/emails/custody-declined-admin-template.tsx` — Admin decline alert
5. `apps/webapp/app/routes/_auth+/accept-custody.$custodyId.tsx` — Public acceptance page
6. `apps/webapp/app/utils/permissions/custody-acknowledgement.validator.server.ts` — Feature gate
7. `apps/webapp/app/components/custody/acknowledgement-banner.tsx` — In-app banner
8. `apps/webapp/app/routes/_layout+/custody.acknowledge.tsx` — In-app acknowledge page
9. `apps/webapp/app/routes/api+/custody.acknowledgement.ts` — Resend/copy-link API
10. `packages/database/prisma/migrations/[ts]_add_custody_acknowledgement/migration.sql`

### Modified files (16):
1. `packages/database/prisma/schema.prisma` — Custody, KitCustody, Organization models
2. `apps/webapp/server/index.ts` — Add public path
3. `apps/webapp/app/routes/_layout+/assets.$assetId.overview.assign-custody.tsx` — Checkbox + email logic
4. `apps/webapp/app/routes/_layout+/kits.$kitId.assets.assign-custody.tsx` — Same for kits
5. `apps/webapp/app/routes/api+/assets.bulk-assign-custody.ts` — Bulk assign support
6. `apps/webapp/app/modules/asset/service.server.ts` — `bulkCheckOutAssets` acknowledgement
7. `apps/webapp/app/modules/kit/service.server.ts` — Kit custody acknowledgement
8. `apps/webapp/app/modules/custody/service.server.ts` — No changes to releaseCustody (it already hard-deletes)
9. `apps/webapp/app/modules/custody/schema.ts` — Add requiresAcceptance to schema
10. `apps/webapp/app/components/assets/asset-custody-card.tsx` — Show status + actions
11. `apps/webapp/app/modules/asset-index-settings/helpers.ts` — New column
12. `apps/webapp/app/components/assets/assets-index/advanced-asset-columns.tsx` — Render column
13. `apps/webapp/app/routes/_layout+/assets._index.tsx` — Load acknowledgement data + banner
14. `apps/webapp/app/routes/_layout+/assets.$assetId.overview.release-custody.tsx` — Pending note
15. `apps/webapp/app/utils/roles.server.ts` — Return `canUseCustodyAcknowledgement`
16. `apps/webapp/app/config/addon-copy.ts` — Upsell copy

---

## Build & Test Order

1. **Phase 1** → Run migration → `pnpm db:deploy-migration`
2. **Phase 2-3** → Service + gating (no UI yet) → Run unit tests
3. **Phase 4** → Email templates (can preview with React Email)
4. **Phase 5** → Public acceptance route → Manual test with generated JWT
5. **Phase 6** → Assign custody changes → Test full flow: assign → email → accept
6. **Phase 7** → Release changes → Test release-with-pending notes
7. **Phase 8** → Custody card → Visual verification via preview
8. **Phase 9** → Index column → Visual verification via preview
9. **Phase 10** → In-app banner + acknowledge page → Test as BASE/SELF_SERVICE user
10. **Phase 11** → Resend/copy-link API → Test from custody card buttons
11. **Phase 12** → Settings/stripe (can be deferred)
12. **Final** → `pnpm webapp:validate` → Full validation pass

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| No new AssetStatus | IN_CUSTODY set immediately. Acknowledgement is evidence, not a gate. Avoids ripple through dozens of status checks. |
| Activity note = permanent legal record | Custody records are hard-deleted on release. Rich note with timestamp/IP/method survives. |
| Reuse INVITE_TOKEN_SECRET | JWT includes `purpose: "custody-ack"` to prevent cross-use. No new env var. |
| String field for acceptanceMethod | Avoids Prisma enum migration for each new method. Validated at app layer. |
| Feature gated per-org (boolean switch) | Same infra as barcode/audit. Included in Plus/Team by default. Free users see upsell to upgrade. Not a separate purchase — just tier-gated. |
| Self-assignment hides checkbox | Can't corroborate receipt from the person who assigned. |
| One email per custodian for bulk | Not spammy. One acknowledge-all click. |
| Kit acknowledgement cascades | One click updates KitCustody + all child Custody records in transaction. |
| BASE users can acknowledge own custody | Permission bypass: if you ARE the custodian, you can acknowledge. Not a general custody permission. |
| Non-registered members get copy-link only | No email field on TeamMember. Admin copies link, sends manually. |
| Column hidden by default | Opt-in visibility. Admins who use the feature toggle it on. |
