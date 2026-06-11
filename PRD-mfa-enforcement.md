# PRD: Workspace-Level MFA Enforcement

> **Status:** v0.2 — security-hardened revision after general + security review · **Date:** 2026-04-30
> **Audience:** Shelf CTO (Donkoko), founders, eng team, CodeRabbit
> **Source repos verified:** `shelf-main` (webapp on `main`), `shelf-pr1/apps/companion` (mobile on `feat/mobile-companion-app`)
> **Versions verified:** webapp `@supabase/supabase-js@^2.103.0`, companion `@supabase/supabase-js@^2.49.1`, Expo SDK 54, RN 0.81.5
> **v0.2 changes:** PKCE on mobile auth, loader-level enforcement (replaces non-functional Hono middleware design), force-reset hardening (global signOut + cross-org member check + atomicity), AAL staleness contract, rate-limiting & sensitive-action step-up section, threat-model expansion. Originating findings tagged in §6 / Appendix A.

---

## 0. Alignment with CTO design preferences

This plan is shaped against the rules surfaced during reporting-v2 planning:

- **No app-layer cron.** Verified: Shelf already runs `noScheduling: true` on PgBoss. v0 uses **PgBoss delayed jobs** (which the codebase already does — `apps/webapp/app/modules/asset-reminder/scheduler.server.ts`). No `setInterval`, no `node-cron`, no daily sweeps.
- **Minimize refactor surface.** Live enforcement state goes on **4 columns on the existing `Organization` model**, not a separate model. The MFA service is **one new module** at `app/modules/mfa/`. Enforcement is a **loader-level helper** that piggybacks on the existing per-request `getSelectedOrganization` AsyncLocalStorage cache (matches the `requirePermission` pattern this codebase already uses). No global audit log; we add a narrow `MfaEnforcementEvent` table that follows the `RoleChangeLog` precedent.
- **Be specific on perf.** Section §5 quantifies the per-request cost: **+0 DB queries on the hot path** for any route that already calls `getSelectedOrganization` (loader-level helper reuses the per-request cache), **+~50µs JWT decode** in `mapAuthSession`, **+~3 lines of comparison logic** in the helper. Independently estimable; no hand-waving.
- **No BI-tool features.** The members-table MFA-status column is a static read (one boolean per row). No drag-and-drop, no SQL builder.

---

## 1. TL;DR

Workspace owners (`OrganizationRoles.OWNER`) opt their workspace into requiring **TOTP-based MFA** for all members, with a **configurable grace period** (default **7 days**). MFA is per-user-account — one enrollment satisfies all enforcing workspaces. After grace, unenrolled members are blocked at next request until they enroll. Supabase Auth provides TOTP primitives (v2.103.0 supports everything needed); Shelf builds backup codes (10 single-use) and owner-initiated reset on top.

SSO-bound users (`User.sso = true`) are exempt — MFA is delegated to the IdP. The feature ships on **all paid plans**; the free plan gets self-enrollment but not workspace enforcement. Two env-var flags gate rollout: `ENABLE_MFA_SELF_ENROLLMENT` (Phase 1) and `ENABLE_MFA_ENFORCEMENT` (Phase 3).

The mobile companion app **pivots to web-delegated authentication** before TestFlight. Mobile opens the system browser to authenticate on shelf.nu (which handles password + MFA + SSO) and receives a **single-use authorization code** via `shelf://` deeplink. Mobile then exchanges the code (with a PKCE `code_verifier` that never left the device) for tokens over a back-channel POST — **tokens never appear in any URL**. Net mobile code change: **−95 LOC**, zero new dependencies. The pivot is feasible because the companion app is at 35% completion, pre-TestFlight, with no users to migrate.

**Estimated effort:** ~26 days single engineer (sequential), ~15 days two engineers (parallelized — webapp + mobile tracks). v0.2 estimate is up from v0's ~22d due to PKCE (+1d), middleware refactor to loader-level (+1d on P3), force-reset hardening (+0.5d), and rate-limiting work (+1d). See §8 for the per-phase breakdown.

---

## 2. Why now

- Customer questions about SSO pricing have surfaced _security as a workspace property_ as a broader theme. SSO is for enterprise; MFA enforcement covers the larger middle market.
- Asset-management workspaces hold high-value records (custody chains, audit trails) — credential compromise is more than a productivity loss.
- Workspace owners ask for it explicitly during sales calls.
- Supabase already provides TOTP at no cost; the marginal infra spend is ~zero.
- The mobile companion app is in the cheap-pivot window exactly once: pre-TestFlight, 35% complete, no commitments to App Store. Past this window, mobile MFA becomes either a separate native build-out or an exemption with sunset migration.

---

## 3. Decisions made

> Every fork has been resolved. Each links to a fuller rationale in Appendix A. CTO's review can override any of these — the rationale is provided so the override is informed.

| #   | Area                           | Decision                                                                                                                                                     | Ref       |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | Grace period values            | `0 / 24h / 7d / 14d / 30d`, default **7d**                                                                                                                   | A.F       |
| 2   | Grace expiry behavior          | Block at next request — no proactive sweep, no session termination                                                                                           | A.G       |
| 3   | SSO + MFA                      | Delegate to IdP only when `User.sso === true` **AND** the active org has `ssoDetailsId` set (org-scoped, not global)                                         | A.E       |
| 4   | OTP / magic-link login         | Treat as `aal1`; users with TOTP enrolled face step-up                                                                                                       | A.H       |
| 5   | Pricing                        | Free on all paid plans; free plan gets self-enrollment but not enforcement                                                                                   | A.I       |
| 6   | Backup-code count              | 10 codes, 12-char base32 (`AAAA-BBBB-CCCC` format), argon2id-hashed                                                                                          | A.C       |
| 7   | Mobile auth transport          | PKCE auth-code exchange over `shelf://` deeplink; **tokens never traverse a URL**. Replaces v0's draft of refresh-token-in-deeplink                          | A.L, §4.5 |
| 8   | Multi-factor schema            | `MfaFactor` 1:N from day 1; v1 UI restricts to a single enrolled factor                                                                                      | A.B       |
| 9   | Step-up frequency              | Once per session (3-day cookie life) for routine actions; **aal2 required for sensitive-account edits** (email, password, MFA self-management) — see §4.11   | A.K       |
| 10  | Audit log substrate            | Narrow `MfaEnforcementEvent` table (precedent: `RoleChangeLog`); no generic audit log                                                                        | A.P       |
| 11  | Personal-workspace toggle      | Hide enforcement toggle on `OrganizationType.PERSONAL`                                                                                                       | A.O       |
| 12  | Phone factor / WebAuthn        | Out of scope for v1 (TOTP only)                                                                                                                              | A.N       |
| 13  | Live enforcement state         | Stored as 4 columns on `Organization` (not a separate model) — minimizes refactor                                                                            | A.M       |
| 14  | Backup-code consumption flow   | Forced re-enrollment of new factor (Supabase can't mint aal2 from our DB)                                                                                    | A.D       |
| 15  | Enforcement check tier         | **Loader-level helper** reusing `getSelectedOrganization`'s per-request cache (not a Hono middleware). Matches the `requirePermission` pattern.              | A.R       |
| 16  | Force-reset session revocation | Owner force-reset calls `auth.admin.signOut(userId, 'global')` _before_ deleting the factor; collapses "compromised account" recovery into one atomic action | A.S       |
| 17  | AAL freshness contract         | Every `mfa.verify` action **must** rewrite the Hono session cookie with the post-verify access+refresh tokens. Regression-tested.                            | A.T       |
| 18  | Rate limiting & lockout        | Per-user + per-IP caps on TOTP verify (5 / 15min) and backup-code verify; lockout email after threshold; matches Auth0/Better-Auth norms                     | A.U       |
| 19  | Reminder cancellation strategy | PgBoss reminder jobs **no-op at fire time** if `mfaEnforcedAt IS NULL`. No cancellation API needed; idempotent across enable/disable cycles                  | A.V       |

---

## 4. Architecture

### 4.1 Schema changes

**Live enforcement state on the existing `Organization` model.** Folds into the existing `getSelectedOrganization` query — no extra DB round trip on the hot path. Rolling back a Phase 3 disaster is `UPDATE Organization SET mfaEnforcedAt = NULL WHERE …`.

```prisma
model Organization {
  // ... existing fields

  /// When MFA enforcement was turned on. NULL means enforcement is off.
  mfaEnforcedAt        DateTime?

  /// When enforcement starts blocking unenrolled members.
  /// = mfaEnforcedAt + (mfaGraceSeconds seconds). NULL when enforcement off.
  mfaEnforceAfter      DateTime?

  /// Grace period in seconds. NULL when enforcement off.
  /// Allowed values: 0, 86400, 604800, 1209600, 2592000.
  mfaGraceSeconds      Int?

  /// User who enabled enforcement. Audit trail; stays after they leave.
  mfaEnabledByUserId   String?
}

/// One row per enrolled-and-verified TOTP factor. The TOTP secret/URI/QR stays
/// in Supabase (`auth.mfa_factors`); we hold only the factor id and metadata.
/// 1:N from day 1 — UI restricts to single factor in v1.
model MfaFactor {
  id                 String   @id @default(cuid())
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId             String
  supabaseFactorId   String   @unique
  friendlyName       String
  verifiedAt         DateTime
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([userId])
}

/// Salted+hashed single-use backup codes. Plaintext shown to user once, never stored.
model MfaBackupCode {
  id         String    @id @default(cuid())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     String
  /// argon2id hash of plaintext code (12-char base32 like AAAA-BBBB-CCCC)
  hash       String
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
}

/// Owner-issued one-time tokens for resetting a member's MFA. Token plaintext
/// is sent in email link; only SHA-256 hash is stored.
model MfaResetToken {
  id              String    @id @default(cuid())
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId          String
  tokenHash       String    @unique
  issuedByUserId  String
  organizationId  String
  expiresAt       DateTime
  consumedAt      DateTime?
  createdAt       DateTime  @default(now())

  @@index([userId])
}

/// Narrow audit table for MFA enforcement state changes (enable / disable /
/// grace-change / member-reset). Modeled on the existing RoleChangeLog. Out of
/// scope for v1: a generic workspace audit log.
model MfaEnforcementEvent {
  id              String   @id @default(cuid())
  organizationId  String
  actorUserId     String
  /// 'ENABLED' | 'DISABLED' | 'GRACE_CHANGED' | 'MEMBER_RESET'
  eventType       String
  /// Grace seconds at the time of the event (for ENABLED / GRACE_CHANGED)
  graceSeconds    Int?
  /// User the event applies to (for MEMBER_RESET)
  targetUserId    String?
  createdAt       DateTime @default(now())

  @@index([organizationId, createdAt])
}

/// Single-use authorization codes for the mobile PKCE auth-code exchange.
/// Web mints a row at /mobile-handoff after the user authenticates (incl. MFA).
/// Mobile redeems the code via POST /api/mobile/exchange together with the
/// PKCE code_verifier; redemption marks the row consumed and returns tokens
/// in the HTTPS response body. See §4.5 for the full flow.
///
/// Tokens themselves are NOT stored here — the row only proves the code was
/// minted by us, binds it to the right user, and pins the PKCE challenge.
/// On redemption we re-issue tokens from the user's current Supabase session.
model MobileAuthCode {
  id              String    @id @default(cuid())
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId          String
  /// SHA-256 hash of the random auth-code (256-bit entropy).
  codeHash        String    @unique
  /// SHA-256 of the PKCE code_verifier (S256 method only — plain disallowed).
  codeChallenge   String
  /// ~60 second expiry. Single-use; rejected after consumedAt is set.
  expiresAt       DateTime
  consumedAt      DateTime?
  createdAt       DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt]) // for periodic cleanup of expired-unredeemed rows
}

model User {
  // ... existing
  mfaFactors       MfaFactor[]
  mfaBackupCodes   MfaBackupCode[]
  mfaResetTokens   MfaResetToken[]
  mobileAuthCodes  MobileAuthCode[]
}
```

**Migration:** purely additive, zero-downtime. No data backfill required.

**What we do not store:** TOTP secret/URI/QR (Supabase owns it), plaintext backup codes (only argon2 hashes), plaintext reset tokens (only SHA-256 hashes), denormalized `backupCodesRemaining` (computed on demand from row count).

### 4.2 Auth-session extension

`mapAuthSession()` ([modules/auth/mappers.server.ts](apps/webapp/app/modules/auth/mappers.server.ts)) gains JWT-claim decoding. New helper at [modules/auth/jwt.server.ts](apps/webapp/app/modules/auth/jwt.server.ts):

```ts
// app/modules/auth/jwt.server.ts
type JwtClaims = {
  aal?: "aal1" | "aal2";
  amr?: { method: string; timestamp: number }[];
};

/** Decode payload from Supabase JWT. No signature verification — Supabase
 *  already validated. We only read claims we care about. */
export function decodeJwtClaims(token: string): JwtClaims {
  try {
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    );
    return { aal: payload.aal, amr: payload.amr };
  } catch {
    return {}; // malformed → middleware treats as aal1 (safe default)
  }
}
```

```ts
// app/modules/auth/mappers.server.ts (extended)
import { decodeJwtClaims } from "./jwt.server";

export function mapAuthSession(s: SupabaseSession): AuthSession {
  const claims = decodeJwtClaims(s.access_token);
  return {
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    userId: s.user.id,
    email: s.user.email!,
    expiresIn: s.expires_in,
    expiresAt: s.expires_at!,
    aal: claims.aal ?? "aal1", // safe default for migration
    amr: claims.amr ?? [],
  };
}
```

`AuthSession` in [server/session.ts](apps/webapp/server/session.ts) gains two new fields: `aal: 'aal1' | 'aal2'` and `amr: { method: string; timestamp: number }[]`.

**Trust boundary (important):** the JWT decoder does **not** verify the JWT signature. The trust boundary is the **Hono session cookie's HMAC-SHA256 signature** (signed by `SESSION_SECRET`). The flow is: Supabase issues the JWT → we receive it via authenticated API call → we wrap it in the Hono session and the cookie is signed → on read we decode claims from inside that signed envelope. A user cannot forge an aal2 JWT without (a) compromising `SESSION_SECRET` (full auth bypass already), or (b) obtaining a real aal2 token from Supabase (which requires possession of a verified factor — i.e. correct behavior). This rule **only holds while the JWT lives inside the Hono session cookie**. If a future endpoint accepts a Supabase JWT directly via `Authorization: Bearer …` without going through the Hono session, that endpoint **must** verify the JWT against Supabase's JWKS (`aud`, `iss`, `exp`, signature). Document this rule in [CLAUDE.md](CLAUDE.md) so future contributors don't extend the decoder to bearer-token paths.

### 4.3 Enforcement: loader-level helper (not Hono middleware)

> **v0.2 design correction.** v0 placed enforcement as a Hono middleware that read `c.get('orgContext')`. That `orgContext` is **never set** in Shelf's actual Hono chain — `getSelectedOrganization` is called per-loader (`apps/webapp/app/modules/organization/context.server.ts:177`) and warms an `AsyncLocalStorage` cache the **first loader** populates, by definition _after_ middleware. The corrected design runs enforcement at loader tier, piggybacking on that cache. This matches the existing `requirePermission` pattern in this codebase, and means: **+0 DB queries** for any route that already calls `getSelectedOrganization` (the vast majority of authenticated routes).

```ts
// app/modules/mfa/enforcement.server.ts (new)

import { redirect } from "react-router";
import { safeRedirect } from "~/utils/http.server";
import type { AuthSession } from "~/server/session";

const MFA_FLOW_PATH_PREFIXES = ["/mfa/"];

/**
 * Apply MFA enforcement for the current request. Call AFTER `getSelectedOrganization`
 * inside any authenticated loader/action. Returns either a banner hint (loader
 * should pass to the UI shell during grace) or a `Response` (caller `throw`s it
 * to short-circuit).
 *
 * Routes that opt OUT (the MFA flow itself, /logout, public paths): just don't
 * call this function.
 */
export async function enforceMfaForRoute({
  authSession,
  organization,
  user,
  request,
}: {
  authSession: AuthSession;
  organization: OrganizationFromUser; // already fetched by getSelectedOrganization
  user: { sso: boolean; mfaFactors: { id: string }[] };
  request: Request;
}): Promise<{ banner?: { enforceAfter: Date } }> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Don't enforce on the MFA flow itself.
  if (MFA_FLOW_PATH_PREFIXES.some((p) => path.startsWith(p))) return {};

  // Org-scoped SSO delegation: only delegate when the user is SSO-flagged AND
  // the active org is actually SSO-bound. A user with `User.sso === true`
  // accessing a non-SSO org still faces MFA enforcement on that org. (See A.E.)
  if (user.sso && organization.ssoDetailsId) return {};

  // No enforcement on this org.
  if (!organization.mfaEnforcedAt) return {};

  const safeReturn = safeRedirect(`${url.pathname}${url.search}`);
  const returnParam = `?return=${encodeURIComponent(safeReturn)}`;

  const now = new Date();
  const inGrace = organization.mfaEnforceAfter
    ? now < organization.mfaEnforceAfter
    : false;
  const userHasFactor = user.mfaFactors.length > 0;

  if (userHasFactor) {
    // Has factor: require aal2 session.
    if (authSession.aal === "aal2") return {};
    throw redirect(`/mfa/challenge${returnParam}`);
  }

  // No factor.
  if (inGrace) {
    return { banner: { enforceAfter: organization.mfaEnforceAfter! } };
  }

  // Grace expired.
  throw redirect(`/mfa/setup${returnParam}`);
}
```

**Wiring at the loader.** Most authenticated layouts already call `getSelectedOrganization`; we add one line:

```ts
// e.g. app/routes/_layout+/_layout.tsx (illustrative — exact route per Phase 3)
const { currentOrganization, userOrganizations } =
  await getSelectedOrganization({ userId, request });
const user = userOrganizations[0]?.user; // already includes mfaFactors after Phase 3 join

const { banner } = await enforceMfaForRoute({
  authSession,
  organization: currentOrganization,
  user,
  request,
});

return json({ /* …, */ mfaGraceBanner: banner ?? null });
```

**Why not Hono middleware?**

- The org context is not available at middleware tier. Adding a "fetch org in middleware" step would add a fresh DB query for every authenticated route, including ones that don't need org data — a real perf regression.
- A loader-level helper composes naturally with the existing `requirePermission` pattern; reviewers reading a route can see the enforcement check inline.
- Routes that legitimately bypass enforcement (the MFA flow, healthcheck, webhooks) opt out by simply not calling the helper, which is more explicit than maintaining a bypass list at middleware tier.

**Why no owner escape hatch.** As in v0: aal1 owners with a factor are routed through `/mfa/challenge` to step up before reaching `/settings/workspace/security`; aal1 owners without a factor are routed through `/mfa/setup`. No dead-end (owner-action requires aal2 anyway). Sole-owner-totally-locked-out is the support process documented in §11.4.

**Data join (Phase 3).** `getSelectedOrganization` already fetches the user record. Phase 3 adds `mfaFactors: { select: { id: true } }` to that user join (one indexed lookup, ~0 marginal cost — see §5) and adds the 4 MFA columns to the org select.

### 4.4 Web routes & flows

| Route                              | Purpose                                                                                                                                          | Auth required                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `/mfa/setup`                       | First-time enrollment: QR + secret, code input, generates backup codes                                                                           | aal1                                |
| `/mfa/setup/backup-codes`          | Show backup codes once + "I've saved them" gate                                                                                                  | Within enrollment flow              |
| `/mfa/challenge`                   | aal1 → aal2 step-up; TOTP code or "use backup code" toggle                                                                                       | aal1                                |
| `/mfa/recover-and-reenroll`        | Public; reachable via emailed `MfaResetToken`                                                                                                    | None (token-gated)                  |
| `/settings/account/security`       | View own factors, regenerate backup codes (aal2), unenroll (aal2)                                                                                | **aal2** (sensitive)                |
| `/settings/account` (email change) | Email-change action requires fresh aal2 step-up if MFA enrolled (§4.11)                                                                          | **aal2** (sensitive)                |
| `/settings/account/password`       | Password-change action requires fresh aal2 step-up if MFA enrolled (§4.11)                                                                       | **aal2** (sensitive)                |
| `/settings/workspace/security`     | OWNER: enable/disable enforcement, view member MFA status, force-reset                                                                           | **aal2** + OWNER                    |
| `/api/mfa/enroll`                  | Enrollment API. Per-user rate limit (§4.11).                                                                                                     | aal1                                |
| `/api/mfa/verify`                  | Challenge verify. Per-user + per-IP rate limit (§4.11). On success, **rewrites session cookie** (§4.10).                                         | aal1                                |
| `/api/mfa/unenroll`                | Self-initiated unenroll                                                                                                                          | aal2                                |
| `/api/mfa/backup-codes/regenerate` | Issues new 10-code set                                                                                                                           | aal2                                |
| `/api/mfa/admin/reset/:userId`     | OWNER force-reset. Validates `:userId` is a member of owner's org (§4.9). Calls `signOut(userId, 'global')` then deletes factor (§4.9).          | aal2 + OWNER                        |
| `/mobile-handoff`                  | Mobile PKCE handoff: validates `state` + `code_challenge`, mints single-use `MobileAuthCode`, deeplinks back with `code` only (no tokens in URL) | aal1 (becomes aal2 if MFA required) |
| `/api/mobile/exchange`             | Mobile back-channel: redeems `code` + `code_verifier` for tokens. HTTPS POST only. Single-use, ~60s TTL. Per-IP rate limit.                      | None (code-gated)                   |

**Return-URL safety.** Every route that redirects via `?return=…` MUST pass the value through `safeRedirect()` (`apps/webapp/app/utils/http.server.ts`) to prevent open-redirect via the MFA flow. The middleware-replacement helper in §4.3 already does this; route-level handlers (`/mfa/challenge`, `/mfa/setup`, `/mfa/recover-and-reenroll`) MUST do the same on the consuming side.

**Backup-code flow** (the case Supabase doesn't support natively — see A.D):

```text
/mfa/challenge → user clicks "use backup code"
  → enters 12-char code (format AAAA-BBBB-CCCC)
  → server validates against MfaBackupCode rows (argon2id verify across user's codes)
  → marks consumedAt = now
  → 302 to /mfa/setup with `recovery=true` query param
  → user enrolls a NEW TOTP factor
  → Supabase mfa.verify mints aal2
  → 302 to original `return` path
  → email "backup code was used + new authenticator set up" sent
```

This is also the more secure pattern (forces re-arming) and matches 1Password/Auth0/Okta.

### 4.5 Mobile companion auth pivot (web-delegate + PKCE)

**Status:** companion app is at `apps/companion/` on `feat/mobile-companion-app` branch (verified — memory previously had `apps/mobile/`, now corrected). 35% completion. Pre-TestFlight. All required libraries already installed.

**v0.2 change.** v0 sketched a flow that returned `access_token` + `refresh_token` in the `shelf://auth-complete` deeplink URL. This is unsafe: URLs leak via browser history, OS analytics, crash reports, and (critically on Android) any sibling app that has registered the same custom scheme. A leaked **refresh token** grants long-lived persistent access. The corrected flow uses **PKCE auth-code exchange** (RFC 7636) — tokens never appear in any URL.

**Flow:**

```text
Mobile app launches
  → user taps "Sign in with Shelf"
  → mobile generates code_verifier (32 random bytes, base64url)
       code_challenge = SHA256(code_verifier)  [S256 method only]
  → mobile generates state token (32 random bytes), persists both in SecureStore
  → mobile opens
       https://shelf.nu/mobile-handoff?state=<state>&code_challenge=<challenge>
       via expo-web-browser openAuthSessionAsync()
  → user authenticates on web (password / OTP / SSO + MFA if enrolled+enforced)
  → web /mobile-handoff loader (now at aal2 if MFA was required) does:
       1. Validate state and code_challenge format.
       2. Insert MobileAuthCode row: { userId, codeHash, codeChallenge, expiresAt: now+60s }
       3. 302 to: shelf://auth-complete?state=<state>&code=<auth_code>
       NB: no tokens in URL — just a short-lived single-use code.
  → mobile deeplink handler validates state matches the stored value
  → mobile POSTs to https://shelf.nu/api/mobile/exchange (HTTPS body) with:
       { code, code_verifier }
  → server verifies SHA256(code_verifier) === stored codeChallenge,
       expiresAt > now, consumedAt IS NULL.
       Atomic UPDATE … SET consumedAt = now WHERE id = ? AND consumedAt IS NULL
       (prevents double-redemption races).
       Returns { access_token, refresh_token } in JSON response body.
  → mobile calls supabase.auth.setSession({ access_token, refresh_token })
  → mobile session persisted in SecureStore; JWT carries aal2
  → autoRefreshToken keeps aal2 alive on subsequent launches
```

**Why this is safe vs the v0 draft:**

- An attacker who intercepts the `shelf://auth-complete?...&code=...` deeplink (e.g. another Android app registering `shelf://`) gets a **code they cannot redeem**: they don't have the `code_verifier`, which never left the originating device's SecureStore.
- The `MobileAuthCode` row is single-use with ~60s TTL; replay window is tiny.
- Refresh tokens (long-lived) are only ever returned in HTTPS response bodies, never URLs.
- This is the standard OAuth 2.0 public-client pattern (Authorization Code with PKCE, RFC 7636) and matches how every modern mobile auth flow works (Auth0, Microsoft, Google, etc.).

**Mobile code (`apps/companion/lib/web-auth.ts`, new):**

```ts
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";

const WEB_BASE = process.env.EXPO_PUBLIC_API_URL!;
const PENDING_KEY_PREFIX = "shelf-pairing-";

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function sha256(input: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
    encoding: Crypto.CryptoEncoding.BASE64,
  }).then((b64) =>
    b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  );
}

export async function signInViaWeb(): Promise<void> {
  // PKCE setup — one new pairing attempt per call. Use a unique key per attempt
  // so backgrounded/double-tapped sessions don't collide.
  const attemptId = Crypto.randomUUID();
  const state = base64UrlEncode(Crypto.getRandomBytes(32));
  const codeVerifier = base64UrlEncode(Crypto.getRandomBytes(32));
  const codeChallenge = await sha256(codeVerifier);

  const key = `${PENDING_KEY_PREFIX}${attemptId}`;
  await SecureStore.setItemAsync(
    key,
    JSON.stringify({ state, codeVerifier, createdAt: Date.now() })
  );

  try {
    const handoffUrl =
      `${WEB_BASE}/mobile-handoff` +
      `?state=${encodeURIComponent(state)}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&attempt=${encodeURIComponent(attemptId)}`;

    const result = await WebBrowser.openAuthSessionAsync(
      handoffUrl,
      "shelf://auth-complete"
    );

    if (result.type !== "success") throw new Error("Sign-in cancelled");

    const { queryParams } = Linking.parse(result.url);
    const stored = JSON.parse((await SecureStore.getItemAsync(key)) ?? "null");
    if (!stored || queryParams?.state !== stored.state) {
      throw new Error("State mismatch — pairing aborted");
    }

    const code = queryParams?.code;
    if (typeof code !== "string") throw new Error("Missing auth code");

    // Back-channel exchange — code + verifier go in HTTPS body, never URL.
    const exchangeRes = await fetch(`${WEB_BASE}/api/mobile/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: stored.codeVerifier }),
    });
    if (!exchangeRes.ok)
      throw new Error(`Exchange failed: ${exchangeRes.status}`);
    const { access_token, refresh_token } = await exchangeRes.json();

    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });
    if (error) throw error;
  } finally {
    // Clean up the pairing record regardless of outcome.
    await SecureStore.deleteItemAsync(key).catch(() => {});
  }
}
```

**Webapp handoff route (`apps/webapp/app/routes/_auth+/mobile-handoff.tsx`, new):**

```tsx
export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");

  // S256-encoded SHA-256 hashes are 43 chars base64url. State is also base64url.
  if (!state || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
    throw new ShelfError({
      cause: null,
      message: "Invalid pairing state",
      status: 400,
      label: "Auth",
    });
  }
  if (!codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new ShelfError({
      cause: null,
      message: "Invalid PKCE challenge",
      status: 400,
      label: "Auth",
    });
  }

  const session = context.getSession?.();
  if (!session) {
    return redirect(
      `/login?return=${encodeURIComponent(
        `/mobile-handoff?state=${state}&code_challenge=${codeChallenge}`
      )}`
    );
  }

  // MFA enforcement is applied via enforceMfaForRoute() upstream (see §4.3).
  // By the time we reach this loader, session.aal is either aal2 or the user
  // has no enforcement applied to the active org.

  // Mint a single-use auth code bound to the PKCE challenge.
  const codePlain = randomBytes(32).toString("base64url"); // 256-bit
  const codeHash = sha256(codePlain);
  await db.mobileAuthCode.create({
    data: {
      userId: session.userId,
      codeHash,
      codeChallenge,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  return redirect(
    `shelf://auth-complete?state=${encodeURIComponent(
      state
    )}&code=${encodeURIComponent(codePlain)}`
  );
}
```

**Webapp exchange route (`apps/webapp/app/routes/api+/mobile.exchange.ts`, new):**

```ts
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    throw new ShelfError({
      cause: null,
      message: "Method not allowed",
      status: 405,
      label: "Auth",
    });
  }

  const { code, code_verifier } = await request.json();
  if (typeof code !== "string" || typeof code_verifier !== "string") {
    throw new ShelfError({
      cause: null,
      message: "Missing fields",
      status: 400,
      label: "Auth",
    });
  }

  const codeHash = sha256(code);
  const expectedChallenge = sha256Base64Url(code_verifier);

  // Atomic single-use redemption.
  const updated = await db.mobileAuthCode.updateMany({
    where: {
      codeHash,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      codeChallenge: expectedChallenge,
    },
    data: { consumedAt: new Date() },
  });

  if (updated.count !== 1) {
    // Don't reveal which condition failed — uniform error reduces oracle.
    throw new ShelfError({
      cause: null,
      message: "Invalid or expired code",
      status: 400,
      label: "Auth",
    });
  }

  const row = await db.mobileAuthCode.findUniqueOrThrow({
    where: { codeHash },
  });

  // Issue tokens for the bound user. We re-fetch the current session via the
  // service-role admin client (admin.generateAccessToken pattern) so refresh
  // tokens are minted server-side without ever touching the URL.
  const { access_token, refresh_token } = await mintMobileSessionForUser(
    row.userId
  );

  return json({ access_token, refresh_token });
}
```

**Mobile rip-out (revised LOC):**

| File                                            | Action                                  | LOC change           |
| ----------------------------------------------- | --------------------------------------- | -------------------- |
| `apps/companion/lib/auth-context.tsx`           | Rewrite — `signIn()` → `signInViaWeb()` | -50, +65             |
| `apps/companion/lib/web-auth.ts`                | New (PKCE + back-channel exchange)      | +110                 |
| `apps/companion/lib/deep-links.ts`              | Extend — handle `shelf://auth-complete` | +40                  |
| `apps/companion/app/(auth)/login.tsx`           | Replace — single button                 | -150, +30            |
| `apps/companion/app/(auth)/forgot-password.tsx` | Delete                                  | -100                 |
| `apps/companion/hooks/use-form-validation.ts`   | Delete (only used by deleted screens)   | -80                  |
| Maestro E2E                                     | Rewrite ~10 auth flows                  | (tracked separately) |

**Net mobile code: −95 LOC. Zero new dependencies** (`expo-crypto` is already installed; PKCE uses its `digestStringAsync` and `getRandomBytes`).

**Webapp:** the mobile-handoff loader (~80 LOC) plus the new `/api/mobile/exchange` action (~60 LOC) plus a small `mobile-auth-code.server.ts` helper (~50 LOC). The 27 existing mobile API endpoints in `apps/webapp/app/routes/api+/mobile+/*` need **zero changes** — they already validate JWT bearer tokens.

**Stale-row cleanup:** add a one-line periodic cleanup via existing PgBoss infrastructure: every 5 min, `DELETE FROM "MobileAuthCode" WHERE expiresAt < now() - interval '1 hour'`. Cheap, indexed by `expiresAt`.

### 4.6 UI components (web)

Reuse: `<Input>`, `<PasswordInput>`, `<ShelfOTP>` (already used in OTP flow — perfect for 6-digit TOTP), `<Button>`, `useDisabled`, `useZorm`, `getValidationErrors` (per [CLAUDE.md](CLAUDE.md)).

New components:

- `<MfaSetupCard>` — QR (data-URL prefixed by Supabase SDK), masked secret, code input.
- `<BackupCodesPanel>` — 10 codes, copy-all, download `.txt`, "I've saved them" gate.
- `<MfaChallengeForm>` — 6-digit input with backup-code toggle.
- `<MfaStatusBadge>` — "Enrolled" / "Not enrolled" / "Grace ends in N days".
- `<MfaEnforcementToggle>` — owner enable/disable + grace dropdown.
- `<MfaGraceBanner>` — workspace-shell banner during grace.

### 4.7 Email templates

Per the existing pattern in [emails/stripe/audit-trial-welcome.tsx](apps/webapp/app/emails/stripe/audit-trial-welcome.tsx) (`LogoForEmail`, shared `styles.*`, HTML+plain text exports, `try/catch + Logger.error + ShelfError`):

| Template                      | Trigger                                            | Recipient              |
| ----------------------------- | -------------------------------------------------- | ---------------------- |
| `mfa-enrolled.tsx`            | User completes enrollment                          | The user               |
| `mfa-enforcement-enabled.tsx` | Owner toggles on                                   | All members            |
| `mfa-enrollment-reminder.tsx` | T-3d, T-1d before grace expiry                     | Each unenrolled member |
| `mfa-grace-expired.tsx`       | First request after expiry redirects to /mfa/setup | The blocked member     |
| `mfa-reset-link.tsx`          | Owner triggers reset                               | The user being reset   |
| `mfa-backup-code-used.tsx`    | Backup code consumed                               | The user               |

**Reminder scheduling: PgBoss delayed jobs** (existing infra, `apps/webapp/app/utils/scheduler.server.ts`). At enforcement-enable, queue jobs with `runAt = enforceAfter - 3*24h` and `enforceAfter - 24h`. **No cancellation API needed** — jobs no-op at fire time:

```ts
// pseudocode for the reminder job handler
async function handleMfaEnrollmentReminder({ organizationId }: Job) {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org?.mfaEnforcedAt) return; // owner disabled enforcement → no-op
  if (new Date() >= org.mfaEnforceAfter!) return; // grace already expired
  // ... compute unenrolled members and send reminder
}
```

**Why this design.** `pg-boss.cancel(jobId)` would require storing job IDs alongside the org row and a corresponding cancel-on-disable code path. The fire-time recheck is **idempotent across enable/disable cycles** — re-enabling within the original grace window simply lets the already-queued reminder fire (and its recheck succeeds). For new grace periods, fresh jobs are queued; stale ones still no-op safely.

### 4.8 Owner self-prerequisite

Before "enable enforcement" form succeeds:

```ts
// app/routes/_layout+/settings.workspace.security.tsx (action)

if (authSession.aal !== "aal2") {
  throw new ShelfError({
    cause: null,
    status: 403,
    label: "Auth",
    message: "Re-authenticate with MFA before changing security settings",
  });
}

const ownFactor = await db.mfaFactor.findFirst({
  where: { userId: authSession.userId },
});
if (!ownFactor) {
  throw new ShelfError({
    cause: null,
    status: 400,
    label: "Auth",
    message:
      "You must enroll MFA on your own account before enabling enforcement",
  });
}

// Verify owner role (canonical pattern from account-details.workspace edit route)
const org = await db.organization
  .findUniqueOrThrow({
    where: {
      id: organizationId,
      owner: { is: { id: authSession.userId } },
    },
  })
  .catch(() => {
    throw new ShelfError({
      cause: null,
      status: 403,
      label: "Auth",
      message: "You are not the owner of this organization",
    });
  });

// Refuse on PERSONAL workspaces (no other members to enforce on)
if (org.type === OrganizationType.PERSONAL) {
  throw new ShelfError({
    cause: null,
    status: 400,
    label: "Auth",
    message: "MFA enforcement applies to team workspaces only",
  });
}
```

Disabling enforcement also requires fresh aal2 — prevents a hijacked aal1 session from unilaterally disabling workspace security.

**How an aal1 owner reaches this form (no escape hatch needed):**

- _Owner has factor + aal1_: `enforceMfaForRoute()` redirects them to `/mfa/challenge?return=/settings/workspace/security` → step up → return at aal2 → action succeeds.
- _Owner has no factor + still in grace_: page loads with the grace banner; the action returns the "must enroll first" `ShelfError`; CTA links to `/mfa/setup`.
- _Owner has no factor + grace expired_: `enforceMfaForRoute()` redirects them to `/mfa/setup?return=/settings/workspace/security` → enrollment verifies the factor (Supabase mints aal2 on first verify) → return at aal2 with factor → action succeeds.
- _Owner totally locked out (lost device + lost backup codes)_: support process per §11.4.

This is why we removed the original draft's owner escape hatch — it allowed loading the page at aal1, which produced a 403 dead-end on submit. Letting `enforceMfaForRoute()` (§4.3) route the owner through the normal step-up flow is cleaner and has no dead-end.

### 4.9 Supabase client modes & force-reset hardening

Today the webapp predominantly uses `getSupabaseAdmin()` (service-role). MFA needs a clean split:

| Operation                                         | Required client                                 | Why                                             |
| ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `auth.mfa.enroll`                                 | **User-context** (anon key + user access token) | Factor is enrolled for current user             |
| `auth.mfa.challengeAndVerify`                     | **User-context**                                | Verify is per-session                           |
| `auth.mfa.unenroll` (self)                        | **User-context**                                | Same                                            |
| `auth.mfa.listFactors` (self)                     | **User-context**                                | Reads current user's factors                    |
| `auth.admin.mfa.deleteFactor` (owner force-reset) | **Admin**                                       | Cross-user; service-role                        |
| `auth.admin.signOut(userId, 'global')`            | **Admin**                                       | Revokes all sessions on force-reset (see below) |

**New helper in [integrations/supabase/client.ts](apps/webapp/app/integrations/supabase/client.ts):**

```ts
export function getSupabaseAsUser(authSession: AuthSession) {
  return getSupabaseClient(SUPABASE_ANON_PUBLIC, authSession.accessToken);
}
```

Document the rule (also in [CLAUDE.md](CLAUDE.md)): admin client = service-role only; user client = the user's own MFA actions. The new MFA service uses `getSupabaseAsUser()` exclusively.

#### Force-reset action: hardened contract

Per the Supabase auth model, **deleting a factor (or user) does not invalidate existing access tokens.** If the reason for force-reset is "the account was compromised," simply deleting the factor leaves the attacker's existing aal2 session valid for up to the access-token TTL (1h) and their refresh token valid for ~30 days. Force-reset must be a single atomic operation that revokes sessions first.

```ts
// app/routes/api+/mfa.admin.reset.$userId.ts (action — illustrative)

export async function action({ request, params, context }: ActionFunctionArgs) {
  const authSession = context.getSession();

  if (authSession.aal !== "aal2") {
    throw new ShelfError({
      cause: null,
      status: 403,
      label: "Auth",
      message: "Re-authenticate with MFA",
    });
  }

  const targetUserId = params.userId!;
  // [§4.8 owner self-prereq pattern: verify caller is OWNER of the org]
  const { organizationId } = await requireOwner(authSession, request);

  // SEC-CRITICAL: cross-org check. The target MUST be a member of the
  // owner's org. Without this, an owner of org A could trigger MFA reset
  // emails to any userId in the system — a phishing amplifier and a
  // privileged-action IDOR (matches the cross-org IDOR pattern this
  // codebase has had repeated incidents with).
  const membership = await db.userOrganization.findFirst({
    where: { userId: targetUserId, organizationId },
    select: { id: true },
  });
  if (!membership) {
    throw new ShelfError({
      cause: null,
      status: 404,
      label: "Auth",
      message: "Member not found in this workspace",
    });
  }

  // Atomic-as-possible sequence: revoke sessions FIRST so an attacker who
  // currently holds a session can't act on the brief window between delete
  // and revocation. Order matters: signOut → factor delete → token mint →
  // email send. Any failure short-circuits.
  const supabase = getSupabaseAdmin();

  // 1) Global signout — invalidates all existing access + refresh tokens.
  const { error: signOutErr } = await supabase.auth.admin.signOut(
    targetUserId,
    "global" // 'global' = revokes every session, not just current
  );
  if (signOutErr) {
    throw new ShelfError({
      cause: signOutErr,
      status: 500,
      label: "Auth",
      message: "Failed to revoke sessions",
    });
  }

  // 2) Delete Supabase factors AND local MfaFactor rows in a transaction.
  //    Order: Supabase first; if our DB delete fails afterward, the user's
  //    factor is gone in Supabase but our row is stale — our row drives UI
  //    state, so a stale row would show "still enrolled" but verify would
  //    fail. We therefore enforce the local delete in the same transaction
  //    and surface the error if it fails.
  await db.$transaction(async (tx) => {
    const factors = await tx.mfaFactor.findMany({
      where: { userId: targetUserId },
    });
    for (const f of factors) {
      const { error } = await supabase.auth.admin.mfa.deleteFactor({
        userId: targetUserId,
        id: f.supabaseFactorId,
      });
      if (error) throw error;
    }
    await tx.mfaFactor.deleteMany({ where: { userId: targetUserId } });
    await tx.mfaBackupCode.deleteMany({ where: { userId: targetUserId } });
  });

  // 3) Issue single-use reset token and email.
  const tokenPlain = randomBytes(32).toString("base64url"); // 256-bit
  const tokenHash = sha256Hex(tokenPlain);
  await db.mfaResetToken.create({
    data: {
      userId: targetUserId,
      tokenHash,
      issuedByUserId: authSession.userId,
      organizationId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  // 4) Audit + email.
  await db.mfaEnforcementEvent.create({
    data: {
      organizationId,
      actorUserId: authSession.userId,
      eventType: "MEMBER_RESET",
      targetUserId,
    },
  });
  await sendMfaResetEmail({ targetUserId, tokenPlain, organizationId });

  return json({ ok: true });
}
```

**What's enforced here:**

- **Global session revocation** before factor deletion: closes the "compromised aal2 session keeps working" gap.
- **Cross-org membership check** prevents a workspace A owner from triggering reset on users not in workspace A (cross-org IDOR class).
- **Transactional local-DB delete** ensures the local `MfaFactor` row never lags behind Supabase deletion, avoiding the "user looks enrolled in our DB but Supabase has nothing" failure mode.
- **Reset token entropy** explicit at 256 bits (`randomBytes(32).toString('base64url')`) and stored as SHA-256 hash.
- **Audit row** written before email send so the action is logged even if email infrastructure fails.

### 4.10 Migration safety on deploy + AAL freshness contract

#### Migration safety

**Issue:** when the new `mapAuthSession` ships, existing logged-in cookies don't have `aal`. `enforceMfaForRoute()` reading `session.aal` gets `undefined`.

**Fix:** the JWT decoder defaults missing `aal` to `'aal1'`. This is correct for non-MFA users (100% of users at deploy time). After Phase 1 ships, the user pool that has `aal: 'aal2'` grows monotonically — no user is lost.

**Test added in Phase 1:** invoke `enforceMfaForRoute` with a synthetic session that has no `aal` field; assert it allows access (no MFA enrolled, no enforcement).

**Deploy sequence:**

1. Deploy schema migration.
2. Deploy code with `ENABLE_MFA_SELF_ENROLLMENT=false`. No behavior change.
3. Flip flag in staging; dogfood internally.
4. Flip in production.
5. After Phase 3 ships, repeat for `ENABLE_MFA_ENFORCEMENT`.

#### AAL freshness contract (CRITICAL — prevents redirect loop)

**The trap.** Per the Supabase auth model, _JWT claims are not always fresh until the user's token is refreshed_. The Hono session cookie holds an access-token JWT with a fixed `aal` claim baked in at the time the cookie was minted. When the user verifies a TOTP factor, Supabase issues a **new** access token with `aal: 'aal2'` in the response — but the **old** token in our cookie still says `aal: 'aal1'`.

If `/api/mfa/verify` doesn't write the new tokens back into the Hono session, the next request will:

1. Read the cookie → `aal: 'aal1'`.
2. `enforceMfaForRoute` sees aal1 + factor enrolled → 302 to `/mfa/challenge`.
3. User verifies again → cookie still aal1 → loop.

**Contract.** Every code path that mints an aal2 (or otherwise changes AAL) MUST atomically rewrite the Hono session cookie with the post-action access+refresh tokens before returning to the client. This applies to:

- `/api/mfa/verify` (TOTP step-up)
- `/mfa/setup` (first-factor enrollment — Supabase mints aal2 on first verify)
- The backup-code recovery flow's terminal `mfa.verify` call
- Any future passkey/WebAuthn step-up

```ts
// Pattern (illustrative — applies to every verify endpoint)
const { data, error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
if (error) throw new ShelfError({ ... });

// data.session has the NEW access+refresh tokens with aal2.
// Mandatory: write the new tokens back into the Hono session cookie.
context.setSession(mapAuthSession(data.session));

return redirect(safeRedirect(returnUrl));
```

**Regression test (Phase 2):**

```ts
// Pseudo-test
test("verify endpoint rewrites session cookie with aal2 token", async () => {
  const cookieBefore = await loginWithPassword();
  expect(decodeAal(cookieBefore)).toBe("aal1");

  const cookieAfter = await postVerify({
    cookie: cookieBefore,
    code: validTotp,
  });
  expect(decodeAal(cookieAfter)).toBe("aal2");
});
```

This test is mandatory before Phase 2 ships and must run in CI.

### 4.11 Rate limiting & sensitive-action step-up

This section is **new in v0.2**. It addresses two findings from the security review (rate-limiting absence and email-change-bypass risk) by establishing concrete defaults that match Auth0 / Better-Auth conventions.

#### Rate limits

All rates are per-user-id where the request is authenticated; per-IP otherwise. Implemented via the existing rate-limit primitive used by other endpoints (or a thin wrapper around it — confirm in Phase 0).

| Endpoint                                | Limit                                    | Lockout behavior                                             |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `POST /api/mfa/enroll`                  | 10 / hour / user                         | 429 with `Retry-After`                                       |
| `POST /api/mfa/verify` (TOTP)           | 5 / 15 min / user **and** 20 / hour / IP | After 5 failures, account-level alert email; 30-min cooldown |
| `POST /api/mfa/verify` (backup code)    | 3 / 15 min / user                        | After 3 failures, account-level alert email; 60-min cooldown |
| `POST /api/mfa/admin/reset/:userId`     | 3 / hour / owner                         | 429; informs owner to wait                                   |
| `POST /api/mobile/exchange`             | 30 / 5 min / IP                          | 429 (no per-user since the code IS the auth)                 |
| `POST /api/mfa/backup-codes/regenerate` | 5 / hour / user                          | 429                                                          |

**Why these specifics.** TOTP is 6 digits = 10⁶ search space; without rate limit, ~17 minutes of brute force. 5 attempts / 15 min keeps brute force timeline at >100 years average. The numbers track Auth0's defaults and Better-Auth's "3 req / 10s" floor (we're slightly looser to reduce false-positive lockouts).

**Account-level alert email** at lockout: short factual message ("Several failed attempts on your account; if this wasn't you, change your password and review active sessions"). Uses the same email-template pattern as `mfa-backup-code-used.tsx`.

**Implementation note (Phase 0 verification):** confirm Shelf has a usable rate-limit primitive (Redis-backed ideally; Postgres-backed acceptable). If neither, add a small one — this is a real gap in the codebase regardless of MFA work.

#### Sensitive-action step-up (aal2 required)

Beyond the once-per-session aal2 requirement, the following sub-routes require **fresh aal2 in this same browser session** (i.e. session.aal === 'aal2'; if user dropped to aal1 via session refresh anomaly, re-challenge):

| Action                                         | Why                                                             |
| ---------------------------------------------- | --------------------------------------------------------------- |
| Change account email                           | Email-change-then-MFA-reset is a classic account-takeover chain |
| Change account password                        | Stops a hijacked aal1 from rotating credentials                 |
| Enroll/unenroll/regenerate-backup-codes (self) | Already aal2 — restated for completeness                        |
| Enable / disable workspace MFA enforcement     | Already aal2 (§4.8)                                             |
| Owner force-reset of any member                | Already aal2 + OWNER (§4.9)                                     |

Implementation: a `requireAal2()` route-level helper, used like `requirePermission()`. If `session.aal !== 'aal2'`, throws a `ShelfError` with `status: 403` and a `Reauth-Required` header so the client can surface a "Verify with MFA" prompt. The action returns the user to `/mfa/challenge?return=<original>` (sanitized via `safeRedirect`). For users with no MFA enrolled, the helper is a no-op.

```ts
// app/modules/mfa/step-up.server.ts (new)
export function requireAal2({
  authSession,
  user,
}: {
  authSession: AuthSession;
  user: { mfaFactors: { id: string }[] };
}) {
  // Users without any factor can't satisfy aal2 — they pass through.
  // (They're either out-of-scope for MFA entirely, or in a grace window.)
  if (user.mfaFactors.length === 0) return;
  if (authSession.aal === "aal2") return;
  throw new ShelfError({
    cause: null,
    status: 403,
    label: "Auth",
    message: "This action requires re-authentication with MFA",
    additionalData: { reauthRequired: true },
  });
}
```

**Client UX.** When the action returns the 403 with `Reauth-Required`, the client redirects to `/mfa/challenge?return=<current path>`. After step-up, the user is bounced back and re-submits.

---

## 5. Performance

The CTO's bar is concrete numbers, not "should be fine."

### 5.1 Hot-path budget — the per-request loader chain

**Current** (`apps/webapp/server/index.ts` middleware + per-loader call, verified):

| Step                                                                     | DB queries               | Approx p50 | Notes                                      |
| ------------------------------------------------------------------------ | ------------------------ | ---------- | ------------------------------------------ |
| `protect()` (validateSession)                                            | 1 (auth.refresh_tokens)  | ~3ms       | Reads Supabase auth schema; existing       |
| `refreshSession()`                                                       | 0 unless near expiry     | ~0.1ms     | Conditional refresh                        |
| `getSelectedOrganization()` _(per loader; cached via AsyncLocalStorage)_ | 1 (UserOrganization+Org) | ~5ms       | One round trip, 25-field select with joins |
| Route handler                                                            | 1+                       | varies     | Depends on route                           |

**With MFA enforcement (Phase 3 onward, loader-level helper — see §4.3):**

| Step                                   | DB queries | Marginal cost  | Notes                                                                                                                                                                                        |
| -------------------------------------- | ---------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protect()`                            | 1          | 0              | Unchanged                                                                                                                                                                                    |
| `mapAuthSession()` JWT decode          | 0          | **~50µs**      | Single base64 decode + JSON.parse on ~300-byte payload                                                                                                                                       |
| `getSelectedOrganization()` _(cached)_ | 1          | **0 marginal** | Add `mfaFactors: { select: { id: true } }` to user join + 4 columns from Organization. Both indexed (Organization PK; MfaFactor's `userId` index). Lateral join planner cost ≈ 0 in EXPLAIN. |
| `enforceMfaForRoute()`                 | 0          | **<10µs**      | Pure logic on already-fetched data; reads from the per-request `AsyncLocalStorage` cache populated by the existing `getSelectedOrganization` call.                                           |

**Total marginal per request: ~50µs CPU + 0 DB queries**, for any loader that already calls `getSelectedOrganization` (the vast majority of authenticated routes). The added Prisma joins reuse the existing query plan; the planner uses the indexed FK on `MfaFactor.userId` and a hash join on `Organization.id`. p95 of `getSelectedOrganization` is unchanged within measurement noise.

**Routes that don't call `getSelectedOrganization` today** — e.g. `/api/healthcheck`, webhook endpoints, the MFA flow itself — are explicitly opted out (they don't call the helper) and pay no perf cost.

**Why not a Hono middleware?** A middleware-tier check would have to fetch the org context itself, adding a fresh DB query for every authenticated route — including ones that don't need org data (e.g. `/api/healthcheck` analogues). Loader-level matches the existing `requirePermission` pattern and keeps the +0-query property for the common case. See §4.3 for the architectural rationale.

**Materialization escape hatch (per CTO Rule 2):** if a customer with an unusually large `MfaFactor` row (we only ever expect 1–10 per user) somehow blows query budget, we cache `userHasMfaFactor: boolean` on `User` directly. Not anticipated.

### 5.2 The MFA endpoints themselves

| Endpoint                           | Expected p95 | Budget rationale                                                                                                                           |
| ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/mfa/enroll`             | 200ms        | One Supabase API call (network bound) + 1 DB insert (`MfaFactor`)                                                                          |
| `POST /api/mfa/verify`             | 250ms        | One Supabase verify call + 1 DB update + cookie reissue                                                                                    |
| Backup-code verify                 | 5–10ms       | **v0.2:** changed from O(N) argon2id to O(1) HMAC-SHA256-with-server-pepper. See note below. Combined with rate limit (3 / 15 min, §4.11). |
| `/settings/workspace/security` GET | 80ms         | One Org read + member count + per-member `MfaFactor` exists join. For a 100-member org this is one query with `EXISTS` subselect.          |
| `/api/mfa/admin/reset/:userId`     | 300ms        | Issue token + DB insert + Supabase admin API + signOut admin call + email queue add                                                        |
| `POST /api/mobile/exchange`        | 50ms         | One DB UPDATE (atomic single-use), one user lookup, one Supabase admin API call to mint session                                            |

**Backup-code verification — v0.2 design change.** v0 used argon2id (`m=64MB, t=3`) iterated over up to 10 hashes per submission — ~100ms CPU per request. With the per-IP brute-force rate limit (§4.11), a malicious actor could still pin substantial CPU per attempt. Backup codes are 12 chars of base32 (~60 bits of entropy) — not human-typed-password weakness — and don't need slow hashing. Switching to HMAC-SHA256 with a server-side pepper (one constant secret in env, separate from `SESSION_SECRET`) yields O(1) verify at ~5µs per check while remaining secure against offline DB-dump attacks (an attacker without the pepper cannot validate guesses; with the pepper, they have full DB access anyway). This is the standard design for high-entropy single-use tokens (cf. password-reset tokens already in this codebase). Update threat-model row "Backup-code DB dump" accordingly.

### 5.3 PgBoss reminder jobs

PgBoss runs out-of-band; reminder jobs do not affect request latency. Each reminder job:

- Reads 1 organization + 1 list of unenrolled members (left-join `User` against `MfaFactor`).
- Sends N emails (PgBoss handles retry, no inline blocking).

For a workspace with 100 members and one with no factor, total reminder job runtime ≈ 1s. Acceptable.

---

## 6. Security threat model

> v0.2 expansion. Findings sourced from the security-focused review using the OAuth/OIDC misconfiguration playbook, Auth0 MFA patterns, Better-Auth 2FA defaults, and the Supabase auth-traps checklist. New rows tagged **[v0.2]**; updated rows tagged **[v0.2-rev]**.

| Threat                                               | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stolen session cookie (web)                          | aal2 requirement on protected paths means cookie alone is insufficient when MFA enrolled.                                                                                                                                                                                                                                                                                                                                                                 |
| TOTP secret exfiltration via logs                    | Logger allow-list rule scrubs `secret`, `uri`, `qr_code` keys. Audit Sentry config in Phase 0 — including `beforeSend` denylist (Sentry captures context independent of our Logger). **[v0.2-rev]**                                                                                                                                                                                                                                                       |
| Backup-code DB dump                                  | HMAC-SHA256 with server-side pepper (env-secret, separate from `SESSION_SECRET`). Without the pepper an attacker cannot validate guesses; with the pepper they have full DB access anyway. **[v0.2-rev]** — replaced argon2id approach (see §5.2 note).                                                                                                                                                                                                   |
| Backup-code phishing                                 | Single-use; consumed on use; user notified by email immediately; forced re-enrollment limits damage to one re-arm window.                                                                                                                                                                                                                                                                                                                                 |
| Reset-token phishing                                 | 256-bit entropy (`randomBytes(32)`), SHA-256 hashed at rest, 1h expiry, single-use, requires owner intent. **[v0.2-rev]** — entropy made explicit.                                                                                                                                                                                                                                                                                                        |
| TOTP code replay                                     | Supabase rejects already-used codes; ±30s skew window.                                                                                                                                                                                                                                                                                                                                                                                                    |
| **TOTP brute-force**                                 | Per-user 5 / 15 min and per-IP 20 / hour rate limits on `/api/mfa/verify`. Account-level alert email on lockout. Expected MTTC at brute force: >100 years. **[v0.2]** — see §4.11.                                                                                                                                                                                                                                                                        |
| **Backup-code brute-force**                          | Per-user 3 / 15 min on the backup-code path; 60-min cooldown after lockout. Account-level alert email. **[v0.2]**                                                                                                                                                                                                                                                                                                                                         |
| **Cross-org IDOR on `/api/mfa/admin/reset/:userId`** | Action validates `:userId` is a member of the owner's active org via `UserOrganization` lookup before any side effects (§4.9). Matches the cross-org IDOR fix pattern this codebase has used for note-creation and location IDORs. **[v0.2]**                                                                                                                                                                                                             |
| **Force-reset doesn't revoke compromised sessions**  | Force-reset action calls `auth.admin.signOut(userId, 'global')` BEFORE deleting the factor (§4.9). Local DB delete is transactional with Supabase factor delete. **[v0.2]** — closes the "delete factor but attacker's existing aal2 token keeps working" gap noted in the Supabase auth-traps checklist.                                                                                                                                                 |
| **AAL claim staleness in Hono session cookie**       | All `mfa.verify` paths MUST rewrite the Hono session cookie with the post-verify access+refresh tokens (§4.10). Regression test in CI before Phase 2 ships. **[v0.2]**                                                                                                                                                                                                                                                                                    |
| **Email-change & password-change account takeover**  | Both actions require fresh aal2 step-up if MFA enrolled (§4.11). Closes the chain: stolen aal1 → change email to attacker-controlled → request MFA reset → take over.                                                                                                                                                                                                                                                                                     |
| **Open-redirect via `?return=`**                     | Every consumer of the `return` parameter MUST run it through `safeRedirect()` (§4.4). Prevents `/mfa/challenge?return=https://evil.com` phishing primitive. **[v0.2]**                                                                                                                                                                                                                                                                                    |
| **Mobile deeplink token interception**               | **v0.2-rev:** PKCE auth-code exchange — tokens never appear in any URL. Deeplink carries only a single-use 60s-TTL `code` bound to `code_challenge` that lives only on the originating device. An interceptor without `code_verifier` cannot redeem the code. Removes the "v1 acceptable risk" hand-wave from v0.                                                                                                                                         |
| Mobile session theft (compromised device)            | SecureStore is hardware-backed on iOS / Android Keystore. Owner can `auth.admin.signOut(userId, 'global')` to revoke all sessions including mobile.                                                                                                                                                                                                                                                                                                       |
| Owner self-lockout                                   | Self-prerequisite gate at enable-time prevents the most common foot-gun (enabling without own factor). Recovery for "lost device + still has backup codes": use a backup code → forced re-enrollment (§4.4). For "lost device + no backup codes" via owner-initiated reset (§4.9). For sole owner totally locked out: support-runbook process per §11.4. Disabling enforcement requires fresh aal2 (§4.8) — trade-off for "no aal1 admin-disable bypass." |
| **SSO scope semantics — global vs org-scoped**       | **v0.2-rev:** Enforcement check uses `user.sso && org.ssoDetailsId` (org-scoped) — a user provisioned via SSO who's also a member of a non-SSO org now faces MFA enforcement on the non-SSO org. Avoids the global-flag-bypass risk noted in the security review.                                                                                                                                                                                         |
| Mass-enrollment DoS                                  | Per-user-per-hour cap of 10 enroll calls (§4.11). Supabase tenant-level rate limits as defense in depth.                                                                                                                                                                                                                                                                                                                                                  |
| Audit-log tampering                                  | `MfaEnforcementEvent` is write-only via service; no admin delete API. Audit row written before email send so the action is logged even if email fails.                                                                                                                                                                                                                                                                                                    |
| TOFU at enrollment                                   | Re-auth (password) required immediately before `/mfa/setup`. Prevents stolen-aal1-session-during-enrollment.                                                                                                                                                                                                                                                                                                                                              |
| OTP-as-only-factor coverage                          | OTP login is aal1 by Supabase definition. Users with OTP+TOTP face the TOTP step-up. Email is not treated as a strong second factor (phishable, plaintext, often shared).                                                                                                                                                                                                                                                                                 |
| **Supabase TOTP secret encryption-at-rest**          | Phase 0 verification task: confirm posture of `auth.mfa_factors.secret` storage — pgsodium-wrapped vs disk-only encryption. If only disk-level, raise with Supabase or wrap pgsodium ourselves before Phase 1 dogfood. **[v0.2]**                                                                                                                                                                                                                         |
| **Logout doesn't revoke Supabase tokens**            | Phase 1 task: extend `/logout` to call `supabase.auth.signOut({ scope: 'global' })` for users with MFA enrolled, ensuring stolen-then-logged-out sessions stop working. **[v0.2]**                                                                                                                                                                                                                                                                        |
| **CSRF on MFA mutating endpoints**                   | All MFA actions inherit Hono session `SameSite=Strict` cookies. Phase 0 verifies the cookie config and adds an explicit assertion test. **[v0.2]**                                                                                                                                                                                                                                                                                                        |
| SSO bypass (IdP-side)                                | When `User.sso === true` AND `org.ssoDetailsId` is set, MFA is delegated to the IdP — workspace owner's responsibility (documented). Optional Phase 5+ enhancement: warn owner if SSO is on and they want to also enroll Shelf-side MFA.                                                                                                                                                                                                                  |

---

## 7. Edge cases

| Case                                                       | Behavior                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User in 2 workspaces, only one enforces                    | One enrollment satisfies both. Gate fires only when the enforcing workspace is active.                                                                                                      |
| User opens app in 2 tabs during enrollment                 | Backup codes shown once; if they navigate away without confirming, `/api/mfa/backup-codes/regenerate` issues new set, invalidates old.                                                      |
| Lost device + has backup codes                             | Sign in with password → `/mfa/challenge` → "use backup code" → consumed → forced enroll new TOTP → factor verifies → aal2 → original target. Email sent.                                    |
| Lost device + no backup codes                              | Owner uses `/api/mfa/admin/reset/:userId` → email → user clicks → factor force-deleted → `/mfa/recover-and-reenroll` → re-enroll.                                                           |
| Sole-owner loses everything                                | Sole owner can still log in (password works) but can't access enforcing workspace. Recovery: backup code, transfer ownership, or Shelf support. **Documented in admin guide.**              |
| Owner enables, then disables before grace expires          | `mfaEnforcedAt = NULL`. Members revert. Both events logged via `MfaEnforcementEvent`. Reminder jobs no-op at fire time (§4.7) — no cancellation needed.                                     |
| Owner enables, then re-enables with shorter grace          | New value replaces old. Re-notification email sent. New reminder jobs queued; any stale ones from prior cycle no-op.                                                                        |
| User enrolled, then enforcement turned off                 | Enrollment stays. Nothing forces them.                                                                                                                                                      |
| User enrolled in workspace A, joins enforcing workspace B  | Already satisfied. Normal Supabase aal2 step-up on next login.                                                                                                                              |
| Pending invitee, owner enables enforcement                 | Invite valid. First login = no enrollment + no grace (they're new) → directly to `/mfa/setup`.                                                                                              |
| User signs in via SSO at enforcing workspace               | `User.sso === true` AND `org.ssoDetailsId` set → delegate → allow. **v0.2-rev:** SSO check is org-scoped (not global).                                                                      |
| SSO-flagged user accesses non-SSO enforcing workspace      | `user.sso === true` but `org.ssoDetailsId === null` → MFA enforcement applies normally. **[v0.2 — new]**                                                                                    |
| User signs in via OTP at enforcing workspace               | OTP login = aal1 → TOTP step-up like password user.                                                                                                                                         |
| User unenrolls last factor while enforcement on            | Self-path: button disabled with "MFA required by this workspace" message. Owner reset: bypasses (deliberate).                                                                               |
| User has multiple TOTP factors enrolled                    | Schema 1:N. v1 UI restricts to one. v2 will allow N (no schema change).                                                                                                                     |
| Email change while enrolled                                | Factor bound to user_id, not email. Keeps working. **v0.2:** email-change action requires fresh aal2 step-up (§4.11).                                                                       |
| **AAL stale on cookie after verify (regression scenario)** | Verify endpoint MUST rewrite Hono session cookie with new tokens (§4.10). If a colleague forgets this in a future verify endpoint, the regression test in CI fails before merge. **[v0.2]** |
| Logged-in user during grace, grace expires mid-session     | Next request → loader-level helper sees no factor + expired → 302 to `/mfa/setup`. Same as fresh login.                                                                                     |
| Workspace deleted while enforcement on                     | Cascade deletes the enforcement state. User's enrollment unaffected.                                                                                                                        |
| **Mobile: first-time pairing (PKCE)**                      | Tap "Sign in with Shelf" → browser → web auth (incl. MFA) → deeplink with `code` only → mobile back-channel POST exchanges `code+verifier` for tokens → SecureStore → home.                 |
| **Mobile: code intercepted by sibling app (Android)**      | Sibling app sees `shelf://auth-complete?state=…&code=…`. Cannot redeem `code` — it doesn't have `code_verifier` (which never left the originating device). Code expires in 60s. **[v0.2]**  |
| **Mobile: token refresh while signed in**                  | `autoRefreshToken: true` handles it; refresh preserves aal per Supabase docs. No browser re-open.                                                                                           |
| **Mobile: workspace enables MFA mid-session**              | Next API call may return 401 if aal1 + enforcement. App detects, shows "Re-authenticate" → re-pair via web.                                                                                 |
| **Mobile: deeplink-from-email**                            | If app installed, OS routes to deeplink handler. State validation rejects deeplinks without matching pending state — emailed deeplinks fail safely.                                         |
| **Mobile: pairing abandoned mid-flow**                     | Pending state stored in SecureStore under attempt-specific key. On next launch, an `expiresAt`-based cleanup pass removes stale pairing records (>24h). **[v0.2]**                          |

---

## 8. Phased plan with rollback

Each phase ends with something demoable. Each phase has an explicit rollback path. Phases marked `[parallel]` run alongside the previous phase if engineering capacity permits.

### Phase 0 — Prereqs (~1.5d, was 0.5d)

- Land Logger allow-list rule scrubbing `secret`, `uri`, `qr_code` from any logged objects.
- **Add Sentry `beforeSend` denylist** scrubbing the same keys from breadcrumbs and event context (Sentry captures context independent of Logger).
- Stand up a dev Supabase project for MFA testing (avoid polluting prod `auth.users`).
- **Verify Supabase TOTP secret encryption-at-rest posture** — query `auth.mfa_factors` to confirm whether `secret` is pgsodium-wrapped or relies on disk-level encryption only. If only disk-level, raise with Supabase or wrap pgsodium ourselves before Phase 1 dogfood.
- **Verify rate-limit primitive availability.** Audit existing endpoints for the rate-limit pattern; if none exists, implement a small Redis- or Postgres-backed primitive (one-off — useful beyond MFA work).
- **Confirm Hono session cookie config** has `SameSite=Strict` (or at least `Lax` with sensible defaults). Add an assertion test.
- **Decide backup-code hash primitive.** v0.2 decision: HMAC-SHA256 with server-side pepper (env-secret separate from `SESSION_SECRET`). Add `MFA_BACKUP_CODE_PEPPER` to env validation. (If HMAC is rejected on review, fall back to argon2id — but the §5.2 rationale stands.)

**Rollback:** N/A (no production change).

### Phase 1 — Webapp self-enrollment (~4d, was 3d)

Self-service MFA. No enforcement yet. Anyone can enable for themselves.

- Prisma migration: `MfaFactor`, `MfaBackupCode`. (Migration is additive-only; rollback = `prisma migrate resolve --rolled-back`.)
- New `app/modules/auth/jwt.server.ts` with `decodeJwtClaims`. **Document trust boundary** in `CLAUDE.md` (§4.2).
- Extend `mapAuthSession` to capture `aal`, `amr`. Add safety test for missing `aal`.
- New `app/modules/mfa/service.server.ts` wrapping `auth.mfa.enroll/challengeAndVerify/unenroll/listFactors`. Uses `getSupabaseAsUser()`.
- New `app/modules/mfa/backup-codes.server.ts` (HMAC-SHA256 with server pepper — see Phase 0 decision).
- New helper `getSupabaseAsUser()` in [integrations/supabase/client.ts](apps/webapp/app/integrations/supabase/client.ts).
- Routes: `/mfa/setup`, `/settings/account/security`.
- UI: `<MfaSetupCard>`, `<BackupCodesPanel>`.
- Email: `mfa-enrolled.tsx`.
- Add env flag `ENABLE_MFA_SELF_ENROLLMENT` to `app/config/shelf.config.ts` and `app/utils/env.ts`. Routes return 404 when off.
- Feature flag check: routes/links hidden when `config.enableMfaSelfEnrollment === false`.
- **Extend `/logout` to call `supabase.auth.signOut({ scope: 'global' })`** for users with MFA enrolled (closes "logout doesn't revoke Supabase tokens" gap).
- **Per-user-per-hour rate limit on `/api/mfa/enroll`** (§4.11). Reuses Phase 0 primitive.

**Demo:** any user can enable MFA on their own account. Login flow doesn't yet challenge them (Phase 2 adds that).

**Rollback:** flip flag to `false`. Routes 404. Existing enrolled users keep their factors but face no challenge. No data lost. To fully unwind: `auth.admin.mfa.deleteFactor` for each `MfaFactor`, then `prisma migrate resolve --rolled-back`.

### Phase 1.5 — Mobile auth pivot with PKCE [parallel with Phase 1] (~5d, was 4d)

- New `apps/companion/lib/web-auth.ts` — PKCE setup (`code_verifier`/`code_challenge`), `state`, browser launch, deeplink consumption, **back-channel exchange POST** (§4.5).
- Extend `apps/companion/lib/deep-links.ts` for `shelf://auth-complete` + `shelf://auth-failed`.
- Rewrite `apps/companion/lib/auth-context.tsx` — `signIn()` → `signInViaWeb()`.
- Replace `apps/companion/app/(auth)/login.tsx` with single-button screen.
- Delete `apps/companion/app/(auth)/forgot-password.tsx`, `apps/companion/hooks/use-form-validation.ts`.
- **Prisma migration: `MobileAuthCode` table** (additive). Cleanup job via PgBoss every 5 min.
- Webapp: new `apps/webapp/app/routes/_auth+/mobile-handoff.tsx` — validates `state` + `code_challenge`, mints `MobileAuthCode`, deeplinks back with **code only**.
- Webapp: new `apps/webapp/app/routes/api+/mobile.exchange.ts` — atomic single-use code redemption with PKCE verification (§4.5).
- Webapp: new `apps/webapp/app/modules/mobile-auth/mobile-auth-code.server.ts` helper.
- Webapp: add `/mobile-handoff` to `protect()` public-paths list (matches the `/accept-invite/*` pattern — loader handles unauth by redirecting to `/login?return=/mobile-handoff?state=...&code_challenge=...`). MFA enforcement applies via the loader-level helper (§4.3) — by the time we mint a code, the session is at the right AAL.
- **Per-IP rate limit on `/api/mobile/exchange`** (§4.11).
- Maestro E2E: rewrite ~10 auth flows.
- Manual test on iOS simulator + Android emulator.

**Demo:** companion app authenticates via web with PKCE; sessions persist across launches; tokens never appear in any URL.

**Rollback:** mobile is in dev/preview EAS profile only — no production users yet. Rollback = revert the mobile commits, redeploy preview build. Webapp `/mobile-handoff` and `/api/mobile/exchange` routes are harmless if mobile reverts (they 404-equivalent without a valid pairing flow).

### Phase 2 — Step-up on web login when enrolled (~4d, was 3d)

- Add `enforceMfaForRoute()` loader-level helper (§4.3) — lighter version: only own enrollment + AAL, no workspace policy yet.
- Wire helper into the authenticated layout loader so it runs on every protected route.
- Route `/mfa/challenge` with TOTP input + "use backup code" toggle.
- Loader/action: `challengeAndVerify` → **rewrite session cookie with new tokens** (AAL freshness contract, §4.10).
- Add `requireAal2()` route-level helper for sensitive-action step-up (§4.11). Wire it into `/settings/account` email-change action and `/settings/account/password`.
- Backup-code path: validate `MfaBackupCode` (HMAC verify with pepper) → mark consumed → 302 to `/mfa/setup?recovery=true`.
- Email: `mfa-backup-code-used.tsx`.
- **Per-user + per-IP rate limit on `/api/mfa/verify`** (TOTP + backup-code paths) per §4.11. Lockout email after threshold.
- **Mandatory regression test:** verify endpoint rewrites session cookie post-verify with `aal: 'aal2'` (§4.10). Must run in CI.
- Tests: aal1 user blocked → challenge → aal2 → access. Backup code consumes once. Force re-enroll end-to-end. Email-change requires aal2. Brute-force protection triggers lockout after N attempts.

**Demo:** enrolled users now face TOTP prompt every fresh login. Sensitive account edits require fresh aal2.

**Rollback:** helper checks `config.enableMfaSelfEnrollment` — if false, no-op. Flag flip = full rollback.

### Phase 3 — Workspace enforcement toggle (~7d, was 5d)

- Prisma migration: 4 columns on `Organization`, plus `MfaEnforcementEvent` table. Additive.
- New `app/modules/mfa/enforcement.server.ts` — enable, disable, get-policy.
- Owner-only route `/settings/workspace/security` with `<MfaEnforcementToggle>` and grace-period selector.
- Owner self-prerequisite gate at enable-time (§4.8).
- Hide toggle on `OrganizationType.PERSONAL` orgs.
- **Extend `enforceMfaForRoute()` (§4.3) to look up org policy + apply grace logic + apply org-scoped SSO check** (`user.sso && org.ssoDetailsId`).
- Extend `getSelectedOrganization` query to include 4 MFA columns + `mfaFactors: { select: { id: true } }` user join + `ssoDetailsId` (already there for some org reads — verify in implementation).
- `<MfaGraceBanner>` in workspace shell.
- Email: `mfa-enforcement-enabled.tsx` to all members on toggle.
- `MfaEnforcementEvent` writes for `ENABLED`, `DISABLED`, `GRACE_CHANGED`.
- Add `ENABLE_MFA_ENFORCEMENT` flag.
- **Document the dual-flag matrix** in `CLAUDE.md` and the new `apps/docs/security-mfa.md`:

  | `ENABLE_MFA_SELF_ENROLLMENT` | `ENABLE_MFA_ENFORCEMENT` | Behavior                                                       |
  | ---------------------------- | ------------------------ | -------------------------------------------------------------- |
  | false                        | false                    | No MFA surface anywhere (current state)                        |
  | true                         | false                    | Voluntary enrollment + step-up for enrolled users only         |
  | true                         | true                     | Everything: enrollment, step-up, workspace toggle              |
  | false                        | true                     | **Disallowed** — env validation rejects (asserted in `env.ts`) |

- Tests: end-to-end with two users (one owner one member); SSO user delegation **with org-scoped check**; OTP-login user step-up; Personal workspace toggle hidden; SSO-flagged user accessing non-SSO org still faces enforcement.

**Demo:** owner enables enforcement → all members see banner → enrolled members continue normally; unenrolled have N days.

**Rollback:** `ENABLE_MFA_ENFORCEMENT=false` → loader-level helper skips workspace policy entirely (still does Phase 2's own-enrollment check). All `mfaEnforcedAt` data preserved. Re-enable resumes where it was.

### Phase 4 — Grace expiry behavior (~2d, was 1d)

- PgBoss-scheduled reminders T-3d, T-1d, queued at enforcement-enable. **No cancellation API** — handlers no-op at fire time when `mfaEnforcedAt IS NULL` (§4.7). Idempotent across enable/disable cycles.
- "Grace expired" email sent at first redirect-after-expiry.
- Members table column with status + filter (read of `MfaFactor.exists` per row, indexed).
- No cron — pure PgBoss + lazy enforcement at next request.

**Demo:** unenrolled user is blocked at next request after grace expiry; emails arrive on schedule; disabling enforcement mid-cycle leaves stale jobs that no-op safely on fire.

**Rollback:** `ENABLE_MFA_ENFORCEMENT=false` → reminder jobs no-op. Re-enabling queues fresh jobs; any in-flight stale ones still no-op.

### Phase 5 — Owner reset + recovery (~3d, was 2d)

- Prisma migration: `MfaResetToken`. Additive.
- `/api/mfa/admin/reset/:userId` — **hardened action per §4.9**:
  - Cross-org membership check (target must be in owner's org).
  - `auth.admin.signOut(userId, 'global')` BEFORE factor deletion (revokes all sessions).
  - Transactional Supabase factor delete + local `MfaFactor` + `MfaBackupCode` cleanup.
  - 256-bit random token, SHA-256 hashed at rest, 1h expiry.
  - Per-owner rate limit (3/hour) per §4.11.
- `/mfa/recover-and-reenroll`: validates token (atomic single-use redemption), allows re-enroll without authenticated session.
- `MfaEnforcementEvent` writes for `MEMBER_RESET` (audit row written before email send).
- Owner UI: members table button "Reset MFA" + confirmation modal that surfaces "this will sign the user out of all sessions."

**Demo:** member loses device, owner resets, member re-enrolls; attacker holding a stolen aal2 token for that user is signed out.

**Rollback:** disable the reset endpoint via flag if needed. Existing tokens age out naturally (1h expiry).

### Phase 6 — Polish (~4d)

- Localization keys for all MFA strings.
- React-doctor pass on touched components.
- Pen-test of recovery + reset flows.
- Documentation: `/apps/docs/security-mfa.md` (admin + member guide; documents the sole-owner-recovery process).
- Marketing-page mention.
- Internal dogfood for 1 week.

### Estimate summary

> v0.2 estimates are up from v0 due to security hardening (PKCE, force-reset, AAL freshness, rate-limiting) and the middleware-tier correction. Honest sizing — these are not buffers.

| Phase                                   | v0 Estimate | **v0.2 Estimate** | Reason for change                                                                                                               |
| --------------------------------------- | ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Prereqs                             | 0.5d        | **1.5d**          | Sentry scrubbing, Supabase TOTP encryption verify, rate-limit primitive audit, cookie-config assertion, hash-primitive decision |
| 1 — Self-enrollment (web)               | 3d          | **4d**            | Logout global-signOut, per-user rate limit, trust-boundary docs                                                                 |
| 1.5 — Mobile pivot [parallel]           | 4d          | **5d**            | PKCE flow + `MobileAuthCode` table + exchange endpoint                                                                          |
| 2 — Step-up on login                    | 3d          | **4d**            | AAL freshness regression test, `requireAal2` helper, sensitive-action wiring, brute-force rate limit                            |
| 3 — Workspace toggle                    | 5d          | **7d**            | Loader-level helper wiring, org-scoped SSO check, dual-flag matrix docs, expanded test matrix                                   |
| 4 — Grace expiry                        | 1d          | **2d**            | No-op-at-fire-time handler change, member-table column with EXISTS join                                                         |
| 5 — Owner reset                         | 2d          | **3d**            | Cross-org membership check, atomic transaction with global signOut, rate limit, audit-before-email                              |
| 6 — Polish                              | 4d          | **4d**            | Unchanged (localization, doctor pass, pen-test, docs, dogfood)                                                                  |
| **Total (single engineer, sequential)** | **~22d**    | **~30d**          | +8d                                                                                                                             |
| **Total (two engineers, parallelized)** | **~13d**    | **~17d**          | Mobile track absorbs +1d                                                                                                        |

---

## 9. Monitoring & observability

Instrumentation we add (Sentry + structured logger):

| Metric / event                         | When                                       | Why                                |
| -------------------------------------- | ------------------------------------------ | ---------------------------------- |
| `mfa.enroll.attempt`                   | `/api/mfa/enroll` action start             | Track funnel + rate-limit triggers |
| `mfa.enroll.success`                   | Factor verified                            | Conversion from attempt            |
| `mfa.enroll.fail` (with reason)        | Rate-limited / wrong-code / Supabase-error | Debug + alarm thresholds           |
| `mfa.challenge.attempt`                | `/mfa/challenge` action start              | Login-step traffic                 |
| `mfa.challenge.success`                | aal2 minted                                | Conversion                         |
| `mfa.challenge.fail` (reason)          | Wrong code / expired challenge             | Anomaly detection                  |
| `mfa.backup_code.used`                 | Consumed                                   | Security signal                    |
| `mfa.admin.reset.issued`               | Owner triggers                             | Audit                              |
| `mfa.enforcement.enabled`              | Owner enables on org                       | Adoption                           |
| `mfa.enforcement.disabled`             | Owner disables                             | Adoption                           |
| `mfa.middleware.redirect_to_setup`     | Forced setup redirect                      | Track grace expiry impact          |
| `mfa.middleware.redirect_to_challenge` | Step-up redirect                           | Volume                             |

Sentry alerts:

- `mfa.enroll.fail` rate spike → likely Supabase outage or rate-limit issue.
- `mfa.challenge.fail` rate above 25% sustained → possible UX regression or attack.
- `mfa.middleware.redirect_to_setup` per-user count > 1 within an hour → user is in a redirect loop (bug).

---

## 10. Rollout

1. **Phase 0–2 deploy.** `ENABLE_MFA_SELF_ENROLLMENT=true` in staging. Internal dogfood for 1 week.
2. Flip in production. Self-enrollment available; no enforcement.
3. **Phase 3+ deploy.** `ENABLE_MFA_ENFORCEMENT=true` in staging.
4. Beta: invite 3–5 customers who asked for SSO. 2-week observation window.
5. After 2 weeks with no Sev1, flip flag in production. GA on all paid plans. Free plan keeps self-enrollment but not enforcement toggle.
6. Marketing announcement; `/apps/docs/security-mfa.md` published.
7. Mobile companion proceeds to TestFlight under web-delegated auth.

---

## 11. Open questions remaining

> Items that genuinely cannot be resolved without external input. Everything else is a decision in §3.

1. **Personal-access tokens for service-account use.** Shelf has none today. Out of scope for this PRD but worth documenting: if/when PATs are added, they should require fresh aal2 to issue, and should bypass MFA enforcement when used (because they ARE the user's "second factor" — possession of the token).
2. **SSO + Shelf-side MFA stacking opt-in.** Default is delegation. A security-conscious customer could ask for both. Phase 5+ if anyone requests it.
3. **Granular per-action step-up beyond email/password.** v0.2 covers email/password/MFA-self-management with `requireAal2()`. Per-action step-up for individual mutations (e.g. "delete asset" → require MFA) is out of scope for v1. Customer-pull will trigger v1.5.
4. **Sole-owner break-glass support flow.** Engineering side is documented. Operations side (Shelf support process for "owner lost everything, we need to verify identity and reset") needs to be defined in the support runbook before GA.
5. **Runtime kill switch.** v0.2 keeps env-var flags as the source of truth (require redeploy to flip, ~2 min minimum). For a feature whose worst-case failure mode is "all users locked out," a DB-backed runtime override would be safer. Open question for CTO: is the env-var lag acceptable for v1, or do we add a `system_flags` row in Phase 0?
6. **Supabase TOTP secret encryption-at-rest posture.** Phase 0 verification task; if Supabase confirms only disk-level encryption, do we wrap with pgsodium ourselves before Phase 1 dogfood, or accept risk and document?

---

## 12. Files most likely to be touched

> Reference for the eng team and CodeRabbit. Phase numbers in parens. New files marked `[NEW]`.

### Webapp — Schema & core

- `packages/database/prisma/schema.prisma` _(P1, P1.5, P3, P5)_ — adds `MfaFactor`, `MfaBackupCode`, `MobileAuthCode` (P1.5), org columns + `MfaEnforcementEvent` (P3), `MfaResetToken` (P5)
- `apps/webapp/app/modules/auth/mappers.server.ts` _(P1)_ — extend with JWT claim decode
- `apps/webapp/app/modules/auth/jwt.server.ts` _(P1)_ `[NEW]`
- `apps/webapp/app/modules/mfa/service.server.ts` _(P1)_ `[NEW]`
- `apps/webapp/app/modules/mfa/enforcement.server.ts` _(P2, P3)_ `[NEW]` — **loader-level helper** (`enforceMfaForRoute`); P2 ships own-enrollment check; P3 extends with org policy + grace
- `apps/webapp/app/modules/mfa/backup-codes.server.ts` _(P1)_ `[NEW]` — HMAC-SHA256 with server pepper
- `apps/webapp/app/modules/mfa/step-up.server.ts` _(P2)_ `[NEW]` — `requireAal2()` for sensitive actions
- `apps/webapp/app/modules/mobile-auth/mobile-auth-code.server.ts` _(P1.5)_ `[NEW]` — PKCE code mint/redeem
- `apps/webapp/app/modules/organization/context.server.ts` _(P3)_ — extend org-context query (4 MFA cols + `mfaFactors` user join + `ssoDetailsId`)
- `apps/webapp/app/integrations/supabase/client.ts` _(P1)_ — add `getSupabaseAsUser`
- `apps/webapp/server/index.ts` _(P1.5)_ — add `/mobile-handoff` and `/api/mobile/exchange` to public-paths
- `apps/webapp/server/session.ts` _(P1)_ — extend `AuthSession`
- `apps/webapp/server/logger.ts` _(P0)_ — secret scrubbing
- `apps/webapp/server/instrument.server.ts` _(P0)_ — Sentry `beforeSend` denylist
- `apps/webapp/app/utils/logger.ts` _(P0)_ — secret scrubbing
- `apps/webapp/app/config/shelf.config.ts` _(P1, P3)_ — `enableMfaSelfEnrollment`, `enableMfaEnforcement`
- `apps/webapp/app/utils/env.ts` _(P0, P1, P3)_ — env-var schema (incl. `MFA_BACKUP_CODE_PEPPER`, dual-flag matrix assertion)
- `apps/webapp/app/utils/rate-limit.ts` _(P0)_ — primitive (verify if exists; new if not)
- `apps/webapp/app/routes/_layout+/_layout.tsx` _(P2, P3)_ — wire `enforceMfaForRoute()` into authenticated layout loader
- `apps/webapp/app/routes/_layout+/settings.account.tsx` _(P2)_ — wire `requireAal2()` on email-change action
- `apps/webapp/app/routes/_layout+/settings.account.password.tsx` _(P2)_ — wire `requireAal2()` on password-change action
- `apps/webapp/app/routes/_auth+/logout.tsx` _(P1)_ — call `supabase.auth.signOut({ scope: 'global' })` for MFA-enrolled users
- `CLAUDE.md` _(P1, P3)_ — document trust boundary (§4.2), Supabase-client-mode rule (§4.9), dual-flag matrix (§8 P3)

### Webapp routes

- `apps/webapp/app/routes/_auth+/mfa.setup.tsx` _(P1)_ `[NEW]`
- `apps/webapp/app/routes/_auth+/mfa.challenge.tsx` _(P2)_ `[NEW]`
- `apps/webapp/app/routes/_auth+/mfa.recover-and-reenroll.tsx` _(P5)_ `[NEW]`
- `apps/webapp/app/routes/_auth+/mobile-handoff.tsx` _(P1.5)_ `[NEW]` — PKCE handoff (validates `state` + `code_challenge`, mints `MobileAuthCode`)
- `apps/webapp/app/routes/_layout+/settings.account.security.tsx` _(P1)_ `[NEW]`
- `apps/webapp/app/routes/_layout+/settings.workspace.security.tsx` _(P3)_ `[NEW]`
- `apps/webapp/app/routes/api+/mfa.enroll.ts` _(P1)_ `[NEW]`
- `apps/webapp/app/routes/api+/mfa.verify.ts` _(P2)_ `[NEW]` — rewrites session cookie post-verify (§4.10)
- `apps/webapp/app/routes/api+/mfa.unenroll.ts` _(P1)_ `[NEW]`
- `apps/webapp/app/routes/api+/mfa.backup-codes.regenerate.ts` _(P1)_ `[NEW]`
- `apps/webapp/app/routes/api+/mfa.admin.reset.$userId.ts` _(P5)_ `[NEW]` — hardened action (cross-org check + global signOut + atomic transaction, §4.9)
- `apps/webapp/app/routes/api+/mobile.exchange.ts` _(P1.5)_ `[NEW]` — PKCE back-channel exchange (single-use atomic redemption)

### Webapp UI

- `apps/webapp/app/components/mfa/mfa-setup-card.tsx` _(P1)_ `[NEW]`
- `apps/webapp/app/components/mfa/backup-codes-panel.tsx` _(P1)_ `[NEW]`
- `apps/webapp/app/components/mfa/mfa-challenge-form.tsx` _(P2)_ `[NEW]`
- `apps/webapp/app/components/mfa/mfa-status-badge.tsx` _(P3)_ `[NEW]`
- `apps/webapp/app/components/mfa/mfa-enforcement-toggle.tsx` _(P3)_ `[NEW]`
- `apps/webapp/app/components/mfa/mfa-grace-banner.tsx` _(P3)_ `[NEW]`

### Webapp emails

- `apps/webapp/app/emails/mfa/mfa-enrolled.tsx` _(P1)_ `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-enforcement-enabled.tsx` _(P3)_ `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-enrollment-reminder.tsx` _(P4)_ `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-grace-expired.tsx` _(P4)_ `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-reset-link.tsx` _(P5)_ `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-backup-code-used.tsx` _(P2)_ `[NEW]`

### Mobile companion

- `apps/companion/lib/auth-context.tsx` _(P1.5)_ — rewrite
- `apps/companion/lib/web-auth.ts` _(P1.5)_ `[NEW]`
- `apps/companion/lib/deep-links.ts` _(P1.5)_ — extend
- `apps/companion/app/(auth)/login.tsx` _(P1.5)_ — replace
- `apps/companion/app/(auth)/forgot-password.tsx` _(P1.5)_ — delete
- `apps/companion/hooks/use-form-validation.ts` _(P1.5)_ — delete

### Docs

- `apps/docs/security-mfa.md` _(P6)_ `[NEW]` — admin + member guide

---

## Appendix A — Considered alternatives & decision log

> One entry per fork. Format: **Decision** → **Alternatives weighed** → **Why we picked this** → **Cost of being wrong**.

### A.B Schema cardinality — `MfaFactor` 1:N

**Decision:** `MfaFactor` model with `@@index([userId])`. v1 UI restricts to one factor per user.

**Alternatives:** `MfaEnrollment` 1:1 with `@unique userId`. Forces 1:N migration later.

**Why:** Matches Supabase's `auth.mfa_factors` (1:N). Future multi-factor support is purely a UI change. Trivial cost: one index instead of one unique constraint.

**Cost:** none meaningful.

### A.C Recovery codes — build our own (10 codes)

**Decision:** 10 single-use 12-char base32 codes (`AAAA-BBBB-CCCC`), argon2id-hashed, plaintext shown once.

**Alternatives:** (1) Supabase's "enroll multiple TOTP factors" suggestion — doesn't help if user enrolls one and loses it. (2) Skip recovery; require admin reset — bad UX, fails for sole owners.

**Why:** Industry standard (1Password, Auth0, Okta). Solves the lost-device case without admin involvement.

**Cost:** small dev cost (~0.5d). One more security-sensitive primitive.

### A.D Backup-code consumption — forced re-enrollment

**Decision:** consumption marks code used and forces re-enrollment of a new TOTP factor before aal2 is granted.

**Alternatives:** elevate AAL directly from a backup code — technically impossible because Supabase mints aal2 only via `mfa.verify` against a real factor.

**Why:** the only Supabase-compatible path. Also the more secure pattern (re-arms MFA on recovery).

**Cost:** UX friction (one extra setup step on recovery). Mitigated by clear copy.

### A.E SSO — delegate to IdP (org-scoped)

**Decision (v0.2):** Delegate MFA to the IdP only when `User.sso === true` **AND** the active org has `ssoDetailsId` set. A user provisioned via SSO who's also a member of a non-SSO team workspace still faces MFA enforcement on that non-SSO workspace.

**Alternatives:** (1) Global delegation when `User.sso === true` (v0's draft) — but `User.sso` is global per the schema (`packages/database/prisma/schema.prisma:47`), and a user can be in multiple orgs with different SSO posture. Globally delegating could leave non-SSO orgs unprotected. (2) Stack TOTP on top of SSO (GitHub model) — double-prompt UX. (3) Block SSO+MFA combo — restrictive.

**Why org-scoped:** the policy belongs to the **org**, not the user. A user's global SSO flag records how they originally joined Shelf; it doesn't tell us anything about the policy of an org they later joined. Match the actual access boundary.

**Cost:** slightly more complex check (`user.sso && org.ssoDetailsId`). If a customer's IdP doesn't enforce MFA and the workspace owner doesn't enforce Shelf-side MFA either, that single workspace is single-factor — documented in admin guide.

### A.F Grace period — configurable, default 7d

**Decision:** `0 / 24h / 7d / 14d / 30d`, default `7d`.

**Alternatives:** (1) Slack's fixed 24h. (2) Vercel/GitHub's none. (3) Google's 1d–6mo open range.

**Why:** B2B asset-management has variable login cadence. 7d covers "I haven't logged in this week." 5 options bracket meaningful intervals without decision fatigue.

**Cost:** small support load ("which should I pick?"). Mitigated by inline guidance.

### A.G Grace expiry — block at next request

**Decision:** middleware blocks unenrolled users at the next loader/action request after `enforceAfter`. No proactive sweep, no session termination.

**Alternatives:** Cron sweep + terminate sessions at expiry instant.

**Why:** No new infra (CTO Rule 1). Friendlier UX. Security equivalent — typical request cadence is <5 min.

**Cost:** <5-min window of access between expiry and next request. Acceptable.

### A.H OTP / magic-link — aal1 step-up

**Decision:** OTP login produces `aal1`. Users with TOTP enrolled face the same step-up as password users.

**Alternatives:** (1) Treat OTP as aal2 — email-as-MFA is industry-rejected. (2) Block OTP at MFA-enforced workspaces — penalizes OTP-loving users.

**Why:** Honors Supabase's authoritative AAL. Email isn't a strong second factor.

**Cost:** OTP-loving users get one extra step. Acceptable.

### A.I Pricing — free on all paid plans, free-tier self-enrollment only

**Decision:** Self-enrollment free for everyone. Workspace enforcement free on all paid plans. No enterprise paywall.

**Alternatives:** (1) Enterprise-only enforcement. (2) Paywall self-enrollment too.

**Why:** Industry trend (GitHub, Slack, Atlassian all free). Notion gets criticism for SAML-only-MFA-enforcement gating.

**Cost:** small foregone revenue. Easy to adjust later if positioning changes.

### A.K Step-up frequency — once per session

**Decision:** TOTP required once per session (3-day cookie life).

**Alternatives:** Per-action, daily, per-app-launch.

**Why:** Matches GitHub/Slack norms. Strong enough for Shelf's risk profile. Simpler implementation.

**Cost:** stolen session cookie + valid aal2 grants 3 days. Mitigated by short access-token TTL (Supabase default 1h) + revocation pathway.

### A.L Mobile auth — web-delegate with PKCE

**Decision (v0.2):** Companion app authenticates via system browser. Mobile receives a single-use auth code via `shelf://auth-complete` deeplink, then exchanges the code (with a PKCE `code_verifier` that never left the device) for tokens via a back-channel HTTPS POST to `/api/mobile/exchange`. **Tokens never appear in any URL.**

**Alternatives:**

1. **Native MFA UI in mobile** (~1.5–2 weeks, doubles MFA codepaths). Rejected: maintenance overhead and SSO usually needs a browser anyway.
2. **Exempt mobile entirely.** Security gap, eventual sunset migration.
3. **v0's draft: tokens in deeplink URL.** Rejected for v0.2 — refresh tokens (long-lived) in URLs leak via browser history, OS analytics, crash reports, and (on Android) sibling apps that registered the same custom scheme. The OAuth 2.0 spec deprecated implicit flow specifically because of this; PKCE auth-code-with-back-channel-exchange is the standard public-client pattern (RFC 7636).

**Why:** Companion is at 35% completion, pre-TestFlight. ~−95 LOC net change, zero new deps (`expo-crypto` already installed). Modern UX (Discord, MS Authenticator, Linear pattern). Smaller App Store review surface. PKCE is the table-stakes secure-mobile pattern.

**Cost:** UX regression (browser launch vs native form). Beta expectations absorb. PKCE adds ~1 day eng work and one new DB table (`MobileAuthCode`) — small price for closing a real interception class.

### A.M Live enforcement state — columns on Organization

**Decision:** 4 fields on existing `Organization` model: `mfaEnforcedAt`, `mfaEnforceAfter`, `mfaGraceSeconds`, `mfaEnabledByUserId`.

**Alternatives:** Separate `MfaEnforcement` model with org FK.

**Why:** Folds into existing `getSelectedOrganization` query — zero marginal DB cost on hot path. Minimizes refactor surface (CTO Rule 3). Audit trail handled by separate `MfaEnforcementEvent` table.

**Cost:** mild model bloat. 4 columns is well within Postgres tolerance.

### A.N Phone factor / WebAuthn — out of scope

**Decision:** TOTP only.

**Alternatives:** Phone factor (SMS) — has SIM-swap risk and SMS cost. WebAuthn — undocumented in Supabase 2.103.

**Why:** TOTP is free, mature, ubiquitous. Schema is factor-type-agnostic — adding more factor types later is additive.

**Cost:** customers wanting SMS or passkeys are deferred. Acceptable.

### A.O Personal workspaces — hide toggle

**Decision:** `OrganizationType.PERSONAL` workspaces don't show the enforcement toggle.

**Alternatives:** Show on all; show but disabled.

**Why:** Personal workspaces have one user. Enforcement is meaningless.

**Cost:** none.

### A.P Audit log — narrow `MfaEnforcementEvent` table

**Decision:** Single dedicated table for MFA enforcement events. No generic workspace audit log in this PRD.

**Alternatives:** (1) Build a generic `WorkspaceAuditLog` (~3d additional). (2) Sentry-only logging.

**Why:** Follows the existing `RoleChangeLog` precedent — narrow, dedicated, "tech debt isolated to one place" (CTO Rule 3). Generic audit log is a bigger product question and out of scope here. Sentry-only forfeits user-facing visibility.

**Cost:** no general audit log surface for non-MFA events. If/when a customer asks for a workspace audit log, the existing pattern (`RoleChangeLog`, `MfaEnforcementEvent`) can be unified.

### A.Q Supabase client mode — `getSupabaseAsUser` helper

**Decision:** new `getSupabaseAsUser(authSession)` helper. Used exclusively for user-context MFA calls. Admin client reserved for service-role operations.

**Alternatives:** Use `getSupabaseAdmin()` everywhere (current pattern, wrong for MFA), or pass tokens manually per call site (error-prone).

**Why:** One canonical entry point per mode. Documents the rule.

**Cost:** trivial.

### A.R Enforcement check tier — loader-level helper, not Hono middleware

**Decision (v0.2):** MFA enforcement is a **loader-level helper** (`enforceMfaForRoute()` in `app/modules/mfa/enforcement.server.ts`) called from authenticated layouts after `getSelectedOrganization`. It piggybacks on the existing per-request `AsyncLocalStorage` cache in `apps/webapp/app/modules/organization/context.server.ts:177`.

**Alternatives:**

1. **v0's draft: Hono middleware.** Rejected — it read `c.get('orgContext')`, but no upstream middleware in `apps/webapp/server/index.ts` ever sets that. `getSelectedOrganization` runs per-loader, not in the middleware chain. The v0 design literally couldn't run.
2. **Hono middleware that fetches its own org context.** Considered — would add a fresh DB query for every authenticated route, including ones that don't touch org data (`/api/healthcheck`, webhook endpoints). Real perf regression for the common case.
3. **Routes-level HOC / decorator.** Possible but doesn't compose with Remix's loader contract; Remix doesn't have a clean primitive here.

**Why loader-level:** matches the existing `requirePermission()` pattern in this codebase. Reuses the existing per-request cache (+0 DB queries on the common path). Routes that don't need enforcement (the MFA flow, healthcheck) opt out by simply not calling the helper — explicit and discoverable.

**Cost:** every authenticated layout/loader needs one explicit call (vs. one middleware setup). Minor; the call sites are concentrated in a small number of layout loaders.

### A.S Force-reset session revocation — global signOut before factor delete

**Decision (v0.2):** `/api/mfa/admin/reset/:userId` calls `auth.admin.signOut(targetUserId, 'global')` BEFORE deleting the Supabase factor and local DB rows. The local delete is transactional with the Supabase delete.

**Alternatives:** (1) Just delete the factor (v0's draft). Per the Supabase auth-traps checklist, deleting a factor or user does NOT invalidate existing access tokens; an attacker holding a stolen aal2 session keeps access until the token TTL expires (1h access, 30d refresh). (2) Sign out only after delete. Worse: brief window where the factor is gone but session is still valid; the session would simply be "aal2 with no factor" — strange state. (3) Skip atomicity — leaves possible state where Supabase says "no factor" but local DB says "enrolled."

**Why:** force-reset is an action almost always taken because of suspected compromise. Without revocation, the worst-case attacker simply continues operating. Atomic + revocation collapses the window to ~zero.

**Cost:** one extra admin API call. ~50ms. The transactional local delete adds a small amount of code. Worth it.

### A.T AAL freshness contract — verify rewrites session cookie

**Decision (v0.2):** every MFA verify endpoint MUST rewrite the Hono session cookie with the post-verify access+refresh tokens before returning. Regression-tested in CI before Phase 2 ships.

**Alternatives:** (1) Trust that Supabase eventually refreshes. Per the Supabase auth-traps checklist: JWT claims aren't fresh until the user's token is refreshed, so the OLD cookie carries `aal: 'aal1'` indefinitely (until refresh in ~1h). User would face redirect loop on `/mfa/challenge`. (2) Force a session refresh on every request after verify — wasteful and unnecessary.

**Why:** the verify endpoint is the only place that knows aal2 was just minted; it's the natural place to write the new tokens to the cookie.

**Cost:** one additional `setSession()` call per verify path. Trivial. The mandatory regression test is the more important investment — it catches regressions that would otherwise reach production.

### A.U Rate limiting & lockout — per-user + per-IP, account alert email

**Decision (v0.2):** Per-user 5 / 15-min and per-IP 20 / hour on TOTP verify; per-user 3 / 15-min on backup-code verify; account-level alert email on lockout. Matches Auth0 / Better-Auth conventions (slightly looser to reduce false-positive lockout on flaky users).

**Alternatives:** (1) No rate limiting (v0). Per the security review, TOTP without rate-limit = ~17 minutes of brute force on stolen aal1 cookie. Not acceptable. (2) Stricter (3 / 10s like Better-Auth default). False-positive risk too high; users hitting refresh during MFA challenge could lock themselves out. (3) Soft alerts only without lockout. Doesn't actually stop the attack — just notices it.

**Why:** these specific numbers track Auth0 defaults and produce >100-year MTTC on brute force at the per-user limit. Per-IP cap defends against distributed attacks against a single account. Account-level alert email gives the user agency.

**Cost:** depends on Phase 0 finding. If Shelf already has a Redis-backed primitive, this is cheap (~0.5d). If not, the primitive itself is the work (~1.5d) — but it's reusable beyond MFA.

### A.V Reminder cancellation — no-op at fire time

**Decision (v0.2):** PgBoss reminder jobs check `mfaEnforcedAt IS NOT NULL && now() < mfaEnforceAfter` at fire time and silently no-op otherwise. No `pg-boss.cancel(jobId)` machinery.

**Alternatives:** (1) Store job IDs in the schema, cancel on disable. Adds a column or sibling table; more code; more failure modes (what if cancel fails?). (2) Mark jobs as ignored via a sweep — adds latency.

**Why:** the recheck-at-fire-time approach is **idempotent across enable/disable cycles**. Re-enabling within the original window simply lets the queued reminder fire (recheck succeeds). Brand-new enforcement queues fresh jobs; stale ones still no-op safely. No new infra.

**Cost:** in the rare scenario where a reminder fires very close to disable, the user sees one extra (irrelevant) email. Acceptable.

---

## Appendix B — Verified infrastructure assumptions

Codebase verification on 2026-04-29 (against `shelf-main` on `main`):

| Assumption                         | Verified?                                                                     | Source                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Workspace audit log                | ❌ Does not exist (only asset-audit and `RoleChangeLog`)                      | `packages/database/prisma/schema.prisma`                                                |
| PgBoss supports delayed jobs       | ✅ Yes — used in `apps/webapp/app/modules/asset-reminder/scheduler.server.ts` | scheduler.server.ts                                                                     |
| App-level cron                     | ❌ Explicitly disabled (`noScheduling: true`)                                 | `apps/webapp/app/utils/scheduler.server.ts`                                             |
| Personal-access tokens             | ❌ Do not exist; auth is JWT-only                                             | grep                                                                                    |
| Owner-role check helper            | ⚠️ Inline pattern (no centralized helper)                                     | `apps/webapp/app/routes/_layout+/account-details.workspace.$workspaceId.edit.tsx:77-85` |
| Feature-flag system                | ✅ Env-var based via `apps/webapp/app/config/shelf.config.ts`                 | shelf.config.ts                                                                         |
| `OrganizationType.PERSONAL` gating | ✅ Existing pattern in `organization/context.server.ts:92-95`                 | context.server.ts                                                                       |
| Per-request cache                  | ✅ `AsyncLocalStorage`-based via `request-cache.server.ts`                    | request-cache.server.ts                                                                 |
| `getSelectedOrganization` cost     | 1 DB round trip, ~25 selected fields with joins                               | organization/context.server.ts                                                          |

---

## Appendix C — Research artifacts

This PRD synthesizes four research streams. Source quotes available on request.

- **Webapp auth-implementation map** — every existing route, module, schema field, middleware in `shelf-main`. Confirms greenfield premise.
- **Supabase capabilities (v2.103.0)** — TOTP API surface, AAL semantics, JWT shape, admin force-unenroll, SSO interaction, gotchas. Verified against `pnpm-lock.yaml` resolution and the `@supabase/auth-js` source.
- **Industry pattern survey** — GitHub, Slack, Notion, Linear, Vercel, Atlassian, Google Workspace, Microsoft 365 — concrete behaviors per axis.
- **Mobile companion audit** — verified state on `feat/mobile-companion-app` branch. 35% completion, libraries, deeplinks, Maestro tests, EAS config.
- **Shelf infrastructure verification** — audit log, scheduler, cron, PATs, owner role, feature flags, perf hot path. (Appendix B summary.)

---

## 13. Reviewer checklist

- [ ] CTO confirms decisions in §3 (or overrides — every entry has Appendix A rationale).
- [ ] **Loader-level enforcement design in §4.3 confirmed** (path B chosen; Hono middleware was non-functional in v0).
- [ ] Schema diff in §4.1 reviewed for index correctness and cascade semantics — including new `MobileAuthCode` table.
- [ ] **PKCE token-exchange flow in §4.5 reviewed** before TestFlight build is initiated.
- [ ] **Force-reset hardening in §4.9 confirmed** — cross-org membership check, global signOut, atomic transaction.
- [ ] **AAL freshness contract in §4.10 acknowledged** — verify endpoints rewrite session cookie; regression test mandatory before Phase 2 ships.
- [ ] **Rate-limiting & sensitive-action step-up in §4.11 reviewed** — defaults match Auth0 / Better-Auth conventions.
- [ ] Performance numbers in §5 reviewed (CTO Rule 2: be specific on perf) — note loader-level helper means +0 DB queries on the common path.
- [ ] Security threat model in §6 reviewed by anyone with offensive-security experience.
- [ ] Trust boundary note (§4.2) added to `CLAUDE.md` so future contributors don't extend the JWT decoder to bearer-token paths.
- [ ] Logger AND **Sentry `beforeSend`** scrubbing both land in Phase 0 before any beta secrets touch external services.
- [ ] **Supabase TOTP secret encryption-at-rest** verified (Phase 0 task, §11.6).
- [ ] **Dual-flag matrix** (§8 Phase 3) documented in `CLAUDE.md` and `apps/docs/security-mfa.md`.
- [ ] Sole-owner break-glass support process drafted before GA (§11.4).
- [ ] Runtime kill-switch decision made (§11.5) — env var only, or DB override?
- [ ] Admin guide drafted before launch (not just engineering docs).
- [ ] Project-level skills in `.claude/skills/` (security-review, two-factor-authentication-best-practices, oauth-oidc-misconfiguration, auth0-mfa, supabase, supabase-postgres-best-practices) verified — colleagues can run `npx skills experimental_install` to restore from `skills-lock.json`.

---

_End of document._
