/**
 * Native-app SSO session handoff (web-delegated auth).
 *
 * SSO organizations disable password auth, so the password-only companion app
 * cannot log them in. Instead the app opens the system browser to authenticate
 * on the web (which already handles SAML/SCIM), then receives a session via a
 * single-use authorization code:
 *
 *   1. After SSO completes, `_auth+/oauth.callback.mobile.tsx` calls
 *      {@link createMobileAuthCode} with the SSO session's refresh token and
 *      hands the plaintext code to the app through the
 *      `shelf://auth-callback?code=…` deeplink (no tokens in the URL).
 *   2. The app redeems the code at `POST /api/mobile/exchange`
 *      (`api+/mobile+/exchange.ts`), which calls {@link redeemMobileAuthCode}
 *      and receives that same session, freshly refreshed.
 *
 * The app gets the session the identity provider actually produced, so it
 * belongs to the SSO auth user and carries the `sso/saml` authentication
 * method. Never mint a session for an SSO account by email instead: GoTrue's
 * magic-link, OTP and recovery lookups skip `is_sso_user` accounts, so
 * `admin.generateLink` creates and signs in a separate non-SSO auth user with
 * the same address.
 *
 * The handed-over session is not shared with the web. The mobile callback sets
 * no web session cookie, and the browser Supabase client neither persists nor
 * auto-refreshes it, so the app is the only holder of its token family.
 *
 * The refresh token is stored only until the code is redeemed or cleaned up,
 * encrypted under a key derived from the plaintext code and the server's
 * session secret. Only the code's hash is persisted, so neither a database read
 * nor an intercepted code, nor both together, recovers the token.
 *
 * @see apps/webapp/app/routes/_auth+/oauth.callback.mobile.tsx
 * @see apps/webapp/app/routes/api+/mobile+/exchange.ts
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isAuthApiError } from "@supabase/supabase-js";
import type { AuthSession } from "@server/session";
import { db } from "~/database/db.server";
import { SESSION_SECRET } from "~/utils/env";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { refreshAccessToken } from "./service.server";

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
 * HKDF `info` for the session key. Binds the derived key to this one purpose,
 * so the same code could never yield a key that decrypts anything else.
 */
const SESSION_KEY_INFO = "shelf-mobile-auth-code-session-v1";

/** AES-GCM nonce length in bytes (the 96-bit size GCM is specified for). */
const IV_BYTES = 12;

/** AES-GCM authentication tag length in bytes. Shorter tags are refused. */
const TAG_BYTES = 16;

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
 * Derives the AES-256 key that protects a code's stored session from the code
 * and the server's session secret (the HKDF salt). The secret is what keeps an
 * intercepted code from decrypting a leaked row: the code alone, which travels
 * through a custom-scheme deeplink, must never be enough.
 *
 * @param code - The plaintext authorization code
 * @returns A 32-byte key
 */
function sessionKeyFor(code: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", code, SESSION_SECRET, SESSION_KEY_INFO, 32)
  );
}

/**
 * Encrypts a refresh token under the code's derived key.
 *
 * @param refreshToken - The SSO session's refresh token
 * @param code - The plaintext authorization code
 * @returns `iv.ciphertext.tag`, each part base64url
 */
function encryptSession(refreshToken: string, code: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sessionKeyFor(code), iv);
  const ciphertext = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final(),
  ]);
  return [iv, ciphertext, cipher.getAuthTag()]
    .map((part) => part.toString("base64url"))
    .join(".");
}

/**
 * Decrypts a stored session with the presented code.
 *
 * @param stored - The `iv.ciphertext.tag` value written by {@link encryptSession}
 * @param code - The plaintext authorization code
 * @returns The refresh token, or null when the value is malformed or does not
 *   authenticate under this code
 */
function decryptSession(stored: string, code: string): string | null {
  try {
    const [iv, ciphertext, tag] = stored
      .split(".")
      .map((part) => Buffer.from(part, "base64url"));
    if (
      !iv ||
      !ciphertext ||
      !tag ||
      iv.length !== IV_BYTES ||
      tag.length !== TAG_BYTES
    ) {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", sessionKeyFor(code), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
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
 * Supabase Auth error codes that mean the session can no longer be refreshed.
 * Every other code (a refresh `conflict`, a rate limit, anything unknown) is a
 * service failure, never a reason to tell the app its code was bad.
 */
const DEAD_SESSION_CODES = new Set<string>([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "user_not_found",
  "user_banned",
  "bad_jwt",
]);

/**
 * Whether a failed refresh means the session itself is no longer valid, as
 * opposed to Supabase failing to answer. `refreshAccessToken` wraps the
 * supabase-js error as the ShelfError's `cause`.
 *
 * A coded response is judged by its code alone. A response without a code (an
 * older GoTrue) falls back to its status: a 4xx means the session is gone,
 * except 409 (a concurrent-refresh conflict) and 429 (a rate limit).
 *
 * @param cause - What `refreshAccessToken` threw
 * @returns true when signing in again is the only remedy
 */
function isDeadSessionRefusal(cause: unknown): boolean {
  if (!isLikeShelfError(cause)) return false;
  const apiError = cause.cause;
  if (!isAuthApiError(apiError)) return false;

  if (apiError.code) return DEAD_SESSION_CODES.has(apiError.code);

  return (
    apiError.status >= 400 &&
    apiError.status < 500 &&
    apiError.status !== 409 &&
    apiError.status !== 429
  );
}

/**
 * The uniform refusal for every redemption that cannot succeed. One message
 * and status for all of them, so a caller learns nothing about which check
 * failed.
 */
function invalidCodeError(): ShelfError {
  return new ShelfError({
    cause: null,
    message: "Invalid or expired authorization code",
    label,
    status: 400,
    shouldBeCaptured: false,
  });
}

/**
 * Mints a single-use authorization code bound to a user and the SSO session
 * the app will receive, and returns the PLAINTEXT code. The plaintext is only
 * ever exposed in the `shelf://` deeplink and the subsequent exchange request;
 * only its hash is persisted.
 *
 * @param args.userId - The Shelf user the SSO sign-in resolved to
 * @param args.refreshToken - The SSO session's refresh token. The caller must
 *   not use it afterwards: the app becomes its only holder.
 * @param args.codeChallenge - PKCE (S256) challenge. Always present in
 *   practice: `/sso-login` refuses to start a mobile flow without one, and a
 *   code carrying none is unredeemable.
 * @returns The plaintext authorization code to embed in the deeplink
 * @throws {ShelfError} If the row cannot be created
 */
export async function createMobileAuthCode({
  userId,
  refreshToken,
  codeChallenge,
}: {
  userId: string;
  refreshToken: string;
  codeChallenge?: string;
}): Promise<string> {
  try {
    const code = randomBytes(32).toString("base64url"); // 256-bit entropy

    await db.mobileAuthCode.create({
      data: {
        userId,
        codeHash: hashCode(code),
        codeChallenge: codeChallenge ?? null,
        sessionCiphertext: encryptSession(refreshToken, code),
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
 * Atomically redeems a mobile auth code and returns the SSO session it was
 * minted with, refreshed so the app starts from a new token pair.
 *
 * Redemption is single-use: the row is consumed with a conditional update
 * (`consumedAt IS NULL AND expiresAt > now`), so concurrent or replayed
 * requests cannot double-spend the code. The stored session is then cleared
 * from the row before any other check, so it never outlives one attempt.
 *
 * PKCE is mandatory and unconditional. The caller MUST present a
 * `codeVerifier` that hashes to the code's stored S256 `codeChallenge`;
 * anything else (a missing verifier, a wrong one, or a code carrying no
 * challenge at all) is rejected. A NULL `codeChallenge` is treated as poison
 * rather than as a legacy opt-out: an unbound code is a bearer token, which is
 * precisely what PKCE exists to prevent on a custom-scheme callback any app can
 * claim. Verification runs AFTER the atomic consume, so a wrong verifier burns
 * the single-use code; acceptable, since the legitimate app always presents the
 * matching verifier.
 *
 * Every refusal (unknown, expired, used, unbound, wrong verifier, no stored
 * session, a session that no longer refreshes or belongs to another user) is
 * the same uniform 400, so redemption gives no oracle about why.
 *
 * @param code - The plaintext authorization code from the deeplink
 * @param codeVerifier - PKCE verifier. Optional in the signature only so the
 *   refusal path stays reachable; a redemption without one always fails.
 * @returns The refreshed SSO session for the device
 * @throws {ShelfError} 400 when the code cannot be redeemed; 500 when the
 *   database or Supabase fails to answer
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

    // Consume, read and clear in one transaction, so a code that is spent
    // never keeps its session, whatever fails after. The conditional update is
    // the single-use guard: it succeeds only if unredeemed AND unexpired.
    const row = await db.$transaction(async (tx) => {
      const { count } = await tx.mobileAuthCode.updateMany({
        where: { codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (count !== 1) return null;

      const consumed = await tx.mobileAuthCode.findUniqueOrThrow({
        where: { codeHash },
        select: { userId: true, codeChallenge: true, sessionCiphertext: true },
      });
      await tx.mobileAuthCode.update({
        where: { codeHash },
        data: { sessionCiphertext: null },
      });
      return consumed;
    });

    if (!row) throw invalidCodeError();
    const { userId, codeChallenge, sessionCiphertext } = row;

    // PKCE is MANDATORY. A code minted without a challenge is a bearer token —
    // whoever holds the plaintext from the `shelf://` deeplink gets a session —
    // and the custom-scheme callback is exactly the channel PKCE exists to
    // protect (RFC 8252 §8.1). So a NULL challenge is unredeemable rather than
    // a check to skip: refusing here means a code that somehow reached the
    // database unbound can never be spent.
    if (
      !codeChallenge ||
      !codeVerifier ||
      !verifyPkceChallenge(codeVerifier, codeChallenge)
    ) {
      throw invalidCodeError();
    }

    const refreshToken = sessionCiphertext
      ? decryptSession(sessionCiphertext, code)
      : null;
    if (!refreshToken) throw invalidCodeError();

    let session: AuthSession;
    try {
      session = await refreshAccessToken(refreshToken);
    } catch (cause) {
      // Supabase says the session was signed out or expired between the
      // callback and the exchange: signing in again is the only remedy, as for
      // an expired code.
      if (isDeadSessionRefusal(cause)) throw invalidCodeError();

      // Anything else (unreachable, 5xx, a conflict, rate limited, an empty
      // response) is a service failure, reported and captured as one. The code is already spent, so
      // the app starts a new sign-in either way.
      throw new ShelfError({
        cause,
        message: "Could not establish a mobile session. Please try again.",
        label,
        status: 500,
      });
    }

    // The code was minted for the Shelf user the SSO sign-in resolved to, whose
    // id is the SSO auth user's. A session for any other auth user is refused.
    if (session.userId !== userId) throw invalidCodeError();

    return session;
  } catch (cause) {
    // Refusals are thrown above with an explicit 400 and re-thrown here
    // unchanged. Anything else (a database failure) is an INTERNAL failure and
    // must surface as 500, so retry and monitoring can tell the two apart.
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
 * Deletes expired mobile auth codes, together with the session an unredeemed
 * one still carries. Called opportunistically from both the mobile callback and
 * the exchange, so an abandoned sign-in's session is dropped by the next mobile
 * sign-in; there is no app-level cron in this codebase.
 *
 * @returns The number of rows deleted
 */
export async function deleteExpiredMobileAuthCodes(): Promise<number> {
  const { count } = await db.mobileAuthCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
