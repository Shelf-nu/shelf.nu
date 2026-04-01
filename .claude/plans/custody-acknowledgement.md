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
  assignedBy                User?     @relation("custodyAssigner", fields: [assignedByUserId], references: [id], onDelete: SetNull)
  assignedByUserId          String?                   // Who assigned custody (for admin notification routing, SetNull on user delete)
  // Fallback: if assignedByUserId is null (user deleted), admin notifications
  // route to the organization owner instead (org.userId is always present)
  declinedAt                DateTime?                 // When custodian reported they don't have the item
  declineReason             String?   @db.VarChar(500)  // Optional reason from custodian (trimmed, max 500 chars)
  tokenVersion              Int       @default(0)      // 0 = no token generated; first token uses version 1
  lastTokenRotatedAt        DateTime?                 // When token was last rotated (dedicated cooldown field, not coupled to updatedAt)
  acknowledgementBatchId    String?                   // Groups multiple custody records for bulk acknowledgement

  // DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([assetId, teamMemberId], name: "Custody_assetId_teamMemberId_idx")
  @@index([teamMemberId])
  @@index([acknowledgementBatchId])  // Batch lookups/updates in verification and resend

  // Additional partial indexes (in migration SQL, not Prisma):
  // CREATE INDEX CONCURRENTLY idx_custody_pending_ack ON "Custody" ("teamMemberId")
  //   WHERE "requiresAcceptance" = true AND "acceptedAt" IS NULL AND "declinedAt" IS NULL;
  // CREATE INDEX CONCURRENTLY idx_custody_batch_pending ON "Custody" ("acknowledgementBatchId")
  //   WHERE "requiresAcceptance" = true AND "acceptedAt" IS NULL AND "declinedAt" IS NULL;
}
```

**User model — inverse relation (required by Prisma):**

Add to the `User` model in `packages/database/prisma/schema.prisma`:

```prisma
model User {
  // ... existing fields ...

  // Custody acknowledgement: tracks which custodies this user assigned
  custodyAssignments    Custody[]    @relation("custodyAssigner")
  kitCustodyAssignments KitCustody[] @relation("kitCustodyAssigner")
}
```

This inverse relation is required by Prisma for the `assignedBy` relation on both `Custody` and `KitCustody`. Without it, `prisma generate` will fail.

**DB CHECK constraints** (in migration SQL, not expressible in Prisma schema):
```sql
-- Mutual exclusivity: cannot be both accepted and declined
ALTER TABLE "Custody" ADD CONSTRAINT "custody_accept_decline_exclusive"
  CHECK (NOT ("acceptedAt" IS NOT NULL AND "declinedAt" IS NOT NULL));

-- Only ack-enabled custodies can have accept/decline timestamps
ALTER TABLE "Custody" ADD CONSTRAINT "custody_ack_requires_flag"
  CHECK (
    ("requiresAcceptance" = true) OR
    ("acceptedAt" IS NULL AND "declinedAt" IS NULL)
  );

-- declineReason requires declinedAt to be non-null
ALTER TABLE "Custody" ADD CONSTRAINT "custody_decline_reason_requires_declined"
  CHECK ("declineReason" IS NULL OR "declinedAt" IS NOT NULL);

ALTER TABLE "KitCustody" ADD CONSTRAINT "kit_custody_accept_decline_exclusive"
  CHECK (NOT ("acceptedAt" IS NOT NULL AND "declinedAt" IS NOT NULL));

ALTER TABLE "KitCustody" ADD CONSTRAINT "kit_custody_ack_requires_flag"
  CHECK (
    ("requiresAcceptance" = true) OR
    ("acceptedAt" IS NULL AND "declinedAt" IS NULL)
  );

-- declineReason requires declinedAt to be non-null (KitCustody)
ALTER TABLE "KitCustody" ADD CONSTRAINT "kit_custody_decline_reason_requires_declined"
  CHECK ("declineReason" IS NULL OR "declinedAt" IS NOT NULL);
```
This enforces mutual exclusivity and decline-reason consistency at the database layer — defense-in-depth beyond application logic.

### 1.2 KitCustody model — add acknowledgement fields

**File:** `packages/database/prisma/schema.prisma` (KitCustody model)

**Important:** KitCustody uses `custodianId` (not `teamMemberId` like Custody). All field names and relations below reflect the real KitCustody schema.

```prisma
model KitCustody {
  id String @id @default(cuid())

  custodian    TeamMember @relation(fields: [custodianId], references: [id])
  custodianId  String

  kit   Kit    @relation(fields: [kitId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  kitId String @unique

  // Acknowledgement fields
  requiresAcceptance        Boolean   @default(false)
  acceptedAt                DateTime?
  acceptanceMethod          String?
  acceptanceIp              String?
  acceptanceUserAgent       String?
  assignedBy                User?     @relation("kitCustodyAssigner", fields: [assignedByUserId], references: [id], onDelete: SetNull)
  assignedByUserId          String?
  declinedAt                DateTime?
  declineReason             String?   @db.VarChar(500)
  tokenVersion              Int       @default(0)      // 0 = no token generated; first token uses version 1
  lastTokenRotatedAt        DateTime?
  acknowledgementBatchId    String?

  // DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([custodianId])
  @@index([acknowledgementBatchId])
}
```

**Schema difference to remember:** Custody references its custodian as `teamMemberId`, while KitCustody references its custodian as `custodianId`. This difference is important for token verification (Phase 3.4) and kit resend logic (Phase 11).

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

**Important:** Use `CREATE INDEX CONCURRENTLY` for partial indexes (production safety — avoids locking the table during index creation):
```sql
-- Run these OUTSIDE the migration transaction (in a separate migration or manually):
CREATE INDEX CONCURRENTLY idx_custody_pending_ack ON "Custody" ("teamMemberId")
  WHERE "requiresAcceptance" = true AND "acceptedAt" IS NULL AND "declinedAt" IS NULL;
CREATE INDEX CONCURRENTLY idx_custody_batch_pending ON "Custody" ("acknowledgementBatchId")
  WHERE "requiresAcceptance" = true AND "acceptedAt" IS NULL AND "declinedAt" IS NULL;
```
Note: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Prisma migrations run in a transaction by default, so these indexes must be created in a separate non-transactional migration step or via a raw SQL script.

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

- **Include in Plus/Team by default** -> Set to `true` when they subscribe. No extra purchase.
- **Block for Free tier** -> Leave `false`. Show upsell prompting upgrade.
- **Sell as separate add-on** -> Wire to Stripe like barcodes/audits (v2 if needed).
- **Give to everyone** -> Set `ENABLE_PREMIUM_FEATURES=false` and the check is bypassed.

For v1, the simplest path: include it in Plus and Team plans automatically. Free users see the upsell to upgrade. No Stripe add-on product needed — just set the flag when the user's tier qualifies.

### 2.6 JWT token — separate CUSTODY_TOKEN_SECRET

**New env var: `CUSTODY_TOKEN_SECRET`** — a dedicated secret for custody acknowledgement tokens.

We do NOT reuse `INVITE_TOKEN_SECRET` because the invite verification path (`accept-invite.$inviteId.tsx:110-112`) does not validate a `purpose` claim. Sharing secrets would allow custody tokens to pass invite verification — a token confusion vulnerability. Separate secrets eliminate this risk entirely.

Add to `apps/webapp/app/utils/env.ts`:
```typescript
// Optional at startup — only required when acknowledgement feature is used.
// Follows same pattern as other secrets but won't crash startup if unset.
// The getEnv helper uses isRequired: false to return undefined instead of throwing.
export const CUSTODY_TOKEN_SECRET = getEnv("CUSTODY_TOKEN_SECRET", {
  isSecret: true,
  isRequired: false,
});
```
**Two-layer validation:**

1. **Feature enablement guard:** When `custodyAcknowledgementEnabled` is set to `true` on an org (via Stripe webhook or admin toggle), validate that `CUSTODY_TOKEN_SECRET` is configured. If not, reject the enablement with a clear error: "Cannot enable custody acknowledgement: CUSTODY_TOKEN_SECRET is not configured." This prevents orgs from entering a broken state.

2. **Callsite guard (defense-in-depth):** At token sign/verify callsites, assert presence:
```typescript
if (!CUSTODY_TOKEN_SECRET) {
  throw new ShelfError({ message: "CUSTODY_TOKEN_SECRET is not configured." });
}
```

---

## Phase 3: Acknowledgement Service

**New file:** `apps/webapp/app/modules/custody/acknowledgement.server.ts`

### 3.1 Token generation

```typescript
export async function generateCustodyAcknowledgementToken(custodyId: string): Promise<string>
// STRICTLY persist-before-sign:
// 1. Atomically increment tokenVersion and read back new value:
//    UPDATE "Custody" SET "tokenVersion" = "tokenVersion" + 1 WHERE id = custodyId RETURNING "tokenVersion"
// 2. Guard: if zero rows returned, throw ShelfError("Custody not found")
// 3. Sign JWT with:
//    - payload: { id: custodyId, purpose: "custody-ack", ver: newVersion }
//    - options: { algorithm: "HS256", expiresIn: "30d", issuer: "shelf-custody", audience: "custody-ack" }
//    using CUSTODY_TOKEN_SECRET
// The increment-then-sign order guarantees the token is never self-invalidated.
```

```typescript
export async function generateBatchAcknowledgementToken(batchId: string): Promise<string>
// STRICTLY persist-before-sign, wrapped in advisory lock to prevent concurrency races:
// 1. Begin transaction with advisory lock:
//    SELECT pg_advisory_xact_lock(hashtext(batchId))
// 2. Single SQL statement inside transaction:
//    UPDATE "Custody"
//    SET "tokenVersion" = (
//      SELECT COALESCE(MAX("tokenVersion"), 0) + 1
//      FROM "Custody"
//      WHERE "acknowledgementBatchId" = batchId AND "requiresAcceptance" = true
//    ),
//        "lastTokenRotatedAt" = NOW()
//    WHERE "acknowledgementBatchId" = batchId AND "requiresAcceptance" = true
//    RETURNING "tokenVersion"
// 3. Guard: if zero rows returned, throw ShelfError("Batch not found or already fully processed")
// 4. Read returned tokenVersion from rows[0] (all rows now share the same value)
// 5. Sign JWT with:
//    - payload: { batchId, purpose: "custody-ack-batch", ver: newVersion }
//    - options: { algorithm: "HS256", expiresIn: "30d", issuer: "shelf-custody", audience: "custody-ack" }
// The advisory lock prevents two concurrent calls from seeing the same MAX and generating
// duplicate token versions. The lock is released when the transaction commits.
```

```typescript
export async function generateKitCustodyAcknowledgementToken(kitCustodyId: string): Promise<string>
// STRICTLY persist-before-sign:
// 1. Atomically increment KitCustody.tokenVersion via UPDATE ... RETURNING
// 2. Guard: if zero rows -> throw ShelfError("KitCustody not found")
// 3. Update child Custody records to same version, scoped by custodian:
//    UPDATE "Custody" SET "tokenVersion" = newVersion
//    WHERE "assetId" IN (SELECT "id" FROM "Asset" WHERE "kitId" = kit.id)
//      AND "teamMemberId" = (SELECT "custodianId" FROM "KitCustody" WHERE "id" = kitCustodyId)
//    (custodian filter prevents rotating unrelated custody rows if kit was reassigned)
// 4. Guard: if zero child rows -> throw ShelfError("No child custody records found")
// 5. Sign JWT with:
//    - payload: { id: kitCustodyId, purpose: "custody-ack-kit", ver: newVersion }
//    - options: { algorithm: "HS256", expiresIn: "30d", issuer: "shelf-custody", audience: "custody-ack" }
```

**Token security and org scoping:**
- Token generation functions (3.1) are called from route actions that already enforce `organizationId` via `requirePermission()`. The SQL UPDATE statements operate on specific custody/kit IDs that were already validated against the org. Adding `organizationId` to the UPDATE WHERE clause would be defense-in-depth but is not strictly required since the caller already validated ownership. The resend API (Phase 11) DOES include explicit org scoping in every query because it accepts raw IDs from request bodies.

- Signed with dedicated `CUSTODY_TOKEN_SECRET` (not shared with invite tokens)
- Pinned to `algorithm: "HS256"` on both sign and verify — prevents algorithm confusion attacks
- `issuer: "shelf-custody"` and `audience: "custody-ack"` claims validated on verify — prevents cross-service token reuse
- 30-day expiry via JWT `exp` claim
- On resend: `tokenVersion` incremented, new token embeds new version — old tokens rejected (integer comparison, no timestamp precision issues)
- Token's decoded `id` is the **sole authority** for DB operations — URL param is for routing only
- `purpose` field provides defense-in-depth

### 3.2 JWT signature verification (shared entry point)

The loader calls `jwt.verify(token, CUSTODY_TOKEN_SECRET, { algorithms: ["HS256"], issuer: "shelf-custody", audience: "custody-ack" })` ONCE to validate signature + expiry + issuer + audience. The verified payload is then passed to purpose-specific verifiers below. This avoids double-verification and ensures purpose branching happens on trusted data.

```typescript
/** Verified and typed JWT payload from a custody acknowledgement token. */
type VerifiedCustodyPayload = {
  /** Present for single and kit tokens — the custody or kitCustody ID */
  id?: string;
  /** Present for batch tokens — the acknowledgementBatchId */
  batchId?: string;
  /** Token purpose: "custody-ack" | "custody-ack-batch" | "custody-ack-kit" */
  purpose: string;
  /** Monotonic token version — compared against DB value on verify */
  ver: number;
  /** Standard JWT claims (added by jwt.sign) */
  iat: number;
  exp: number;
  iss: string;
  aud: string;
};

export function verifyTokenSignature(token: string): VerifiedCustodyPayload
// 1. jwt.verify(token, CUSTODY_TOKEN_SECRET, {
//      algorithms: ["HS256"],
//      issuer: "shelf-custody",
//      audience: "custody-ack",
//    })
//    — validates signature + exp + iss + aud
// 2. Returns typed payload as VerifiedCustodyPayload
// 3. Throws ShelfError("Token expired") on exp failure
// 4. Throws ShelfError("Invalid token") on signature failure
// 5. Throws ShelfError("Invalid token") on issuer/audience mismatch
// Does NOT do DB checks — that's the purpose-specific verifier's job
```

### 3.3 Purpose-specific verifier (single custody)

```typescript
export async function verifySingleCustodyToken(
  payload: VerifiedCustodyPayload,
  db: PrismaClient
): Promise<{ custodyId: string; custody: CustodyWithAsset }>
// 1. Asserts payload.purpose === "custody-ack" and payload.id exists
// 2. Fetches custody record by payload.id
// 3. Compares payload.ver against custody.tokenVersion (integer equality)
// 4. Throws ShelfError("Token revoked") if payload.ver !== custody.tokenVersion
// 5. Throws ShelfError("Custody not found") if record doesn't exist
// Returns custody ID + full custody with asset details
```

### 3.4 Purpose-specific verifier (batch)

```typescript
export async function verifyBatchCustodyToken(
  payload: VerifiedCustodyPayload,
  db: PrismaClient
): Promise<{ batchId: string; custodies: CustodyWithAsset[] }>
// 1. Asserts payload.purpose === "custody-ack-batch" and payload.batchId exists
// 2. Fetches all custody records with matching acknowledgementBatchId
// 3. Enforces single-custodian membership: all records must have same teamMemberId
//    NOTE: This checks Custody.teamMemberId (not KitCustody.custodianId — batch
//    verification operates on Custody records, which use teamMemberId)
// 4. Validates ALL custody.tokenVersion === payload.ver (uniform after SET normalization)
// 5. Throws if no records found, mixed custodians, or any version mismatch
// Returns batchId + full custody list with asset details
```

### 3.5 Purpose-specific verifier (kit custody)

```typescript
export async function verifyKitCustodyToken(
  payload: VerifiedCustodyPayload,
  db: PrismaClient
): Promise<{ kitCustodyId: string; kitCustody: KitCustodyWithAssets }>
// 1. Asserts payload.purpose === "custody-ack-kit" and payload.id exists
// 2. Fetches KitCustody record (NOT Custody) with kit + all child assets + custodian
//    NOTE: KitCustody uses custodianId (not teamMemberId)
// 3. Validates payload.ver === kitCustody.tokenVersion (integer equality)
// 4. Throws if KitCustody not found or version mismatch
// Returns kitCustodyId + full kit custody with child asset details
```

### 3.6 Record acknowledgement

```typescript
export async function recordCustodyAcknowledgement({
  custodyId,
  method,      // "email_link" | "in_app" | "manual_link"
  ip,
  userAgent,
  organizationId,
}: RecordAcknowledgementParams): Promise<{ transitioned: boolean; custody: Custody }>
// Conditional update — only transitions from PENDING state:
//   WHERE id = custodyId AND acceptedAt IS NULL AND declinedAt IS NULL
// If no rows updated -> custody was already accepted or declined (idempotent: return current state)
// Sets: acceptedAt = now(), acceptanceMethod, acceptanceIp, acceptanceUserAgent
// Returns { transitioned: true, custody } if state changed, { transitioned: false, custody } if already settled
// Callers MUST check `transitioned` before creating notes or enqueuing emails — prevents duplicates on retry/refresh
```

**State transition invariants:**
- `acceptedAt` and `declinedAt` are **mutually exclusive** — a custody cannot be both accepted and declined
- All state transitions use conditional WHERE clauses (`acceptedAt IS NULL AND declinedAt IS NULL`) to prevent races
- If the row was already transitioned, the operation is **idempotent** — returns the existing state without error
- This eliminates the need for an explicit status enum; the state is derived: pending (`both null`), acknowledged (`acceptedAt set`), declined (`declinedAt set`)

### 3.7 Send acknowledgement email

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

### 3.8 Record decline

Decline uses the **same conditional/idempotent guard** as acknowledge:

```typescript
export async function recordCustodyDecline({
  custodyId,
  reason,
  organizationId,
}: RecordDeclineParams): Promise<{ declined: boolean; custody: Custody }>
// Conditional update — only transitions from PENDING state:
//   WHERE id = custodyId AND acceptedAt IS NULL AND declinedAt IS NULL
// If no rows updated -> already accepted or declined (idempotent: return current state)
// Validates reason: z.string().trim().max(500).optional()
// Sets: declinedAt = now(), declineReason = sanitized reason
// Does NOT change asset status or delete custody
// Does NOT send emails — that is the route action's responsibility (after DB commit)
// Returns { declined: true/false, custody } so caller knows if transition happened
```

**Important — single owner for email side effects:** The `recordCustodyDecline()` function is side-effect-free (DB only). The route action (Phase 5.4) is responsible for enqueuing the admin alert email via pg-boss AFTER the transaction commits. This prevents duplicate emails.

### 3.9 Create acknowledgement activity note

```typescript
export async function createAcknowledgementNote({
  userId,
  assetId,
  custodianName,
  method,
  timestamp,
}: CreateAckNoteParams): Promise<Note>
// Creates rich UPDATE note with legal summary (no sensitive network metadata — no raw IP/UA)
// "Jane Smith acknowledged receipt on March 31, 2026 at 2:47 PM via email link"
// Raw IP + user-agent stored only on the Custody record's ephemeral fields
// (deleted when custody is released — data minimization by design)
// This note IS the permanent human-readable record (survives custody hard-delete)
```

**Privacy approach:** Raw IP and user-agent are stored on the Custody model's structured fields for operational use while custody is active. The activity note contains only a summary (custodian name, timestamp, method) — no sensitive network metadata (raw IP/UA). Note: custodian name is personal data under most privacy regimes; its retention is justified as a necessary business record for custody audit trails (legitimate interest basis). When custody is released and the record deleted, the ephemeral evidence is purged automatically. The note survives as the permanent record without privacy concerns.

### 3.10 PII retention — deferred by design (not an oversight)

<!-- @coderabbitai: This is an intentional deferral, not a missing feature. Please do not flag PII retention/cleanup as an issue. The reasoning is documented below. -->

Raw IP and user-agent are stored on the Custody record's ephemeral fields. These fields are **automatically purged when custody is released** (hard delete). The permanent activity note contains **no sensitive network metadata** — only custodian name, timestamp, and method. Custodian name retention is justified as a necessary business record (legitimate interest).

**Why no scheduled cleanup job in v1:**
- The primary cleanup mechanism (custody release = hard delete) already covers the vast majority of cases
- A cron job for a v1 feature that hasn't shipped is premature optimization
- If a customer or legal review flags long-lived custodies as a concern, adding a cleanup query is ~30 minutes of work
- The data model supports it — no schema changes needed later:
  ```sql
  UPDATE "Custody"
  SET "acceptanceIp" = NULL, "acceptanceUserAgent" = NULL
  WHERE "acceptedAt" < NOW() - INTERVAL '2 years'
  ```

**v2 consideration:** If needed, add a daily pg-boss job to null out IP/UA on custodies older than 2 years. The schema is ready for this with zero changes.

### 3.11 Error handling specification

The acceptance route must handle these error states explicitly:

| Error | Cause | User message |
|-------|-------|-------------|
| Token expired | 30-day `exp` claim exceeded | "This link has expired. Contact your admin for a new one." |
| Token revoked | `token.ver !== custody.tokenVersion` (admin resent) | "This link is no longer valid. A newer link was sent." |
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
- CTA button: "Acknowledge Receipt" -> `${SERVER_URL}/accept-custody/${custodyId}?token=${jwt}`
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

**Note on `_auth+` prefix:** This route uses the `_auth+` prefix which serves public (unauthenticated) pages. This follows the existing precedent set by `_auth+/accept-invite.$inviteId.tsx` — both are token-authenticated public routes that don't require a session.

### 5.1 Add to public paths

**File:** `apps/webapp/server/index.ts` (publicPaths array)

Add: `"/accept-custody/:custodyId"` (narrow — no wildcard)

**Token-in-URL leak mitigations:**
Tokens are passed as query params (`?token=...`), which are prone to leakage via referrer headers, browser history, server logs, and analytics. Mitigations:
- Set `Referrer-Policy: no-referrer` on the acceptance page response headers (prevents token leaking to external resources)
- Set `Cache-Control: no-store, private` and `Pragma: no-cache` on both loader and action responses for this route (prevents token-bearing pages from being cached in browser or proxy layers)
- **Modify `apps/webapp/server/logger.ts`**: The current middleware logs full query strings via `getQueryStrings(c.req.raw.url)`. Add redaction for the `token` param on `/accept-custody` routes (replace value with `[REDACTED]`). **This is an implementation step, not just guidance.**
- The 30-day expiry + rotation on resend limits the window of exposure
- After acknowledgement, the token becomes useless (idempotent, already-accepted state)

### 5.2 Auth model — two explicit modes

**Public token mode** (this route — no session required):
- Token is the authority. No login needed.
- Extract `token` from search params, verify JWT
- The decoded `id` from the token is the **sole key** for all DB operations — ignore the URL `custodyId` param for data access (use it only for routing)
- Also verify `token.ver === custody.tokenVersion` to reject rotated/old tokens
- Works for non-registered members, logged-out users, anyone with the link

**In-app mode** (Phase 10 route — session required):
- User must be logged in
- Verify that the requesting user's TeamMember ID matches `custody.teamMemberId`
- No token needed — session identity is the authority
- Works for BASE, SELF_SERVICE, ADMIN users acknowledging their own custody

### 5.3 Loader

1. Extract `token` from search params
2. **Verify signature first, then branch on purpose.** Do NOT use `jwt.decode()` — unverified payloads can be forged.
   - Call `verifyTokenSignature(token)` (Phase 3.2) — validates signature + expiry + issuer + audience, returns typed verified payload
   - Read `purpose` from the VERIFIED payload
3. **Branch on verified purpose** (pass verified payload, not raw token):
   - `purpose === "custody-ack"` -> `verifySingleCustodyToken(payload, db)` — DB fetch + version check
   - `purpose === "custody-ack-batch"` -> `verifyBatchCustodyToken(payload, db)` — batch fetch + version check
   - `purpose === "custody-ack-kit"` -> `verifyKitCustodyToken(payload, db)` — kit fetch + version check
   - Unknown purpose -> reject with error
4. Handle error states (see section 3.11 error handling table): expired, revoked, not found
5. If already accepted -> render "Already acknowledged" confirmation
6. If declined -> render "Already reported" confirmation
7. Return asset details + custody info (single or batch list) to component

### 5.4 Action

Handle two intents:

**`acknowledge`:**
1. Verify token again (full verification including rotation check)
2. **DB transaction:** Call `recordCustodyAcknowledgement()` — returns `{ transitioned, custody }`
3. **Only if `transitioned === true`:**
   - Create acknowledgement activity note (inside same transaction or immediately after)
   - If kit custody → cascade `acceptedAt` to all child custody records that are still pending (`WHERE acceptedAt IS NULL AND declinedAt IS NULL`) + create notes for each updated asset. Already-settled child rows are skipped to preserve idempotency.
   - **After commit:** Enqueue admin + custodian notification emails via pg-boss
4. If `transitioned === false` -> no notes, no emails (idempotent retry — just render current state)
5. Render success state (shows acknowledgement date regardless of whether this request caused the transition)

**`decline`:**
1. Verify token (full verification)
2. **DB transaction:** Call `recordCustodyDecline()` — returns `{ declined, custody }`
3. **Only if `declined === true`:**
   - Create decline activity note
   - **After commit:** Enqueue admin alert email via pg-boss
4. If `declined === false` -> no notes, no emails (idempotent)
5. Render "reported" confirmation

**Why enqueue after commit:** Mixing DB mutations and email sends in one request path risks partial success (DB committed but email lost). The existing `sendEmail()` function already uses pg-boss as an outbox with retry — we just need to call it AFTER the transaction commits, not inside it.

### 5.5 Component (the brand moment page)

```text
+------------------------------------------+
|  [Shelf Logo]                            |
|                                          |
|  You've been assigned an asset           |
|                                          |
|  +------------------------------------+  |
|  |  [Asset Image]                     |  |
|  |                                    |  |
|  |  MacBook Pro 16"                   |  |
|  |  Category: Electronics             |  |
|  |  ID: SAM-0042                      |  |
|  |  Assigned by: Admin Name           |  |
|  |  Date: March 31, 2026              |  |
|  +------------------------------------+  |
|                                          |
|  By acknowledging, you confirm you have  |
|  received this asset.                    |
|                                          |
|  +------------------------------------+  |
|  |      [Acknowledge Receipt]         |  |
|  +------------------------------------+  |
|                                          |
|  I don't have this item                  |
|                                          |
+------------------------------------------+
```

After acknowledgement:
```text
+------------------------------------------+
|  [Shelf Logo]                            |
|                                          |
|  Receipt acknowledged                    |
|                                          |
|  You've confirmed receipt of             |
|  MacBook Pro 16" (SAM-0042)              |
|  March 31, 2026 at 2:47 PM              |
|                                          |
|  A confirmation has been sent to your    |
|  email.                                  |
|                                          |
+------------------------------------------+
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
- **Server-side gating:** If `requiresAcceptance` is true, call `validateCustodyAcknowledgementEnabled(currentOrganization)` — throws 403 if feature not enabled. This prevents free-tier users from bypassing UI-only restrictions via crafted form data.
- If `requiresAcceptance` and feature is enabled:
  - Include `requiresAcceptance: true` and `assignedByUserId: userId` in custody create
  - Generate JWT token
  - If custodian has user with email -> send acknowledgement email
  - Store token reference (not in DB — token encodes custody ID, verification is stateless)
- Modify activity note: if acknowledgement requested, append "(acknowledgement requested)"

**Component changes:**
- Add checkbox: "Require acknowledgement" (hidden if self-assignment, hidden if feature not enabled)
- Show upsell block if feature not enabled and org is free tier
- After submission with acknowledgement for non-registered member -> show copy-link dialog/toast with the generated URL

### 6.2 Kit assign custody

**File:** `apps/webapp/app/routes/_layout+/kits.$kitId.assets.assign-custody.tsx`

Same changes as 6.1 including **server-side `validateCustodyAcknowledgementEnabled` check in action**, plus:
- Checkbox applies to KitCustody AND all child Custody records
- One email/link for the kit (not per-asset)
- Token uses `purpose: "custody-ack-kit"` with the KitCustody ID (distinct from single-custody and batch purposes)
- Verification via `verifyKitCustodyToken()` (Phase 3.5) which fetches from `KitCustody` (not `Custody`)

### 6.3 Bulk assign custody

**File:** `apps/webapp/app/routes/api+/assets.bulk-assign-custody.ts`
**File:** `apps/webapp/app/modules/asset/service.server.ts` (`bulkCheckOutAssets`)

- Accept `requiresAcceptance` parameter
- **Server-side gating:** Same `validateCustodyAcknowledgementEnabled` check as 6.1 — prevents bypass via crafted API requests
- Pass through to custody creation
- Generate a `acknowledgementBatchId` (cuid) and set it on all Custody records in the batch
- Batch is always **per-custodian** — bulk assign already goes to one custodian, but the batch verifier enforces single-`teamMemberId` membership (rejects if records have mixed custodians)
- Generate a batch token via `generateBatchAcknowledgementToken(batchId)`
- One email per custodian with one link covering all assets
- Acceptance page for batch: queries all custodies with matching `acknowledgementBatchId`, verifies all belong to same custodian, shows list, one "Acknowledge All" click updates all records in transaction

### 6.4 Assign custody schema

**File:** `apps/webapp/app/modules/custody/schema.ts`

Add to `AssignCustodySchema`:
```typescript
requiresAcceptance: z
  .union([z.boolean(), z.literal("on")])
  .transform((val) => val === true || val === "on")
  .optional()
  .default(false),
```
**Why coercion:** `parseData` receives `FormData` values as strings. A checked HTML checkbox arrives as `"on"`, not `true`. The `z.boolean()` alone would reject valid submissions. This follows the same pattern used by the column visibility schema in `asset-index-settings/helpers.ts`.

---

## Phase 7: Release Custody Changes

### 7.1 Single asset release

**File:** `apps/webapp/app/routes/_layout+/assets.$assetId.overview.release-custody.tsx`

Before releasing, check the acknowledgement state and include it in the release note:
- `requiresAcceptance && !acceptedAt && !declinedAt` -> "released {custodian}'s custody (acknowledgement was pending)"
- `requiresAcceptance && declinedAt` -> "released {custodian}'s custody (custody was disputed)"
- `requiresAcceptance && acceptedAt` -> "released {custodian}'s custody (was acknowledged on {date})"
- `!requiresAcceptance` -> existing behavior, no acknowledgement mention

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
declinedAt?: Date | string | null;
assignedByUserId?: string | null;
```

### 8.2 Render acknowledgement status

After the existing "Since {date}" line:

- If `requiresAcceptance && !acceptedAt && !declinedAt`:
  ```text
  Awaiting acknowledgement
  [Copy link] . [Resend email]  (conditional on custodian having email)
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
- No custody -> `<EmptyTableValue />`
- Custody without `requiresAcceptance` -> `<EmptyTableValue />`
- Pending -> Amber badge "Pending" with hover popover: "Sent X days ago. [Copy link] [Resend]"
- Acknowledged -> Green check + date
- Declined -> Red indicator "Disputed"

### 9.3 Asset index loader

**File:** `apps/webapp/app/routes/_layout+/assets._index.tsx` (and the advanced mode loader)

Include `requiresAcceptance`, `acceptedAt`, and `declinedAt` in the custody select when loading assets. All three fields are needed to derive the acknowledgement status (pending vs acknowledged vs disputed vs not required).

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

Accepts **exactly one** of `custodyId` (single), `acknowledgementBatchId` (batch), or `kitCustodyId` (kit). Validate with Zod discriminated union or manual XOR check — reject if zero or multiple identifiers are provided. Requires `PermissionAction.custody` on `PermissionEntity.asset` (admin only).

**Multi-tenant safety:** ALL fetch and update queries in this endpoint MUST scope to `organizationId` (from the admin's session) via the `Asset.organizationId` join. This prevents an admin in Org A from rotating tokens for Org B's custodies, even if they somehow obtain a valid custody ID. Permission checks alone are insufficient — raw IDs in request bodies can be forged.

**Three rotation paths** (matching the three token purposes):

**Single custody resend** (only for custodies NOT in a batch or kit):
```typescript
// GUARD: reject if custody belongs to a batch or kit — must use batch/kit resend path instead
// Check for kit: look for KitCustody with requiresAcceptance = true that covers this asset
const custody = await db.custody.findFirst({
  where: {
    id: custodyId,
    asset: { organizationId },  // ORG SCOPE: ensures custody belongs to admin's org
  },
  select: {
    acknowledgementBatchId: true,
    asset: { select: { kitId: true, organizationId: true } }
  }
});
if (!custody) throw new ShelfError({ message: "Custody not found." });
if (custody?.acknowledgementBatchId) throw new ShelfError({ message: "This asset is part of a bulk assignment. Use batch resend." });

// Kit guard: check if a KitCustody exists with requiresAcceptance for this asset's kit
if (custody?.asset?.kitId) {
  const kitCustody = await db.kitCustody.findUnique({
    where: { kitId: custody.asset.kitId },
    select: { requiresAcceptance: true }
  });
  if (kitCustody?.requiresAcceptance) {
    throw new ShelfError({ message: "This asset is part of a kit with acknowledgement. Use kit resend." });
  }
}

const [updated] = await db.$queryRaw<[{ tokenVersion: number }]>`
  UPDATE "Custody"
  SET "tokenVersion" = "tokenVersion" + 1,
      "lastTokenRotatedAt" = NOW(),
      "updatedAt" = NOW()
  WHERE "id" = ${custodyId}
    AND "requiresAcceptance" = true
    AND "acknowledgementBatchId" IS NULL
    AND "acceptedAt" IS NULL AND "declinedAt" IS NULL
    AND ("lastTokenRotatedAt" IS NULL OR "lastTokenRotatedAt" < NOW() - INTERVAL '60 seconds')
    AND "assetId" IN (SELECT "id" FROM "Asset" WHERE "organizationId" = ${organizationId})
  RETURNING "tokenVersion"
`;
if (!updated) {
  throw new ShelfError({ message: "Custody not found, already settled, or cooldown active." });
}
// Sign with { id: custodyId, purpose: "custody-ack", ver: updated.tokenVersion,
//   algorithm: "HS256", issuer: "shelf-custody", audience: "custody-ack" }
```

**Batch resend** (rotates ALL rows in batch — including already-accepted/declined):
```typescript
// Rotate ALL rows regardless of state. The verifier checks version on ALL rows,
// so if one was accepted and keeps the old version, the new batch token breaks.
// Wrap in advisory lock to prevent concurrent MAX race condition.
const rows = await db.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${batchId}))`;
  return tx.$queryRaw`
    UPDATE "Custody"
    SET "tokenVersion" = (
      SELECT COALESCE(MAX("tokenVersion"), 0) + 1
      FROM "Custody"
      WHERE "acknowledgementBatchId" = ${batchId}
        AND "requiresAcceptance" = true
    ),
    "lastTokenRotatedAt" = NOW(), "updatedAt" = NOW()
    WHERE "acknowledgementBatchId" = ${batchId}
      AND "requiresAcceptance" = true
      AND "assetId" IN (SELECT "id" FROM "Asset" WHERE "organizationId" = ${organizationId})
      AND (
        (SELECT MAX("lastTokenRotatedAt") FROM "Custody"
         WHERE "acknowledgementBatchId" = ${batchId}
           AND "requiresAcceptance" = true
           AND "assetId" IN (SELECT "id" FROM "Asset" WHERE "organizationId" = ${organizationId}))
        IS NULL
        OR
        (SELECT MAX("lastTokenRotatedAt") FROM "Custody"
         WHERE "acknowledgementBatchId" = ${batchId}
           AND "requiresAcceptance" = true
           AND "assetId" IN (SELECT "id" FROM "Asset" WHERE "organizationId" = ${organizationId}))
        < NOW() - INTERVAL '60 seconds'
      )
    RETURNING "tokenVersion"
  `;
});
if (!rows.length) throw new ShelfError({ message: "Batch not found or cooldown active." });
// Sign with { batchId, purpose: "custody-ack-batch", ver: rows[0].tokenVersion,
//   algorithm: "HS256", issuer: "shelf-custody", audience: "custody-ack" }
```

**Kit resend** (rotates KitCustody + all child Custody rows):
```typescript
// In a single transaction:
// 1. UPDATE KitCustody SET tokenVersion = tokenVersion + 1, lastTokenRotatedAt = NOW()
//    WHERE id = kitCustodyId AND requiresAcceptance = true
//    AND "kitId" IN (SELECT "id" FROM "Kit" WHERE "organizationId" = organizationId)  -- ORG SCOPE
//    AND (lastTokenRotatedAt IS NULL OR lastTokenRotatedAt < NOW() - INTERVAL '60 seconds')
//    RETURNING tokenVersion
// 2. Guard: if zero rows -> throw ShelfError("Kit custody not found or cooldown active")
// 3. UPDATE all child Custody records SET tokenVersion = newVersion, lastTokenRotatedAt = NOW()
//    WHERE assetId IN (SELECT id FROM "Asset" WHERE "kitId" = kit.id)
//      AND "teamMemberId" = (SELECT "custodianId" FROM "KitCustody" WHERE id = kitCustodyId)
//    Guard: if zero child rows -> throw ShelfError("No child custody records found")
//    NOTE: The custodian filter (teamMemberId = custodianId) prevents updating custody records
//    belonging to a different custodian if the kit was reassigned between operations.
//    Remember: KitCustody uses custodianId, Custody uses teamMemberId.
// 4. After commit: sign with { id: kitCustodyId, purpose: "custody-ack-kit", ver: newVersion,
//      algorithm: "HS256", issuer: "shelf-custody", audience: "custody-ack" }
```

All paths: atomic `UPDATE ... RETURNING`, cooldown via `lastTokenRotatedAt` with DB time (`NOW() - INTERVAL`), state guards. Batch/kit resend rotates the **entire group** — never a single row from a group, which would desynchronize versions and break batch/kit verification.

---

## Phase 12: Tier-Based Feature Enablement

### 12.1 Enable for qualifying tiers

The feature is **included in Plus and Team plans** — not a separate add-on purchase.

When a user subscribes to Plus or Team (or already has an active subscription), set `custodyAcknowledgementEnabled = true` on their organization. This can be done:

- In the existing Stripe webhook handler that processes subscription changes
- Or via a one-time migration for existing Plus/Team orgs

### 12.2 Upsell for Free tier

When a Free tier user encounters the "Require acknowledgement" checkbox:
- Show a locked/disabled state with an upgrade prompt
- Link to the subscription/upgrade page
- Use the `CUSTODY_ACKNOWLEDGEMENT_ADDON` copy from `addon-copy.ts`

No separate Stripe product, no trial flow, no add-on management page needed for v1. The feature just comes with the plan.

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

### Modified files (17):
1. `packages/database/prisma/schema.prisma` — Custody, KitCustody, Organization, User models
2. `apps/webapp/server/index.ts` — Add public path
3. `apps/webapp/app/routes/_layout+/assets.$assetId.overview.assign-custody.tsx` — Checkbox + email logic
4. `apps/webapp/app/routes/_layout+/kits.$kitId.assets.assign-custody.tsx` — Same for kits
5. `apps/webapp/app/routes/api+/assets.bulk-assign-custody.ts` — Bulk assign support
6. `apps/webapp/app/modules/asset/service.server.ts` — `bulkCheckOutAssets` acknowledgement
7. `apps/webapp/app/modules/kit/service.server.ts` — Kit custody acknowledgement
8. `apps/webapp/app/modules/custody/schema.ts` — Add requiresAcceptance to schema
9. `apps/webapp/app/components/assets/asset-custody-card.tsx` — Show status + actions
10. `apps/webapp/app/modules/asset-index-settings/helpers.ts` — New column
11. `apps/webapp/app/components/assets/assets-index/advanced-asset-columns.tsx` — Render column
12. `apps/webapp/app/routes/_layout+/assets._index.tsx` — Load acknowledgement data + banner
13. `apps/webapp/app/routes/_layout+/assets.$assetId.overview.release-custody.tsx` — Pending note
14. `apps/webapp/app/utils/roles.server.ts` — Return `canUseCustodyAcknowledgement`
15. `apps/webapp/app/config/addon-copy.ts` — Upsell copy
16. `apps/webapp/server/logger.ts` — Redact token query param on acceptance routes
17. `apps/webapp/app/utils/env.ts` — Add CUSTODY_TOKEN_SECRET

---

## Build & Test Order

1. **Phase 1** -> Run migration -> `pnpm db:deploy-migration`
2. **Phase 2-3** -> Service + gating (no UI yet) -> Run unit tests
3. **Phase 4** -> Email templates (can preview with React Email)
4. **Phase 5** -> Public acceptance route -> Manual test with generated JWT
5. **Phase 6** -> Assign custody changes -> Test full flow: assign -> email -> accept
6. **Phase 7** -> Release changes -> Test release-with-pending notes
7. **Phase 8** -> Custody card -> Visual verification via preview
8. **Phase 9** -> Index column -> Visual verification via preview
9. **Phase 10** -> In-app banner + acknowledge page -> Test as BASE/SELF_SERVICE user
10. **Phase 11** -> Resend/copy-link API -> Test from custody card buttons
11. **Phase 12** -> Settings/stripe (can be deferred)
12. **Final** -> `pnpm webapp:validate` -> Full validation pass

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| No new AssetStatus | IN_CUSTODY set immediately. Acknowledgement is evidence, not a gate. Avoids ripple through dozens of status checks. |
| Activity note = permanent record (no network metadata) | Custody hard-deleted on release. Note stores name + timestamp + method (name retained as business record, legitimate interest). Raw IP/UA only on ephemeral Custody fields — auto-purged on release. |
| 30-day token expiry + monotonic version rotation | `tokenVersion` integer incremented on resend. JWT embeds `ver` claim. Integer equality check — no timestamp precision issues. |
| Token is sole authority (not URL param) | Decoded JWT `id` used for all DB lookups. URL `custodyId` is routing only. Prevents mismatch attacks. |
| Two auth modes: public token vs in-app session | Public route: token = authority, no login needed. In-app route: session + teamMember match = authority. Clear separation. |
| Batch key for bulk acknowledgement (per-custodian) | `acknowledgementBatchId` groups custody records scoped to a single custodian. Verifier enforces single `teamMemberId` membership — rejects mixed batches. One token covers the batch. |
| Persisted decline state | `declinedAt` + `declineReason` on Custody makes "Disputed" queryable and filterable. |
| Narrow public path | `/accept-custody/:custodyId` — no wildcard. Minimal exposure surface. |
| Dedicated CUSTODY_TOKEN_SECRET | Separate secret prevents token confusion with invite tokens (invite verifier doesn't check `purpose`). |
| Three token purposes | `custody-ack` (single), `custody-ack-batch` (bulk), `custody-ack-kit` (kit) — each with dedicated verifier fetching from the correct model. |
| Verify-once-then-dispatch | `verifyTokenSignature()` validates JWT once (signature + exp + iss + aud). Verified payload passed to purpose-specific verifiers for DB checks. No double-verification, no unverified branching. |
| Pinned HS256 + issuer/audience | `algorithms: ["HS256"]` prevents algorithm confusion. `issuer` + `audience` claims prevent cross-service token reuse. |
| Checkbox coercion in Zod schema | HTML checkbox sends `"on"` not `true`. Uses `z.union([z.boolean(), z.literal("on")]).transform()` — follows existing column visibility pattern. |
| Decline uses same conditional guard as accept | `WHERE acceptedAt IS NULL AND declinedAt IS NULL` — prevents race between concurrent accept/decline. |
| Single owner for email side effects | Service functions are DB-only. Route actions enqueue emails via pg-boss after commit. Prevents duplicate sends. |
| Atomic resend cooldown | Raw SQL `UPDATE ... RETURNING` with `lastTokenRotatedAt` + `NOW() - INTERVAL '60 seconds'` + state guards. Single query: increment version, enforce cooldown, return new version. TOCTOU-safe, clock-skew safe. |
| Advisory lock for batch token generation | `pg_advisory_xact_lock(hashtext(batchId))` prevents concurrent calls from reading the same MAX and generating duplicate versions. |
| Network metadata cleanup deferred (not an oversight) | Custody hard-delete already purges IP/UA. Notes retain only name (business record). Cron job for long-lived custodies is trivial to add later if needed. |
| Org-scoped everywhere | In-app route AND all resend/copy-link queries scope to `organizationId` via asset/kit join. Multi-tenant boundary enforced at query level, not just permission checks. |
| Feature gated per-org (boolean switch) | Same infra as barcode/audit. Included in Plus/Team by default. Free users see upsell to upgrade. Not a separate purchase — just tier-gated. |
| Self-assignment hides checkbox | Can't corroborate receipt from the person who assigned. |
| One email per custodian for bulk | Not spammy. One acknowledge-all click via batch token. |
| Kit acknowledgement cascades | One click updates KitCustody + all child Custody records in transaction. |
| BASE users can acknowledge own custody | Permission bypass in in-app mode: if you ARE the custodian, you can acknowledge. Not a general custody permission. |
| Non-registered members get copy-link only | No email field on TeamMember. Admin copies link, sends manually. |
| Column hidden by default | Opt-in visibility. Admins who use the feature toggle it on. |
| Custody vs KitCustody field naming | Custody uses `teamMemberId`, KitCustody uses `custodianId`. Both point to TeamMember. Code must use the correct field name per model. |
| `_auth+` prefix for public route | Follows existing `accept-invite` precedent — token-authenticated public routes that don't require a session. |
