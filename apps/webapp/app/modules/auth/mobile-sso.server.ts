/**
 * Native-app SSO session handoff (web-delegated auth).
 *
 * SSO organizations disable password auth, so the password-only companion app
 * cannot log them in. Instead the app opens the system browser to authenticate
 * on the web (which already handles SAML/SCIM), then receives a session via a
 * single-use authorization code:
 *
 *   1. After SSO completes, `_auth+/oauth.callback.mobile.tsx` calls
 *      {@link createMobileAuthCode} and hands the plaintext to the app through
 *      the `shelf://auth-callback?code=…` deeplink (no tokens in the URL).
 *   2. The app redeems the code at `POST /api/mobile/exchange`
 *      (`api+/mobile+/exchange.ts`), which calls {@link redeemMobileAuthCode}.
 *
 * Per CTO decision, redemption mints a FRESH, independent Supabase session for
 * the device (`admin.generateLink` → `verifyOtp`) rather than transferring the
 * web session's tokens. Web and mobile therefore have separate token families,
 * eliminating any refresh-token-rotation cascade between them.
 *
 * @see apps/webapp/app/routes/_auth+/oauth.callback.mobile.tsx
 * @see apps/webapp/app/routes/api+/mobile+/exchange.ts
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  isAuthApiError,
  isAuthRetryableFetchError,
} from "@supabase/supabase-js";
import type { AuthSession } from "@server/session";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { mapAuthSession } from "./mappers.server";

const label: ErrorLabel = "Auth";

/**
 * Lifetime of a mobile auth code. Short by design — the code is minted in the
 * web callback *after* SSO/MFA completes, so this window only spans the
 * `shelf://` deeplink hand-back plus the app's exchange POST, not the
 * human-paced IdP login. 180s (rather than a tighter 60s) leaves margin if iOS
 * briefly backgrounds the app during the hand-back or the exchange runs on a
 * slow network, without meaningfully widening the attack surface of a
 * single-use, hashed code.
 */
const MOBILE_AUTH_CODE_TTL_MS = 180_000;

/**
 * SHA-256 hex digest. Auth codes are high-entropy (256-bit) single-use tokens,
 * so a fast hash is sufficient — we persist only the hash, never the plaintext.
 *
 * @param plaintext - The value to hash
 * @returns Lowercase hex SHA-256 digest
 */
function hashCode(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Verifies a PKCE code verifier against a stored S256 challenge in constant
 * time. The challenge is `base64url(SHA-256(verifier))` (RFC 7636); we recompute
 * it from the presented verifier and compare. Length is checked first because
 * `timingSafeEqual` throws on unequal-length buffers.
 *
 * @param codeVerifier - The verifier presented at exchange (from the app)
 * @param codeChallenge - The S256 challenge bound to the code at mint time
 * @returns true if the verifier hashes to the stored challenge
 */
function verifyPkceChallenge(
  codeVerifier: string,
  codeChallenge: string
): boolean {
  const computed = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * How many times to attempt the session mint. The `generateLink → verifyOtp`
 * pair can fail transiently (Supabase 5xx, network blips), so we retry a few
 * times with a short backoff before giving up.
 */
const MINT_MAX_ATTEMPTS = 3;

/** Base backoff between mint retries, multiplied by the attempt number. */
const MINT_RETRY_BASE_MS = 300;

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether a Supabase failure is a rate-limit. Mirrors `service.server.ts`: the
 * OTP-specific `over_email_send_rate_limit` code plus the generic HTTP 429
 * `AuthApiError` (which can carry a different code). Supabase throttles
 * magic-link generation per email, so retrying inside the window is pointless —
 * we surface a clear, user-retryable error instead.
 *
 * @param cause - The error thrown by a Supabase admin call
 * @returns true if the failure is a rate-limit
 */
function isRateLimitError(cause: unknown): boolean {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? (cause as { code: unknown }).code
      : undefined;
  return (
    code === "over_email_send_rate_limit" ||
    (isAuthApiError(cause) && cause.status === 429)
  );
}

/**
 * Single attempt at minting a fresh Supabase session for `email` via the admin
 * `generateLink` (magiclink) → `verifyOtp` pattern. Throws the raw Supabase
 * error on failure so the caller can classify it (rate-limit vs transient).
 *
 * @param email - The already-authenticated user's email
 * @returns A mapped auth session (fresh access + refresh tokens)
 * @throws The raw Supabase error, or a {@link ShelfError} if Supabase returns
 *   success without a usable token/session
 */
async function mintMobileSessionOnce(email: string): Promise<AuthSession> {
  const { data: linkData, error: linkError } =
    await getSupabaseAdmin().auth.admin.generateLink({
      type: "magiclink",
      email,
    });

  if (linkError) {
    throw linkError;
  }

  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) {
    throw new ShelfError({
      cause: null,
      message: "Supabase did not return a verifiable token",
      label,
    });
  }

  const { data: otpData, error: otpError } =
    await getSupabaseAdmin().auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });

  if (otpError) {
    throw otpError;
  }

  const { session } = otpData;
  if (!session) {
    throw new ShelfError({
      cause: null,
      message: "The session returned by Supabase is null",
      label,
    });
  }

  return mapAuthSession(session);
}

/**
 * Mints a fresh, independent Supabase session for an already-authenticated user
 * without a password, via the admin `generateLink` (magiclink) → `verifyOtp`
 * pattern. The resulting session is a brand-new token family, decoupled from
 * the user's web session.
 *
 * Resilience: only transient Supabase failures (504s / network, surfaced as
 * `AuthRetryableFetchError`) are retried — up to {@link MINT_MAX_ATTEMPTS} times
 * with a short backoff. Rate-limits surface as a clear 429 (not retried — the
 * window won't clear in time). Deterministic failures (4xx, or our own
 * no-token/no-session errors) fail fast, since retrying can't change the result.
 *
 * SECURITY: this hands out a full session for `email` with no further checks —
 * it must ONLY be called after the caller has independently authorized the
 * request (here: a valid single-use {@link redeemMobileAuthCode}). It is
 * intentionally NOT exported.
 *
 * @param email - The already-authenticated user's email
 * @returns A mapped auth session (fresh access + refresh tokens)
 * @throws {ShelfError} 429 when rate-limited; otherwise re-throws the underlying
 *   cause, which {@link redeemMobileAuthCode} maps to a captured 500
 */
async function mintMobileSessionForUser(email: string): Promise<AuthSession> {
  for (let attempt = 1; attempt <= MINT_MAX_ATTEMPTS; attempt++) {
    try {
      return await mintMobileSessionOnce(email);
    } catch (cause) {
      // Rate-limited: retrying inside the window won't help. Surface a clear,
      // user-retryable 429 instead of a generic 500.
      if (isRateLimitError(cause)) {
        throw new ShelfError({
          cause,
          message:
            "Too many sign-in attempts. Please wait a moment and try again.",
          label,
          status: 429,
          shouldBeCaptured: false,
        });
      }

      // Only transient Supabase failures (504s / network) are worth retrying;
      // deterministic 4xx errors and our own ShelfErrors won't change on retry.
      const canRetry =
        attempt < MINT_MAX_ATTEMPTS && isAuthRetryableFetchError(cause);
      if (canRetry) {
        await sleep(attempt * MINT_RETRY_BASE_MS);
        continue;
      }

      // Deterministic failure, or a transient one that exhausted its retries.
      // redeemMobileAuthCode re-throws ShelfErrors as-is and wraps anything
      // else (raw Supabase / DB errors) in a captured 500.
      throw cause;
    }
  }

  // Unreachable: every iteration returns or throws. Satisfies the compiler.
  throw new ShelfError({
    cause: null,
    message: "Could not establish a mobile session. Please try again.",
    label,
    status: 500,
  });
}

/**
 * Mints a single-use authorization code bound to a user and returns the
 * PLAINTEXT code. The plaintext is only ever exposed in the `shelf://` deeplink
 * and the subsequent exchange request — only its hash is persisted.
 *
 * @param userId - The authenticated user the code authorizes a session for
 * @param codeChallenge - Optional PKCE (S256) challenge. When present, the code
 *   can only be redeemed with a matching verifier (see
 *   {@link redeemMobileAuthCode}). Omitted by legacy (pre-PKCE) app builds.
 * @returns The plaintext authorization code to embed in the deeplink
 * @throws {ShelfError} If the row cannot be created
 */
export async function createMobileAuthCode(
  userId: string,
  codeChallenge?: string
): Promise<string> {
  try {
    const code = randomBytes(32).toString("base64url"); // 256-bit entropy

    await db.mobileAuthCode.create({
      data: {
        userId,
        codeHash: hashCode(code),
        codeChallenge: codeChallenge ?? null,
        expiresAt: new Date(Date.now() + MOBILE_AUTH_CODE_TTL_MS),
      },
    });

    return code;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to create the mobile authorization code",
      label,
      additionalData: { userId },
    });
  }
}

/**
 * Atomically redeems a mobile auth code and mints a fresh, independent Supabase
 * session for the bound user.
 *
 * Redemption is single-use: the row is consumed with a conditional update
 * (`consumedAt IS NULL AND expiresAt > now`), so concurrent or replayed
 * requests cannot double-spend the code. A non-existent, expired, or
 * already-consumed code yields a uniform 400 (no oracle about which check
 * failed).
 *
 * PKCE: if the code was minted with an S256 `codeChallenge` (a PKCE-capable
 * app), the caller MUST present a `codeVerifier` that hashes to it — otherwise
 * the (now-consumed) code is rejected with the SAME uniform 400, so an
 * intercepted code is useless without the verifier. Codes minted WITHOUT a
 * challenge (legacy, pre-PKCE builds) redeem with no verifier — backward
 * compatible. Verification runs AFTER the atomic consume, so a wrong verifier
 * burns the single-use code; acceptable, since the legitimate app always
 * presents the matching verifier.
 *
 * @param code - The plaintext authorization code from the deeplink
 * @param codeVerifier - PKCE verifier; required iff the code carries a challenge
 * @returns A freshly minted, mapped auth session for the device
 * @throws {ShelfError} 400 if the code is missing/invalid/expired/used, or if a
 *   PKCE-bound code is presented without a matching verifier
 */
export async function redeemMobileAuthCode(
  code: string,
  codeVerifier?: string
): Promise<AuthSession> {
  try {
    if (!code) {
      throw new ShelfError({
        cause: null,
        message: "Authorization code is required",
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const codeHash = hashCode(code);

    // Atomic single-use consume: succeeds only if unredeemed AND unexpired.
    const { count } = await db.mobileAuthCode.updateMany({
      where: { codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    if (count !== 1) {
      throw new ShelfError({
        cause: null,
        message: "Invalid or expired authorization code",
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const { user, codeChallenge } = await db.mobileAuthCode.findUniqueOrThrow({
      where: { codeHash },
      select: { codeChallenge: true, user: { select: { email: true } } },
    });

    // PKCE check — only for codes minted with a challenge. Same uniform 400 as
    // an invalid code (no oracle about why redemption failed). The code is
    // already consumed above, so a wrong/absent verifier burns it.
    if (
      codeChallenge &&
      (!codeVerifier || !verifyPkceChallenge(codeVerifier, codeChallenge))
    ) {
      throw new ShelfError({
        cause: null,
        message: "Invalid or expired authorization code",
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    return await mintMobileSessionForUser(user.email);
  } catch (cause) {
    // Invalid / expired / already-used codes are thrown above with an explicit
    // 400 and re-thrown here unchanged. Anything else (e.g. a Supabase outage
    // while minting) is an INTERNAL failure and must surface as 500 — not a
    // client 400 — so retry and monitoring behavior can tell the two apart.
    if (isLikeShelfError(cause)) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message: "Failed to complete the mobile authorization exchange",
      label,
      status: 500,
    });
  }
}

/**
 * Deletes expired, unredeemed mobile auth codes. Safe to call opportunistically
 * (e.g. from the exchange route) or from a scheduled job — there is no app-level
 * cron in this codebase.
 *
 * @returns The number of rows deleted
 */
export async function deleteExpiredMobileAuthCodes(): Promise<number> {
  const { count } = await db.mobileAuthCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
