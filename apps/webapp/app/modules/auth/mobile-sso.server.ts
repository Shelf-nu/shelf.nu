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
import { createHash, randomBytes } from "node:crypto";
import type { AuthSession } from "@server/session";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { mapAuthSession } from "./mappers.server";

const label: ErrorLabel = "Auth";

/**
 * Lifetime of a mobile auth code. Deliberately short — it only needs to survive
 * the deeplink round-trip from the web callback back into the app.
 */
const MOBILE_AUTH_CODE_TTL_MS = 60_000;

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
 * Mints a fresh, independent Supabase session for an already-authenticated user
 * without a password, via the admin `generateLink` (magiclink) → `verifyOtp`
 * pattern. The resulting session is a brand-new token family, decoupled from
 * the user's web session.
 *
 * SECURITY: this hands out a full session for `email` with no further checks —
 * it must ONLY be called after the caller has independently authorized the
 * request (here: a valid single-use {@link redeemMobileAuthCode}). It is
 * intentionally NOT exported.
 *
 * @param email - The already-authenticated user's email
 * @returns A mapped auth session (fresh access + refresh tokens)
 * @throws {ShelfError} If Supabase fails to generate or verify the link
 */
async function mintMobileSessionForUser(email: string): Promise<AuthSession> {
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
 * Mints a single-use authorization code bound to a user and returns the
 * PLAINTEXT code. The plaintext is only ever exposed in the `shelf://` deeplink
 * and the subsequent exchange request — only its hash is persisted.
 *
 * @param userId - The authenticated user the code authorizes a session for
 * @returns The plaintext authorization code to embed in the deeplink
 * @throws {ShelfError} If the row cannot be created
 */
export async function createMobileAuthCode(userId: string): Promise<string> {
  try {
    const code = randomBytes(32).toString("base64url"); // 256-bit entropy

    await db.mobileAuthCode.create({
      data: {
        userId,
        codeHash: hashCode(code),
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
 * @param code - The plaintext authorization code from the deeplink
 * @returns A freshly minted, mapped auth session for the device
 * @throws {ShelfError} 400 if the code is missing/invalid/expired/already used
 */
export async function redeemMobileAuthCode(code: string): Promise<AuthSession> {
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

    const { user } = await db.mobileAuthCode.findUniqueOrThrow({
      where: { codeHash },
      select: { user: { select: { email: true } } },
    });

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
