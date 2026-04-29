# PRD: Workspace-Level MFA Enforcement

> **Status:** v0 — ready for CTO review · **Date:** 2026-04-29
> **Audience:** Shelf CTO (Donkoko), founders, eng team, CodeRabbit
> **Source repos verified:** `shelf-main` (webapp on `main`), `shelf-pr1/apps/companion` (mobile on `feat/mobile-companion-app`)
> **Versions verified:** webapp `@supabase/supabase-js@^2.103.0`, companion `@supabase/supabase-js@^2.49.1`, Expo SDK 54, RN 0.81.5

---

## 0. Alignment with CTO design preferences

This plan is shaped against the rules surfaced during reporting-v2 planning:

- **No app-layer cron.** Verified: Shelf already runs `noScheduling: true` on PgBoss. v0 uses **PgBoss delayed jobs** (which the codebase already does — `apps/webapp/app/modules/asset-reminder/scheduler.server.ts`). No `setInterval`, no `node-cron`, no daily sweeps.
- **Minimize refactor surface.** Live enforcement state goes on **4 columns on the existing `Organization` model**, not a separate model. The MFA service is **one new module** at `app/modules/mfa/`. The middleware is **one new function** in the existing `server/middleware.ts`. No global audit log; we add a narrow `MfaEnforcementEvent` table that follows the `RoleChangeLog` precedent.
- **Be specific on perf.** Section §5 quantifies the per-request cost: **+0 DB queries on the hot path** (folded into the existing `getSelectedOrganization` query), **+~50µs JWT decode** in `mapAuthSession`, **+~3 lines of comparison logic** in middleware. Independently estimable; no hand-waving.
- **No BI-tool features.** The members-table MFA-status column is a static read (one boolean per row). No drag-and-drop, no SQL builder.

---

## 1. TL;DR

Workspace owners (`OrganizationRoles.OWNER`) opt their workspace into requiring **TOTP-based MFA** for all members, with a **configurable grace period** (default **7 days**). MFA is per-user-account — one enrollment satisfies all enforcing workspaces. After grace, unenrolled members are blocked at next request until they enroll. Supabase Auth provides TOTP primitives (v2.103.0 supports everything needed); Shelf builds backup codes (10 single-use) and owner-initiated reset on top.

SSO-bound users (`User.sso = true`) are exempt — MFA is delegated to the IdP. The feature ships on **all paid plans**; the free plan gets self-enrollment but not workspace enforcement. Two env-var flags gate rollout: `ENABLE_MFA_SELF_ENROLLMENT` (Phase 1) and `ENABLE_MFA_ENFORCEMENT` (Phase 3).

The mobile companion app **pivots to web-delegated authentication** before TestFlight. Mobile opens the system browser to authenticate on shelf.nu (which handles password + MFA + SSO) and receives a session via `shelf://` deeplink with state-token validation. Net mobile code change: **−110 LOC**, zero new dependencies. The pivot is feasible because the companion app is at 35% completion, pre-TestFlight, with no users to migrate.

**Estimated effort:** 20 days single engineer (sequential), ~13 days two engineers (parallelized — webapp + mobile tracks).

---

## 2. Why now

- Customer questions about SSO pricing have surfaced *security as a workspace property* as a broader theme. SSO is for enterprise; MFA enforcement covers the larger middle market.
- Asset-management workspaces hold high-value records (custody chains, audit trails) — credential compromise is more than a productivity loss.
- Workspace owners ask for it explicitly during sales calls.
- Supabase already provides TOTP at no cost; the marginal infra spend is ~zero.
- The mobile companion app is in the cheap-pivot window exactly once: pre-TestFlight, 35% complete, no commitments to App Store. Past this window, mobile MFA becomes either a separate native build-out or an exemption with sunset migration.

---

## 3. Decisions made

> Every fork has been resolved. Each links to a fuller rationale in Appendix A. CTO's review can override any of these — the rationale is provided so the override is informed.

| # | Area | Decision | Ref |
|---|---|---|---|
| 1 | Grace period values | `0 / 24h / 7d / 14d / 30d`, default **7d** | A.F |
| 2 | Grace expiry behavior | Block at next request — no proactive sweep, no session termination | A.G |
| 3 | SSO + MFA | Delegate to IdP when `User.sso === true` | A.E |
| 4 | OTP / magic-link login | Treat as `aal1`; users with TOTP enrolled face step-up | A.H |
| 5 | Pricing | Free on all paid plans; free plan gets self-enrollment but not enforcement | A.I |
| 6 | Backup-code count | 10 codes, 12-char base32 (`AAAA-BBBB-CCCC` format), argon2id-hashed | A.C |
| 7 | Mobile auth | Pivot companion app to web-delegated authentication | A.L, §4.5 |
| 8 | Multi-factor schema | `MfaFactor` 1:N from day 1; v1 UI restricts to a single enrolled factor | A.B |
| 9 | Step-up frequency | Once per session (3-day cookie life) — no per-action step-up in v1 | A.K |
| 10 | Audit log substrate | Narrow `MfaEnforcementEvent` table (precedent: `RoleChangeLog`); no generic audit log | A.P |
| 11 | Personal-workspace toggle | Hide enforcement toggle on `OrganizationType.PERSONAL` | A.O |
| 12 | Phone factor / WebAuthn | Out of scope for v1 (TOTP only) | A.N |
| 13 | Live enforcement state | Stored as 4 columns on `Organization` (not a separate model) — minimizes refactor | A.M |
| 14 | Per-action step-up | Out of scope for v1; revisit with specific customer ask | A.K |
| 15 | Backup-code consumption flow | Forced re-enrollment of new factor (Supabase can't mint aal2 from our DB) | A.D |

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

model User {
  // ... existing
  mfaFactors      MfaFactor[]
  mfaBackupCodes  MfaBackupCode[]
  mfaResetTokens  MfaResetToken[]
}
```

**Migration:** purely additive, zero-downtime. No data backfill required.

**What we do not store:** TOTP secret/URI/QR (Supabase owns it), plaintext backup codes (only argon2 hashes), plaintext reset tokens (only SHA-256 hashes), denormalized `backupCodesRemaining` (computed on demand from row count).

### 4.2 Auth-session extension

`mapAuthSession()` ([modules/auth/mappers.server.ts](apps/webapp/app/modules/auth/mappers.server.ts)) gains JWT-claim decoding. New helper at [modules/auth/jwt.server.ts](apps/webapp/app/modules/auth/jwt.server.ts):

```ts
// app/modules/auth/jwt.server.ts
type JwtClaims = {
  aal?: 'aal1' | 'aal2';
  amr?: { method: string; timestamp: number }[];
};

/** Decode payload from Supabase JWT. No signature verification — Supabase
 *  already validated. We only read claims we care about. */
export function decodeJwtClaims(token: string): JwtClaims {
  try {
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    );
    return { aal: payload.aal, amr: payload.amr };
  } catch {
    return {}; // malformed → middleware treats as aal1 (safe default)
  }
}
```

```ts
// app/modules/auth/mappers.server.ts (extended)
import { decodeJwtClaims } from './jwt.server';

export function mapAuthSession(s: SupabaseSession): AuthSession {
  const claims = decodeJwtClaims(s.access_token);
  return {
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    userId: s.user.id,
    email: s.user.email!,
    expiresIn: s.expires_in,
    expiresAt: s.expires_at!,
    aal: claims.aal ?? 'aal1', // safe default for migration
    amr: claims.amr ?? [],
  };
}
```

`AuthSession` in [server/session.ts](apps/webapp/server/session.ts) gains two new fields: `aal: 'aal1' | 'aal2'` and `amr: { method: string; timestamp: number }[]`.

### 4.3 Middleware: `enforceMfa()`

New middleware between `protect()` and the route handlers in [server/index.ts](apps/webapp/server/index.ts):

```
session() → refreshSession() → protect() → enforceMfa() [NEW] → routes
```

```ts
// app/server/middleware.ts (new function)

const MFA_BYPASS_PATHS = new Set([
  '/healthcheck',
  '/_root',
  '/api/stripe-webhook',
  '/api/public-stats',
  '/api/oss-friends',
]);

const MFA_FLOW_PATH_PREFIXES = ['/mfa/'];

export function enforceMfa(): MiddlewareHandler {
  return async (c, next) => {
    // Use full URL so we can preserve querystring in the return param
    // (critical for /mobile-handoff?state=... — losing state breaks pairing).
    const url = new URL(c.req.url);
    const path = url.pathname;
    const returnUrl = `${url.pathname}${url.search}`;

    if (MFA_BYPASS_PATHS.has(path)) return next();
    if (MFA_FLOW_PATH_PREFIXES.some((p) => path.startsWith(p))) return next();
    if (path.startsWith('/logout')) return next();

    // Public paths (e.g. /mobile-handoff, /accept-invite/*) reach this
    // middleware without an authSession. Let them through; the route
    // handler itself decides whether to redirect to /login.
    const session = c.get('authSession') as AuthSession | undefined;
    if (!session) return next();

    const orgContext = c.get('orgContext') as OrgContext; // already resolved upstream
    const org = orgContext.currentOrganization;

    // SSO delegation — User.sso is the authoritative flag (verified)
    if (orgContext.user.sso) return next();

    // No enforcement on this org
    if (!org.mfaEnforcedAt) return next();

    const now = new Date();
    const inGrace = now < org.mfaEnforceAfter!;
    const userHasFactor = orgContext.user.mfaFactors.length > 0;

    // Note: no owner "escape hatch." The /settings/workspace/security action
    // requires aal2 anyway (§4.8), so bypassing here would just produce a
    // 403 on submit. Instead, route owners through the normal step-up flow:
    // aal1 owner with a factor → /mfa/challenge → returns to settings at aal2.
    // Owner without a factor → /mfa/setup → enrolls (factor verify mints
    // aal2) → can disable. Sole-owner-totally-locked-out is the support
    // process documented in §11.4.

    if (userHasFactor) {
      // Has factor: require aal2 session
      if (session.aal === 'aal2') return next();
      return c.redirect(`/mfa/challenge?return=${encodeURIComponent(returnUrl)}`);
    }

    // No factor
    if (inGrace) {
      c.set('mfaGraceBanner', { enforceAfter: org.mfaEnforceAfter });
      return next();
    }
    // Grace expired
    return c.redirect(`/mfa/setup?return=${encodeURIComponent(returnUrl)}`);
  };
}
```

**Note on data dependency:** `orgContext` already includes `currentOrganization` (selected fields) and `userOrganizations`. Phase 3 adds `mfaFactors: { select: { id: true } }` to the user join in [organization/context.server.ts](apps/webapp/app/modules/organization/context.server.ts) so the middleware doesn't make extra queries. See §5.

### 4.4 Web routes & flows

| Route | Purpose | Auth required |
|---|---|---|
| `/mfa/setup` | First-time enrollment: QR + secret, code input, generates backup codes | aal1 |
| `/mfa/setup/backup-codes` | Show backup codes once + "I've saved them" gate | Within enrollment flow |
| `/mfa/challenge` | aal1 → aal2 step-up; TOTP code or "use backup code" toggle | aal1 |
| `/mfa/recover-and-reenroll` | Public; reachable via emailed `MfaResetToken` | None (token-gated) |
| `/settings/account/security` | View own factors, regenerate backup codes (aal2), unenroll (aal2) | aal2 |
| `/settings/workspace/security` | OWNER: enable/disable enforcement, view member MFA status, force-reset | aal2 + OWNER |
| `/api/mfa/enroll` | Enrollment API | aal1 |
| `/api/mfa/verify` | Challenge verify | aal1 |
| `/api/mfa/unenroll` | Self-initiated unenroll | aal2 |
| `/api/mfa/backup-codes/regenerate` | Issues new 10-code set | aal2 |
| `/api/mfa/admin/reset/:userId` | OWNER force-reset; emails user | aal2 + OWNER |
| `/mobile-handoff` | Mobile pairing handoff | aal1 (becomes aal2 if MFA required) |

**Backup-code flow** (the case Supabase doesn't support natively — see A.D):

```
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

### 4.5 Mobile companion auth pivot (web-delegate)

**Status:** companion app is at `apps/companion/` on `feat/mobile-companion-app` branch (verified — memory previously had `apps/mobile/`, now corrected). 35% completion. Pre-TestFlight. All required libraries already installed.

**Flow:**

```
Mobile app launches
  → user taps "Sign in with Shelf"
  → mobile generates state token via expo-crypto
  → mobile opens https://shelf.nu/mobile-handoff?state=<state>
       via expo-web-browser openAuthSessionAsync()
  → user authenticates on web (password / OTP / SSO + MFA if enrolled+enforced)
  → web /mobile-handoff loader has aal2 session, 302s to:
       shelf://auth-complete?state=<state>&access_token=...&refresh_token=...
  → mobile deeplink handler validates state matches, calls
       supabase.auth.setSession({ access_token, refresh_token })
  → mobile session persisted in SecureStore; JWT carries aal2
  → autoRefreshToken keeps aal2 alive on subsequent launches
```

**Mobile code (`apps/companion/lib/web-auth.ts`, new):**

```ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

const WEB_BASE = process.env.EXPO_PUBLIC_API_URL!;
const PENDING_STATE_KEY = 'shelf-pairing-state';

export async function signInViaWeb(): Promise<void> {
  const state = await Crypto.randomUUID(); // or randomBytes(32).toString('hex')
  await SecureStore.setItemAsync(PENDING_STATE_KEY, state);

  const handoffUrl = `${WEB_BASE}/mobile-handoff?state=${state}`;
  const result = await WebBrowser.openAuthSessionAsync(
    handoffUrl,
    'shelf://auth-complete',
  );

  if (result.type !== 'success') {
    await SecureStore.deleteItemAsync(PENDING_STATE_KEY);
    throw new Error('Sign-in cancelled');
  }

  const { queryParams } = Linking.parse(result.url);
  const expectedState = await SecureStore.getItemAsync(PENDING_STATE_KEY);
  await SecureStore.deleteItemAsync(PENDING_STATE_KEY);

  if (queryParams?.state !== expectedState) {
    throw new Error('State mismatch — pairing aborted');
  }

  const { error } = await supabase.auth.setSession({
    access_token: queryParams.access_token as string,
    refresh_token: queryParams.refresh_token as string,
  });
  if (error) throw error;
}
```

**Webapp handoff route (`apps/webapp/app/routes/_auth+/mobile-handoff.tsx`, new):**

```tsx
export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');

  if (!state || !/^[A-Za-z0-9_-]{16,}$/.test(state)) {
    throw new ShelfError({
      cause: null, message: 'Invalid pairing state', status: 400, label: 'Auth',
    });
  }

  const session = context.getSession?.();
  if (!session) {
    return redirect(
      `/login?return=${encodeURIComponent(`/mobile-handoff?state=${state}`)}`,
    );
  }

  // Re-evaluate MFA: if user has enrollment+enforcement, mobile-handoff is gated
  // by enforceMfa() upstream. By the time we reach this loader, session.aal is
  // either aal2 or the user has no enforcement. Either way, deeplink with tokens.
  const deeplink =
    `shelf://auth-complete?state=${encodeURIComponent(state)}` +
    `&access_token=${encodeURIComponent(session.accessToken)}` +
    `&refresh_token=${encodeURIComponent(session.refreshToken)}`;

  return redirect(deeplink);
}
```

**Mobile rip-out:**

| File | Action | LOC change |
|---|---|---|
| `apps/companion/lib/auth-context.tsx` | Rewrite — `signIn()` → `signInViaWeb()` | -50, +60 |
| `apps/companion/lib/web-auth.ts` | New | +80 |
| `apps/companion/lib/deep-links.ts` | Extend — handle `shelf://auth-complete` | +40 |
| `apps/companion/app/(auth)/login.tsx` | Replace — single button | -150, +30 |
| `apps/companion/app/(auth)/forgot-password.tsx` | Delete | -100 |
| `apps/companion/hooks/use-form-validation.ts` | Delete (only used by deleted screens) | -80 |
| Maestro E2E | Rewrite ~10 auth flows | (tracked separately) |

**Net mobile code: −110 LOC. Zero new dependencies.**

**Webapp:** the mobile-handoff route adds ~80 LOC. The 27 existing mobile API endpoints in `apps/webapp/app/routes/api+/mobile+/*` need **zero changes** — they already validate JWT bearer tokens.

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

| Template | Trigger | Recipient |
|---|---|---|
| `mfa-enrolled.tsx` | User completes enrollment | The user |
| `mfa-enforcement-enabled.tsx` | Owner toggles on | All members |
| `mfa-enrollment-reminder.tsx` | T-3d, T-1d before grace expiry | Each unenrolled member |
| `mfa-grace-expired.tsx` | First request after expiry redirects to /mfa/setup | The blocked member |
| `mfa-reset-link.tsx` | Owner triggers reset | The user being reset |
| `mfa-backup-code-used.tsx` | Backup code consumed | The user |

**Reminder scheduling: PgBoss delayed jobs** (existing infra, `apps/webapp/app/utils/scheduler.server.ts`). At enforcement-enable, queue jobs with `runAt = enforceAfter - 3*24h` and `enforceAfter - 24h`. Cancel them if owner disables enforcement before they fire.

### 4.8 Owner self-prerequisite

Before "enable enforcement" form succeeds:

```ts
// app/routes/_layout+/settings.workspace.security.tsx (action)

if (authSession.aal !== 'aal2') {
  throw new ShelfError({
    cause: null, status: 403, label: 'Auth',
    message: 'Re-authenticate with MFA before changing security settings',
  });
}

const ownFactor = await db.mfaFactor.findFirst({
  where: { userId: authSession.userId },
});
if (!ownFactor) {
  throw new ShelfError({
    cause: null, status: 400, label: 'Auth',
    message: 'You must enroll MFA on your own account before enabling enforcement',
  });
}

// Verify owner role (canonical pattern from account-details.workspace edit route)
const org = await db.organization.findUniqueOrThrow({
  where: {
    id: organizationId,
    owner: { is: { id: authSession.userId } },
  },
}).catch(() => {
  throw new ShelfError({
    cause: null, status: 403, label: 'Auth',
    message: 'You are not the owner of this organization',
  });
});

// Refuse on PERSONAL workspaces (no other members to enforce on)
if (org.type === OrganizationType.PERSONAL) {
  throw new ShelfError({
    cause: null, status: 400, label: 'Auth',
    message: 'MFA enforcement applies to team workspaces only',
  });
}
```

Disabling enforcement also requires fresh aal2 — prevents a hijacked aal1 session from unilaterally disabling workspace security.

**How an aal1 owner reaches this form (no escape hatch in middleware):**

- *Owner has factor + aal1*: `enforceMfa()` redirects them to `/mfa/challenge?return=/settings/workspace/security` → step up → return at aal2 → action succeeds.
- *Owner has no factor + still in grace*: page loads with the grace banner; the action returns the "must enroll first" `ShelfError`; CTA links to `/mfa/setup`.
- *Owner has no factor + grace expired*: `enforceMfa()` redirects them to `/mfa/setup?return=/settings/workspace/security` → enrollment verifies the factor (Supabase mints aal2 on first verify) → return at aal2 with factor → action succeeds.
- *Owner totally locked out (lost device + lost backup codes)*: support process per §11.4.

This is why we removed the original draft's owner escape hatch — it allowed loading the page at aal1, which produced a 403 dead-end on submit. Letting `enforceMfa()` route the owner through the normal step-up flow is cleaner and has no dead-end.

### 4.9 Supabase client modes

Today the webapp predominantly uses `getSupabaseAdmin()` (service-role). MFA needs a clean split:

| Operation | Required client | Why |
|---|---|---|
| `auth.mfa.enroll` | **User-context** (anon key + user access token) | Factor is enrolled for current user |
| `auth.mfa.challengeAndVerify` | **User-context** | Verify is per-session |
| `auth.mfa.unenroll` (self) | **User-context** | Same |
| `auth.mfa.listFactors` (self) | **User-context** | Reads current user's factors |
| `auth.admin.mfa.deleteFactor` (owner force-reset) | **Admin** | Cross-user; service-role |

**New helper in [integrations/supabase/client.ts](apps/webapp/app/integrations/supabase/client.ts):**

```ts
export function getSupabaseAsUser(authSession: AuthSession) {
  return getSupabaseClient(SUPABASE_ANON_PUBLIC, authSession.accessToken);
}
```

Document the rule (also in [CLAUDE.md](CLAUDE.md)): admin client = service-role only; user client = the user's own MFA actions. The new MFA service uses `getSupabaseAsUser()` exclusively.

### 4.10 Migration safety on deploy

**Issue:** when the new `mapAuthSession` ships, existing logged-in cookies don't have `aal`. `enforceMfa()` reading `session.aal` gets `undefined`.

**Fix:** the JWT decoder defaults missing `aal` to `'aal1'`. This is correct for non-MFA users (100% of users at deploy time). After Phase 1 ships, the user pool that has `aal: 'aal2'` grows monotonically — no user is lost.

**Test added in Phase 1:** boot middleware with a synthetic session that has no `aal` field; assert middleware allows access (no MFA enrolled, no enforcement).

**Deploy sequence:**
1. Deploy schema migration.
2. Deploy code with `ENABLE_MFA_SELF_ENROLLMENT=false`. No behavior change.
3. Flip flag in staging; dogfood internally.
4. Flip in production.
5. After Phase 3 ships, repeat for `ENABLE_MFA_ENFORCEMENT`.

---

## 5. Performance

The CTO's bar is concrete numbers, not "should be fine."

### 5.1 Hot-path budget — the per-request middleware chain

**Current** (`apps/webapp/server/index.ts` middleware order, verified):

| Step | DB queries | Approx p50 | Notes |
|---|---|---|---|
| `protect()` (validateSession) | 1 (auth.refresh_tokens) | ~3ms | Reads Supabase auth schema; existing |
| `refreshSession()` | 0 unless near expiry | ~0.1ms | Conditional refresh |
| `getSelectedOrganization()` | 1 (UserOrganization+Org) | ~5ms | One round trip, 25-field select with joins |
| Route handler | 1+ | varies | Depends on route |

**With MFA enforcement (Phase 3 onward):**

| Step | DB queries | Marginal cost | Notes |
|---|---|---|---|
| `protect()` | 1 | 0 | Unchanged |
| `mapAuthSession()` JWT decode | 0 | **~50µs** | Single base64 decode + JSON.parse on ~300-byte payload |
| `getSelectedOrganization()` | 1 | **0 marginal** | Add `mfaFactors: { select: { id: true } }` to user join + 4 columns from Organization. Both indexed (Organization PK; MfaFactor's `userId` index). Lateral join planner cost ≈ 0 in EXPLAIN. |
| `enforceMfa()` | 0 | **<10µs** | Pure logic on already-fetched data |

**Total marginal per request: ~50µs CPU + 0 DB queries.** The added Prisma joins reuse the existing query plan; the planner uses the indexed FK on `MfaFactor.userId` and a hash join on `Organization.id`. p95 of `getSelectedOrganization` is unchanged within measurement noise.

**Materialization escape hatch (per CTO Rule 2):** if a customer with an unusually large `MfaFactor` row (we only ever expect 1–10 per user) somehow blows query budget, we cache `userHasMfaFactor: boolean` on `User` directly. Not anticipated.

### 5.2 The MFA endpoints themselves

| Endpoint | Expected p95 | Budget rationale |
|---|---|---|
| `POST /api/mfa/enroll` | 200ms | One Supabase API call (network bound) + 1 DB insert (`MfaFactor`) |
| `POST /api/mfa/verify` | 250ms | One Supabase verify call + 1 DB update + cookie reissue |
| Backup-code verify | 100ms | argon2id verify across at most 10 hashes — ~10ms each, sequential. Could parallelize if needed. |
| `/settings/workspace/security` GET | 80ms | One Org read + member count + per-member `MfaFactor` exists join. For a 100-member org this is one query with `EXISTS` subselect. |
| `/api/mfa/admin/reset/:userId` | 300ms | Issue token + DB insert + Supabase admin API + email queue add |

argon2id parameters: m=64MB, t=3, p=1 (Node.js default in `@node-rs/argon2`) — ~10ms per verify on M1-class hardware. For the 10-code-max case, p95 worst-case ~100ms.

### 5.3 PgBoss reminder jobs

PgBoss runs out-of-band; reminder jobs do not affect request latency. Each reminder job:
- Reads 1 organization + 1 list of unenrolled members (left-join `User` against `MfaFactor`).
- Sends N emails (PgBoss handles retry, no inline blocking).

For a workspace with 100 members and one with no factor, total reminder job runtime ≈ 1s. Acceptable.

---

## 6. Security threat model

| Threat | Mitigation |
|---|---|
| Stolen session cookie (web) | aal2 requirement on protected paths means cookie alone is insufficient when MFA enrolled. |
| TOTP secret exfiltration via logs | Logger allow-list rule scrubs `secret`, `uri`, `qr_code` keys. Audit Sentry config in Phase 0. |
| Backup-code DB dump | argon2id (m=64MB, t=3) — expensive offline crack per code. |
| Backup-code phishing | Single-use; consumed on use; user notified by email immediately; forced re-enrollment limits damage to one re-arm window. |
| Reset-token phishing | Short expiry (1h), single-use, hashed, requires owner intent. |
| TOTP code replay | Supabase rejects already-used codes; ±30s skew window. |
| Owner self-lockout | Self-prerequisite gate; backup codes; admin-disable still works at aal1 + OWNER if everything is lost (audit-logged). |
| SSO bypass | If `User.sso === true`, MFA delegated to IdP. Workspace owner's responsibility (documented). Optional Phase 5+ enhancement: warn owner if SSO is on and they want to also enroll Shelf-side MFA. |
| Mass-enrollment DoS | Supabase has rate limits; we add per-user-per-hour cap of 10 enroll calls. |
| Audit-log tampering | `MfaEnforcementEvent` is write-only via service; no admin delete API. |
| Mobile deeplink token interception (malicious co-installed app) | State-token validation on every deeplink; mismatched state aborts. v1.1 plan: encrypt token payload with state-derived ephemeral key. v1 acceptable risk for B2B context (documented). |
| Mobile session theft (compromised device) | SecureStore is hardware-backed on iOS / Android Keystore. Owner can `auth.admin.signOut(userId)` to revoke. |
| TOFU at enrollment | Re-auth (password) required immediately before `/mfa/setup`. Prevents stolen-aal1-session-during-enrollment. |
| OTP-as-only-factor coverage | OTP login is aal1 by Supabase definition. Users with OTP+TOTP face the TOTP step-up. Email is not treated as a strong second factor (phishable, plaintext, often shared). |

---

## 7. Edge cases

| Case | Behavior |
|---|---|
| User in 2 workspaces, only one enforces | One enrollment satisfies both. Gate fires only when the enforcing workspace is active. |
| User opens app in 2 tabs during enrollment | Backup codes shown once; if they navigate away without confirming, `/api/mfa/backup-codes/regenerate` issues new set, invalidates old. |
| Lost device + has backup codes | Sign in with password → `/mfa/challenge` → "use backup code" → consumed → forced enroll new TOTP → factor verifies → aal2 → original target. Email sent. |
| Lost device + no backup codes | Owner uses `/api/mfa/admin/reset/:userId` → email → user clicks → factor force-deleted → `/mfa/recover-and-reenroll` → re-enroll. |
| Sole-owner loses everything | Sole owner can still log in (password works) but can't access enforcing workspace. Recovery: backup code, transfer ownership, or Shelf support. **Documented in admin guide.** |
| Owner enables, then disables before grace expires | `mfaEnforcedAt = NULL`. Members revert. Both events logged via `MfaEnforcementEvent`. PgBoss-scheduled reminders cancelled. |
| Owner enables, then re-enables with shorter grace | New value replaces old. Re-notification email sent. Old reminders cancelled, new ones scheduled. |
| User enrolled, then enforcement turned off | Enrollment stays. Nothing forces them. |
| User enrolled in workspace A, joins enforcing workspace B | Already satisfied. Normal Supabase aal2 step-up on next login. |
| Pending invitee, owner enables enforcement | Invite valid. First login = no enrollment + no grace (they're new) → directly to `/mfa/setup`. |
| User signs in via SSO at enforcing workspace | `User.sso === true` → delegate → allow. |
| User signs in via OTP at enforcing workspace | OTP login = aal1 → TOTP step-up like password user. |
| User unenrolls last factor while enforcement on | Self-path: button disabled with "MFA required by this workspace" message. Owner reset: bypasses (deliberate). |
| User has multiple TOTP factors enrolled | Schema 1:N. v1 UI restricts to one. v2 will allow N (no schema change). |
| Email change while enrolled | Factor bound to user_id, not email. Keeps working. |
| Logged-in user during grace, grace expires mid-session | Next request → middleware sees no factor + expired → 302 to `/mfa/setup`. Same as fresh login. |
| Workspace deleted while enforcement on | Cascade deletes the enforcement state. User's enrollment unaffected. |
| **Mobile: first-time pairing** | Tap "Sign in with Shelf" → browser → web auth (incl. MFA) → deeplink → tokens to SecureStore → home. |
| **Mobile: token refresh while signed in** | `autoRefreshToken: true` handles it; refresh preserves aal per Supabase docs. No browser re-open. |
| **Mobile: workspace enables MFA mid-session** | Next API call may return 401 if aal1 + enforcement. App detects, shows "Re-authenticate" → re-pair via web. |
| **Mobile: deeplink-from-email** | If app installed, OS routes to deeplink handler. State validation rejects deeplinks without matching pending state — emailed deeplinks fail safely. |

---

## 8. Phased plan with rollback

Each phase ends with something demoable. Each phase has an explicit rollback path. Phases marked `[parallel]` run alongside the previous phase if engineering capacity permits.

### Phase 0 — Prereqs (~0.5d)

- Land Logger allow-list rule scrubbing `secret`, `uri`, `qr_code` from any logged objects.
- Confirm `@node-rs/argon2` works on Fly's runtime (the only existing native-binding question).
- Stand up a dev Supabase project for MFA testing (avoid polluting prod `auth.users`).

**Rollback:** N/A (no production change).

### Phase 1 — Webapp self-enrollment (~3d)

Self-service MFA. No enforcement yet. Anyone can enable for themselves.

- Prisma migration: `MfaFactor`, `MfaBackupCode`. (Migration is additive-only; rollback = `prisma migrate resolve --rolled-back`.)
- New `app/modules/auth/jwt.server.ts` with `decodeJwtClaims`.
- Extend `mapAuthSession` to capture `aal`, `amr`. Add safety test for missing `aal`.
- New `app/modules/mfa/service.server.ts` wrapping `auth.mfa.enroll/challengeAndVerify/unenroll/listFactors`. Uses `getSupabaseAsUser()`.
- New `app/modules/mfa/backup-codes.server.ts` (argon2id).
- New helper `getSupabaseAsUser()` in [integrations/supabase/client.ts](apps/webapp/app/integrations/supabase/client.ts).
- Routes: `/mfa/setup`, `/settings/account/security`.
- UI: `<MfaSetupCard>`, `<BackupCodesPanel>`.
- Email: `mfa-enrolled.tsx`.
- Add env flag `ENABLE_MFA_SELF_ENROLLMENT` to `app/config/shelf.config.ts` and `app/utils/env.ts`. Routes return 404 when off.
- Feature flag check: routes/links hidden when `config.enableMfaSelfEnrollment === false`.

**Demo:** any user can enable MFA on their own account. Login flow doesn't yet challenge them (Phase 2 adds that).

**Rollback:** flip flag to `false`. Routes 404. Existing enrolled users keep their factors but face no challenge. No data lost. To fully unwind: `auth.admin.mfa.deleteFactor` for each `MfaFactor`, then `prisma migrate resolve --rolled-back`.

### Phase 1.5 — Mobile auth pivot [parallel with Phase 1] (~4d)

- New `apps/companion/lib/web-auth.ts`.
- Extend `apps/companion/lib/deep-links.ts` for `shelf://auth-complete` + `shelf://auth-failed`.
- Rewrite `apps/companion/lib/auth-context.tsx` — `signIn()` → `signInViaWeb()`.
- Replace `apps/companion/app/(auth)/login.tsx` with single-button screen.
- Delete `apps/companion/app/(auth)/forgot-password.tsx`, `apps/companion/hooks/use-form-validation.ts`.
- Webapp: new `apps/webapp/app/routes/_auth+/mobile-handoff.tsx` — Remix flat-routes resolves this to URL `/mobile-handoff` (matches existing `_auth+/login.tsx` → `/login` pattern).
- Webapp: add `/mobile-handoff` to `protect()` public-paths list (matches the `/accept-invite/*` pattern — loader handles unauth by redirecting to `/login?return=/mobile-handoff?state=...`). MFA enforcement still applies via `enforceMfa()` — once the user is authenticated, the middleware will route them through `/mfa/challenge` if they need step-up before the loader issues tokens.
- Maestro E2E: rewrite ~10 auth flows.
- Manual test on iOS simulator + Android emulator.

**Demo:** companion app authenticates via web; sessions persist across launches.

**Rollback:** mobile is in dev/preview EAS profile only — no production users yet. Rollback = revert the mobile commits, redeploy preview build. Webapp `/mobile-handoff` route is harmless if mobile reverts.

### Phase 2 — Step-up on web login when enrolled (~3d)

- Add `enforceMfa()` middleware (lighter version: only own enrollment + AAL, no workspace policy).
- Route `/mfa/challenge` with TOTP input + "use backup code" toggle.
- Loader/action: `challengeAndVerify` → reissue session cookie.
- Backup-code path: validate `MfaBackupCode` → mark consumed → 302 to `/mfa/setup?recovery=true`.
- Email: `mfa-backup-code-used.tsx`.
- Tests: aal1 user blocked → challenge → aal2 → access. Backup code consumes once. Force re-enroll end-to-end.

**Demo:** enrolled users now face TOTP prompt every fresh login.

**Rollback:** middleware checks `config.enableMfaSelfEnrollment` — if false, allow all. Flag flip = full rollback.

### Phase 3 — Workspace enforcement toggle (~5d)

- Prisma migration: 4 columns on `Organization`, plus `MfaEnforcementEvent` table. Additive.
- New `app/modules/mfa/enforcement.server.ts` — enable, disable, get-policy.
- Owner-only route `/settings/workspace/security` with `<MfaEnforcementToggle>` and grace-period selector.
- Owner self-prerequisite gate at enable-time (§4.8).
- Hide toggle on `OrganizationType.PERSONAL` orgs.
- Extend `enforceMfa()` to look up org policy + apply grace logic.
- Extend `getSelectedOrganization` query to include 4 MFA columns + `mfaFactors: { select: { id: true } }` user join.
- `<MfaGraceBanner>` in workspace shell.
- Email: `mfa-enforcement-enabled.tsx` to all members on toggle.
- `MfaEnforcementEvent` writes for `ENABLED`, `DISABLED`, `GRACE_CHANGED`.
- Add `ENABLE_MFA_ENFORCEMENT` flag.
- Tests: end-to-end with two users (one owner one member); SSO user delegation; OTP-login user step-up; Personal workspace toggle hidden.

**Demo:** owner enables enforcement → all members see banner → enrolled members continue normally; unenrolled have N days.

**Rollback:** `ENABLE_MFA_ENFORCEMENT=false` → middleware skips workspace policy entirely (still does Phase 2's own-enrollment check). All `mfaEnforcedAt` data preserved. Re-enable resumes where it was.

### Phase 4 — Grace expiry behavior (~1d)

- PgBoss-scheduled reminders T-3d, T-1d, queued at enforcement-enable. Cancelled on disable.
- "Grace expired" email sent at first redirect-after-expiry.
- Members table column with status + filter (read of `MfaFactor.exists` per row, indexed).
- No cron — pure PgBoss + lazy enforcement at next request.

**Demo:** unenrolled user is blocked at next request after grace expiry; emails arrive on schedule.

**Rollback:** `ENABLE_MFA_ENFORCEMENT=false` cancels grace experience. PgBoss jobs are idempotent — re-enabling re-schedules from current state.

### Phase 5 — Owner reset + recovery (~2d)

- Prisma migration: `MfaResetToken`. Additive.
- `/api/mfa/admin/reset/:userId`: issue `MfaResetToken`, call `auth.admin.mfa.deleteFactor`, email user.
- `/mfa/recover-and-reenroll`: validates token, allows re-enroll without authenticated session.
- `MfaEnforcementEvent` writes for `MEMBER_RESET`.
- Owner UI: members table button "Reset MFA" + confirmation modal.

**Demo:** member loses device, owner resets, member re-enrolls.

**Rollback:** disable the reset endpoint via flag if needed. Existing tokens age out naturally (1h expiry).

### Phase 6 — Polish (~4d)

- Localization keys for all MFA strings.
- React-doctor pass on touched components.
- Pen-test of recovery + reset flows.
- Documentation: `/apps/docs/security-mfa.md` (admin + member guide; documents the sole-owner-recovery process).
- Marketing-page mention.
- Internal dogfood for 1 week.

### Estimate summary

| Phase | Estimate |
|---|---|
| 0 — Prereqs | 0.5d |
| 1 — Self-enrollment (web) | 3d |
| 1.5 — Mobile pivot [parallel] | 4d |
| 2 — Step-up on login | 3d |
| 3 — Workspace toggle | 5d |
| 4 — Grace expiry | 1d |
| 5 — Owner reset | 2d |
| 6 — Polish | 4d |
| **Total (single engineer, sequential)** | **~22d** |
| **Total (two engineers, parallelized)** | **~13d** |

---

## 9. Monitoring & observability

Instrumentation we add (Sentry + structured logger):

| Metric / event | When | Why |
|---|---|---|
| `mfa.enroll.attempt` | `/api/mfa/enroll` action start | Track funnel + rate-limit triggers |
| `mfa.enroll.success` | Factor verified | Conversion from attempt |
| `mfa.enroll.fail` (with reason) | Rate-limited / wrong-code / Supabase-error | Debug + alarm thresholds |
| `mfa.challenge.attempt` | `/mfa/challenge` action start | Login-step traffic |
| `mfa.challenge.success` | aal2 minted | Conversion |
| `mfa.challenge.fail` (reason) | Wrong code / expired challenge | Anomaly detection |
| `mfa.backup_code.used` | Consumed | Security signal |
| `mfa.admin.reset.issued` | Owner triggers | Audit |
| `mfa.enforcement.enabled` | Owner enables on org | Adoption |
| `mfa.enforcement.disabled` | Owner disables | Adoption |
| `mfa.middleware.redirect_to_setup` | Forced setup redirect | Track grace expiry impact |
| `mfa.middleware.redirect_to_challenge` | Step-up redirect | Volume |

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
3. **Per-action step-up.** Out of scope for v1. Customer-pull will trigger v1.5.
4. **Sole-owner break-glass support flow.** Engineering side is documented. Operations side (Shelf support process for "owner lost everything, we need to verify identity and reset") needs to be defined in the support runbook before GA.

---

## 12. Files most likely to be touched

> Reference for the eng team and CodeRabbit. Phase numbers in parens. New files marked `[NEW]`.

### Webapp — Schema & core

- `packages/database/prisma/schema.prisma` *(P1, P3, P5)*
- `apps/webapp/app/modules/auth/mappers.server.ts` *(P1)* — extend
- `apps/webapp/app/modules/auth/jwt.server.ts` *(P1)* `[NEW]`
- `apps/webapp/app/modules/mfa/service.server.ts` *(P1)* `[NEW]`
- `apps/webapp/app/modules/mfa/enforcement.server.ts` *(P3)* `[NEW]`
- `apps/webapp/app/modules/mfa/backup-codes.server.ts` *(P1)* `[NEW]`
- `apps/webapp/app/modules/organization/context.server.ts` *(P3)* — extend org-context query
- `apps/webapp/app/integrations/supabase/client.ts` *(P1)* — add `getSupabaseAsUser`
- `apps/webapp/server/middleware.ts` *(P2, P3)* — `enforceMfa`
- `apps/webapp/server/index.ts` *(P1.5, P2)* — wire middleware + handoff path
- `apps/webapp/server/session.ts` *(P1)* — extend `AuthSession`
- `apps/webapp/app/utils/logger.ts` *(P0)* — secret scrubbing
- `apps/webapp/app/config/shelf.config.ts` *(P1, P3)* — `enableMfaSelfEnrollment`, `enableMfaEnforcement`
- `apps/webapp/app/utils/env.ts` *(P1, P3)* — env-var schema

### Webapp routes

- `apps/webapp/app/routes/_auth+/mfa.setup.tsx` *(P1)* `[NEW]`
- `apps/webapp/app/routes/_auth+/mfa.challenge.tsx` *(P2)* `[NEW]`
- `apps/webapp/app/routes/_auth+/mfa.recover-and-reenroll.tsx` *(P5)* `[NEW]`
- `apps/webapp/app/routes/_auth+/mobile-handoff.tsx` *(P1.5)* `[NEW]`
- `apps/webapp/app/routes/_layout+/settings.account.security.tsx` *(P1)* `[NEW]`
- `apps/webapp/app/routes/_layout+/settings.workspace.security.tsx` *(P3)* `[NEW]`
- `apps/webapp/app/routes/api+/mfa.enroll.ts` *(P1)* `[NEW]`
- `apps/webapp/app/routes/api+/mfa.verify.ts` *(P2)* `[NEW]`
- `apps/webapp/app/routes/api+/mfa.unenroll.ts` *(P1)* `[NEW]`
- `apps/webapp/app/routes/api+/mfa.backup-codes.regenerate.ts` *(P1)* `[NEW]`
- `apps/webapp/app/routes/api+/mfa.admin.reset.$userId.ts` *(P5)* `[NEW]`

### Webapp UI

- `apps/webapp/app/components/mfa/mfa-setup-card.tsx` *(P1)* `[NEW]`
- `apps/webapp/app/components/mfa/backup-codes-panel.tsx` *(P1)* `[NEW]`
- `apps/webapp/app/components/mfa/mfa-challenge-form.tsx` *(P2)* `[NEW]`
- `apps/webapp/app/components/mfa/mfa-status-badge.tsx` *(P3)* `[NEW]`
- `apps/webapp/app/components/mfa/mfa-enforcement-toggle.tsx` *(P3)* `[NEW]`
- `apps/webapp/app/components/mfa/mfa-grace-banner.tsx` *(P3)* `[NEW]`

### Webapp emails

- `apps/webapp/app/emails/mfa/mfa-enrolled.tsx` *(P1)* `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-enforcement-enabled.tsx` *(P3)* `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-enrollment-reminder.tsx` *(P4)* `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-grace-expired.tsx` *(P4)* `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-reset-link.tsx` *(P5)* `[NEW]`
- `apps/webapp/app/emails/mfa/mfa-backup-code-used.tsx` *(P2)* `[NEW]`

### Mobile companion

- `apps/companion/lib/auth-context.tsx` *(P1.5)* — rewrite
- `apps/companion/lib/web-auth.ts` *(P1.5)* `[NEW]`
- `apps/companion/lib/deep-links.ts` *(P1.5)* — extend
- `apps/companion/app/(auth)/login.tsx` *(P1.5)* — replace
- `apps/companion/app/(auth)/forgot-password.tsx` *(P1.5)* — delete
- `apps/companion/hooks/use-form-validation.ts` *(P1.5)* — delete

### Docs

- `apps/docs/security-mfa.md` *(P6)* `[NEW]` — admin + member guide

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

### A.E SSO — delegate to IdP

**Decision:** `User.sso === true` → MFA delegated to IdP, no Supabase factor required.

**Alternatives:** (1) Stack TOTP on top of SSO (GitHub model) — double-prompt UX. (2) Block SSO+MFA combo — restrictive.

**Why:** Cleaner UX. Matches Slack, Atlassian, Linear, Notion. Workspace owner takes responsibility for IdP-level MFA (their existing job).

**Cost:** if a customer's IdP doesn't enforce MFA and they don't either, the workspace is single-factor. Mitigation: documented in admin guide.

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

### A.L Mobile auth — web-delegate

**Decision:** companion app authenticates via system browser. Mobile receives session via `shelf://auth-complete` deeplink with state-token validation.

**Alternatives:** (1) Native MFA UI in mobile (~1.5–2 weeks, doubles MFA codepaths). (2) Exempt mobile entirely (security gap, eventual sunset migration).

**Why:** Companion is at 35% completion, pre-TestFlight. ~−110 LOC net change, zero new deps. Modern UX (Discord, MS Authenticator, Linear pattern). Smaller App Store review surface.

**Cost:** UX regression (browser launch vs native form). Beta expectations absorb.

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

---

## Appendix B — Verified infrastructure assumptions

Codebase verification on 2026-04-29 (against `shelf-main` on `main`):

| Assumption | Verified? | Source |
|---|---|---|
| Workspace audit log | ❌ Does not exist (only asset-audit and `RoleChangeLog`) | `packages/database/prisma/schema.prisma` |
| PgBoss supports delayed jobs | ✅ Yes — used in `apps/webapp/app/modules/asset-reminder/scheduler.server.ts` | scheduler.server.ts |
| App-level cron | ❌ Explicitly disabled (`noScheduling: true`) | `apps/webapp/app/utils/scheduler.server.ts` |
| Personal-access tokens | ❌ Do not exist; auth is JWT-only | grep |
| Owner-role check helper | ⚠️ Inline pattern (no centralized helper) | `apps/webapp/app/routes/_layout+/account-details.workspace.$workspaceId.edit.tsx:77-85` |
| Feature-flag system | ✅ Env-var based via `apps/webapp/app/config/shelf.config.ts` | shelf.config.ts |
| `OrganizationType.PERSONAL` gating | ✅ Existing pattern in `organization/context.server.ts:92-95` | context.server.ts |
| Per-request cache | ✅ `AsyncLocalStorage`-based via `request-cache.server.ts` | request-cache.server.ts |
| `getSelectedOrganization` cost | 1 DB round trip, ~25 selected fields with joins | organization/context.server.ts |

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
- [ ] Schema diff in §4.1 reviewed for index correctness and cascade semantics.
- [ ] Middleware logic in §4.3 reviewed for correctness and ordering.
- [ ] Mobile pivot architecture in §4.5 confirmed before TestFlight build is initiated.
- [ ] Performance numbers in §5 reviewed (CTO Rule 2: be specific on perf).
- [ ] Security threat model in §6 reviewed by anyone with offensive-security experience.
- [ ] Logger scrubbing rule lands in Phase 0 before any beta secrets touch Sentry.
- [ ] Sole-owner break-glass support process drafted before GA (§11.4).
- [ ] Admin guide drafted before launch (not just engineering docs).

---

*End of document.*
