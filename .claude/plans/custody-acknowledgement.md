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
  requiresAcceptance        Boolean   @default(false) // Was acknowledgement requested?
  acceptedAt                DateTime?                 // When custodian acknowledged
  acceptanceMethod          String?                   // "email_link" | "in_app" | "manual_link"
  acceptanceIp              String?                   // IP address (ephemeral — deleted with custody on release)
  acceptanceUserAgent       String?                   // Browser user-agent (ephemeral — deleted with custody)
  assignedByUserId          String?                   // Who assigned custody (for admin notification routing)
  declinedAt                DateTime?                 // When custodian reported they don't have the item
  declineReason             String?                   // Optional reason from custodian
  tokenIssuedAt             DateTime?                 // When the current token was issued (for invalidation on resend)
  acknowledgementBatchId    String?                   // Groups multiple custody records for bulk acknowledgement

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

### 2.4 Add-on copy for upsell UI

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
- **Sell as separate add-on** → Wire to Stripe like barcodes/audits (v2 if needed).
- **Give to everyone** → Set `ENABLE_PREMIUM_FEATURES=false` and the check is bypassed.

For v1, the simplest path: include it in Plus and Team plans automatically. Free users see the upsell to upgrade. No Stripe addon product needed — just set the flag when the user's tier qualifies.

### 2.6 JWT token — separate CUSTODY_TOKEN_SECRET

**New env var: `CUSTODY_TOKEN_SECRET`** — a dedicated secret for custody acknowledgement tokens.

We do NOT reuse `INVITE_TOKEN_SECRET` because the invite verification path (`accept-invite.$inviteId.tsx:110-112`) does not validate a `purpose` claim. Sharing secrets would allow custody tokens to pass invite verification — a token confusion vulnerability. Separate secrets eliminate this risk entirely.

Add to `apps/webapp/app/utils/env.ts`:
```typescript
export const CUSTODY_TOKEN_SECRET = getEnv("CUSTODY_TOKEN_SECRET", { isSecret: true });
```

---

## Phase 3: Acknowledgement Service

**New file:** `apps/webapp/app/modules/custody/acknowledgement.server.ts`

### 3.1 Token generation

```typescript
export async function generateCustodyAcknowledgementToken(custodyId: string): Promise<string>
// Signs JWT with { id: custodyId, purpose: "custody-ack" } using CUSTODY_TOKEN_SECRET
// 30-day expiry (exp claim)
// Updates custody.tokenIssuedAt = now() in DB (invalidates any previous token)
```

```typescript
export function generateBatchAcknowledgementToken(batchId: string): string
// Signs JWT with { batchId, purpose: "custody-ack-batch" } using CUSTODY_TOKEN_SECRET
// 30-day expiry. Used for bulk assign (multiple assets, one link)
// Updates tokenIssuedAt on ALL custody records in the batch
```

**Token security:**
- Signed with dedicated `CUSTODY_TOKEN_SECRET` (not shared with invite tokens)
- 30-day expiry via JWT `exp` claim
- On resend: new token generated, `tokenIssuedAt` updated on custody record — old tokens rejected
- Token's decoded `id` is the **sole authority** for DB operations — URL param is for routing only
- `purpose` field provides defense-in-depth

### 3.2 Token verification (single custody)

```typescript
export async function verifyCustodyAcknowledgementToken(
  token: string,
  db: PrismaClient
): Promise<{ id: string; iat: number }>
// 1. Verifies JWT signature + expiry using CUSTODY_TOKEN_SECRET
// 2. Checks purpose === "custody-ack"
// 3. Fetches custody record
// 4. Normalizes time units: converts Prisma DateTime to Unix seconds
//    via Math.floor(tokenIssuedAt.getTime() / 1000) before comparing to JWT iat (RFC 7519 = seconds)
// 5. Throws ShelfError("Token expired") on exp failure
// 6. Throws ShelfError("Token revoked") if tokenIssuedAtSeconds > token.iat
// 6. Throws ShelfError("Custody not found") if record doesn't exist
// Returns custody ID and iat
// Token rotation check is INSIDE this function — callers cannot forget it
```

### 3.3 Token verification (batch)

```typescript
export async function verifyBatchAcknowledgementToken(
  token: string,
  db: PrismaClient
): Promise<{ batchId: string; custodies: CustodyWithAsset[] }>
// 1. Verifies JWT signature + expiry using CUSTODY_TOKEN_SECRET
// 2. Checks purpose === "custody-ack-batch"
// 3. Fetches all custody records with matching acknowledgementBatchId
// 4. Enforces single-custodian membership: all records must have same teamMemberId
//    (prevents cross-custody acknowledgement if batch was somehow corrupted)
// 5. Validates token rotation on EVERY custody record in the batch:
//    converts each custody.tokenIssuedAt to Unix seconds, rejects if any tokenIssuedAtSeconds > token.iat
// 6. Throws if no records found, mixed custodians, or any rotation check fails
// Returns batchId + full custody list with asset details
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

### 3.4 Send acknowledgement email

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

### 3.6 Record decline

Updated from 3.4 — decline now **persists state** on the Custody record:

```typescript
export async function recordCustodyDecline({
  custodyId,
  reason,
  organizationId,
}: RecordDeclineParams): Promise<void>
// Updates custody: declinedAt = now(), declineReason = reason
// Does NOT change asset status or delete custody
// Creates activity log note
// Sends notification email to assigning admin
```

### 3.7 Create acknowledgement activity note

```typescript
export function createAcknowledgementNote({
  userId,
  assetId,
  custodianName,
  method,
  timestamp,
}: CreateAckNoteParams): Promise<Note>
// Creates rich UPDATE note with legal summary (no raw PII)
// "Jane Smith acknowledged receipt on March 31, 2026 at 2:47 PM via email link"
// Raw IP + user-agent stored only on the Custody record's ephemeral fields
// (deleted when custody is released — data minimization by design)
// This note IS the permanent human-readable record (survives custody hard-delete)
```

**Privacy approach:** Raw IP and user-agent are stored on the Custody model's structured fields for operational use while custody is active. The activity note contains only a summary (custodian name, timestamp, method) — no raw PII. When custody is released and the record deleted, the ephemeral evidence is purged automatically. The note survives as the permanent record without privacy concerns.

### 3.8 PII retention and cleanup

For custodies that are never released (permanent assignments, abandoned assets), raw PII would persist indefinitely. To prevent this:

```typescript
export async function cleanupExpiredAcknowledgementPII(): Promise<void>
// Scheduled job (daily via pg-boss)
// Finds custodies where acceptedAt is > 2 years ago AND acceptanceIp is not null
// Sets acceptanceIp = null, acceptanceUserAgent = null
// Preserves acceptedAt, acceptanceMethod (non-PII summary data)
```

Add to the acknowledgement email template: brief privacy notice that IP and browser info are recorded for security purposes and retained for a maximum of 2 years.

### 3.9 Error handling specification

The acceptance route must handle these error states explicitly:

| Error | Cause | User message |
|-------|-------|-------------|
| Token expired | 30-day `exp` claim exceeded | "This link has expired. Contact your admin for a new one." |
| Token revoked | `iat < tokenIssuedAt` (admin resent) | "This link is no longer valid. A newer link was sent." |
| Custody not found | Released between page load and click | "This custody assignment has been released." |
| Already acknowledged | `acceptedAt` is set | Show confirmation with existing date. |
| Already declined | `declinedAt` is set | Show "already reported" confirmation. |
| Prisma P2025 | Race condition on acknowledge action | "This custody has been released and can no longer be acknowledged." |

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

Add: `"/accept-custody/:custodyId"` (narrow — no wildcard)

### 5.2 Auth model — two explicit modes

**Public token mode** (this route — no session required):
- Token is the authority. No login needed.
- Extract `token` from search params, verify JWT
- The decoded `id` from the token is the **sole key** for all DB operations — ignore the URL `custodyId` param for data access (use it only for routing)
- Also verify `custody.tokenIssuedAt <= token.iat` to reject rotated/old tokens
- Works for non-registered members, logged-out users, anyone with the link

**In-app mode** (Phase 10 route — session required):
- User must be logged in
- Verify that the requesting user's TeamMember ID matches `custody.teamMemberId`
- No token needed — session identity is the authority
- Works for BASE, SELF_SERVICE, ADMIN users acknowledging their own custody

### 5.3 Loader

1. Extract `token` from search params
2. Decode token (without full verification) to check `purpose` field
3. **Branch on token type:**
   - `purpose === "custody-ack"` → Single flow: call `verifyCustodyAcknowledgementToken(token, db)` (handles signature, expiry, rotation check internally)
   - `purpose === "custody-ack-batch"` → Batch flow: call `verifyBatchAcknowledgementToken(token, db)` — returns all custodies in the batch with asset details
4. Handle error states (see 3.9 error handling table): expired, revoked, not found
5. If already accepted → render "Already acknowledged" confirmation
6. If declined → render "Already reported" confirmation
7. Return asset details + custody info (single or batch list) to component

### 5.4 Action

Handle two intents:

**`acknowledge`:**
1. Verify token again (full verification including rotation check)
2. **DB transaction:** Call `recordCustodyAcknowledgement()` with IP + user-agent AND create acknowledgement activity note atomically
3. If kit custody → cascade `acceptedAt` to all child custody records + create notes for each asset (same transaction)
4. **After commit:** Enqueue notification emails via pg-boss (`sendEmail()` already uses pg-boss with 15 retries). Admin + custodian emails are enqueued, not sent inline — if the queue fails, DB state is correct and emails can be retried independently.
5. Render success state

**`decline`:**
1. Verify token (full verification)
2. **DB transaction:** Call `recordCustodyDecline()` + create decline activity note atomically
3. **After commit:** Enqueue admin alert email via pg-boss
4. Render "reported" confirmation

**Why enqueue after commit:** Mixing DB mutations and email sends in one request path risks partial success (DB committed but email lost). The existing `sendEmail()` function already uses pg-boss as an outbox with retry — we just need to call it AFTER the transaction commits, not inside it.

### 5.4 Component (the brand moment page)

```text
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
```text
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
- Generate a `acknowledgementBatchId` (cuid) and set it on all Custody records in the batch
- Batch is always **per-custodian** — bulk assign already goes to one custodian, but the batch verifier enforces single-`teamMemberId` membership (rejects if records have mixed custodians)
- Generate a batch token via `generateBatchAcknowledgementToken(batchId)`
- One email per custodian with one link covering all assets
- Acceptance page for batch: queries all custodies with matching `acknowledgementBatchId`, verifies all belong to same custodian, shows list, one "Acknowledge All" click updates all records in transaction

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

- If `requiresAcceptance && !acceptedAt && !declinedAt`:
  ```text
  Awaiting acknowledgement
  [Copy link] · [Resend email]  (conditional on custodian having email)
  ```

- If `requiresAcceptance && acceptedAt`:
  ```text
  Acknowledged {date}
  ```

- If `requiresAcceptance && declinedAt`:
  ```text
  Disputed {date}
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
Values: "All", "Pending", "Acknowledged", "Disputed", "Not required"

The "Disputed" state is now queryable via `custody.declinedAt IS NOT NULL`.

---

## Phase 10: In-App Acknowledgement for Logged-In Users

### 10.1 Acknowledgement banner component

**New file:** `apps/webapp/app/components/custody/acknowledgement-banner.tsx`

A dismissible banner shown at the top of the assets list:
```text
You have {count} items awaiting your acknowledgement. [Review & Acknowledge]
```

### 10.2 Acknowledge in-app route

**New file:** `apps/webapp/app/routes/_layout+/custody.acknowledge.tsx`

Page listing all of the current user's pending acknowledgements.
- Shows asset image, title, assigned date, assigner name
- "Acknowledge" button per item + "Acknowledge All" button
- Uses `recordCustodyAcknowledgement()` with method "in_app"

### 10.3 Permission bypass for acknowledgement (in-app mode)

The in-app acknowledge route uses **session-based auth** (see Phase 5.2 for the two auth modes).

The acknowledge action needs to work for BASE and SELF_SERVICE users who are the custodian.
This is NOT a general custody permission — it's: "you can acknowledge YOUR OWN custody."

**Organization-scoped verification (prevents cross-org attacks):**
1. Get `organizationId` from session context (current workspace)
2. Find the current user's TeamMember within that org: `db.teamMember.findFirst({ where: { userId, organizationId } })`
3. When querying pending custodies: scope via `asset: { organizationId }` AND `teamMemberId: currentTeamMember.id`
4. When acknowledging: verify `custody.teamMemberId === currentTeamMember.id` AND `custody.asset.organizationId === organizationId`

This ensures users cannot acknowledge custodies from other organizations, even if they're a custodian there too.

- The public token route (Phase 5) does NOT enforce org scoping — the token IS the authority there

### 10.4 Layout integration

**File:** `apps/webapp/app/routes/_layout+/assets._index.tsx` (loader)

Add a query for count of pending acknowledgements for the current user's team member.
Pass to the banner component.

---

## Phase 11: Resend & Copy Link API

**New file:** `apps/webapp/app/routes/api+/custody.acknowledgement.ts`

Handles:
- `POST` with intent `resend-email`: Generates **new** token (rotates — updates `tokenIssuedAt`, invalidating old link), re-sends email
- `POST` with intent `copy-link`: Generates **new** token (rotates), returns the signed URL for clipboard copy
- Requires `PermissionAction.custody` on `PermissionEntity.asset` (admin only)

Token rotation on every resend/copy ensures old links stop working, limiting exposure window.

**Rate limiting:** Enforce a per-custody cooldown (e.g., 1 resend per 60 seconds) to prevent abuse from compromised admin sessions or excessive link churn. Return a clear error: "Please wait before resending. Last sent X seconds ago." Check `tokenIssuedAt` timestamp — if less than 60 seconds ago, reject.

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
| Activity note = permanent record (no raw PII) | Custody records hard-deleted on release. Note stores summary (name, timestamp, method). Raw IP/UA only on ephemeral Custody fields — auto-purged on release. |
| 30-day token expiry + rotation on resend | Limits exposure window. `tokenIssuedAt` on Custody rejects old tokens after resend. |
| Token is sole authority (not URL param) | Decoded JWT `id` used for all DB lookups. URL `custodyId` is routing only. Prevents mismatch attacks. |
| Two auth modes: public token vs in-app session | Public route: token = authority, no login needed. In-app route: session + teamMember match = authority. Clear separation. |
| Batch key for bulk acknowledgement | `acknowledgementBatchId` groups custody records. One token covers the batch. Resend/copy-link target the batch reliably. |
| Persisted decline state | `declinedAt` + `declineReason` on Custody makes "Disputed" queryable and filterable. |
| Narrow public path | `/accept-custody/:custodyId` — no wildcard. Minimal exposure surface. |
| Dedicated CUSTODY_TOKEN_SECRET | Separate secret prevents token confusion with invite tokens (invite verifier doesn't check `purpose`). |
| Token rotation inside verifier | `verifyCustodyAcknowledgementToken()` checks `tokenIssuedAt` internally — callers cannot forget. |
| PII auto-cleanup after 2 years | Scheduled job nulls IP/UA on old custodies. Covers never-released assignments. |
| Org-scoped in-app acknowledgement | In-app route verifies custody belongs to current session org. Prevents cross-org attacks. |
| Feature gated per-org (boolean switch) | Same infra as barcode/audit. Included in Plus/Team by default. Free users see upsell to upgrade. Not a separate purchase — just tier-gated. |
| Self-assignment hides checkbox | Can't corroborate receipt from the person who assigned. |
| One email per custodian for bulk | Not spammy. One acknowledge-all click via batch token. |
| Kit acknowledgement cascades | One click updates KitCustody + all child Custody records in transaction. |
| BASE users can acknowledge own custody | Permission bypass in in-app mode: if you ARE the custodian, you can acknowledge. Not a general custody permission. |
| Non-registered members get copy-link only | No email field on TeamMember. Admin copies link, sends manually. |
| Column hidden by default | Opt-in visibility. Admins who use the feature toggle it on. |
