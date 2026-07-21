import {
  AuthError,
  isAuthApiError,
  isAuthRetryableFetchError,
} from "@supabase/supabase-js";
import type { AuthSession } from "@server/session";
import { config } from "~/config/shelf.config";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { SERVER_URL } from "~/utils/env";

import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { mapAuthSession } from "./mappers.server";

const label: ErrorLabel = "Auth";

export async function createEmailAuthAccount(email: string, password: string) {
  try {
    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      throw error;
    }

    const { user } = data;

    return user;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to create email auth account",
      additionalData: { email },
      label,
    });
  }
}

/**
 * Looks up an existing Supabase auth account by email and confirms it.
 *
 * Used as a fallback during invite acceptance when `createEmailAuthAccount`
 * fails because the email already exists in Supabase (e.g. user signed up
 * but never confirmed their email). The invite JWT serves as proof of email
 * ownership, making direct confirmation safe.
 *
 * @returns The confirmed auth user, or `null` if no auth account exists
 *          for the given email.
 */
export async function confirmExistingAuthAccount(
  email: string,
  password: string
) {
  try {
    const result = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM auth.users
      WHERE email = ${email.toLowerCase()}
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    const { data, error } = await getSupabaseAdmin().auth.admin.updateUserById(
      result[0].id,
      {
        email_confirm: true,
        password,
      }
    );

    if (error) {
      throw error;
    }

    return data.user;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to confirm existing auth account",
      additionalData: { email },
      label,
    });
  }
}

export async function signUpWithEmailPass(email: string, password: string) {
  try {
    const { data, error } = await getSupabaseAdmin().auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          signup_method: "email-password",
        },
      },
    });

    if (error) {
      throw error;
    }

    const { user } = data;

    if (!user) {
      throw new ShelfError({
        cause: null,
        message: "The user returned by Supabase is null",
        label,
      });
    }

    return user;
  } catch (cause) {
    const isRateLimitError =
      isAuthApiError(cause) &&
      (cause.status === 429 ||
        cause.message.includes("request this after 5 seconds"));
    const isTransientFetchError = isAuthRetryableFetchError(cause);
    /** Supabase can return transient database errors during user creation
     * that resolve on retry — suppress these from Sentry. */
    const isDatabaseError =
      isAuthApiError(cause) && cause.message.includes("Database error");
    const message = isRateLimitError
      ? "You're trying too fast. Please wait a few seconds and try again."
      : "Something went wrong, refresh page and try to signup again.";
    throw new ShelfError({
      cause,
      message,
      additionalData: { email },
      label,
      shouldBeCaptured: !(
        isRateLimitError ||
        isTransientFetchError ||
        isDatabaseError
      ),
    });
  }
}

export async function resendVerificationEmail(email: string) {
  try {
    const { error } = await getSupabaseAdmin().auth.resend({
      type: "signup",
      email,
    });

    if (error) {
      throw error;
    }
  } catch (cause) {
    // @ts-expect-error
    const isRateLimitError = cause?.code === "over_email_send_rate_limit";
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while resending the verification email. Please try again later or contact support.",
      additionalData: { email },
      label,
      shouldBeCaptured: !isRateLimitError,
    });
  }
}

export async function signInWithEmail(email: string, password: string) {
  try {
    const { data, error } = await getSupabaseAdmin().auth.signInWithPassword({
      email,
      password,
    });

    if (error?.message === "Email not confirmed") {
      return null;
    }

    if (error) {
      throw error;
    }

    const { session } = data;

    return mapAuthSession(session);
  } catch (cause) {
    const isInvalidCredentials =
      isAuthApiError(cause) && cause.message === "Invalid login credentials";
    // Supabase 504s and intermittent fetch failures surface as
    // `AuthRetryableFetchError`. They resolve on retry and shouldn't page us.
    const isTransientFetchError = isAuthRetryableFetchError(cause);
    // "Database error finding user" / similar transient backend hiccups.
    const isDatabaseError =
      isAuthApiError(cause) && cause.message.includes("Database error");
    const isRateLimitError = isAuthApiError(cause) && cause.status === 429;

    const message = isInvalidCredentials
      ? "Incorrect email or password"
      : "Something went wrong. Please try again later or contact support.";

    throw new ShelfError({
      cause,
      message,
      label,
      shouldBeCaptured: !(
        isInvalidCredentials ||
        isTransientFetchError ||
        isDatabaseError ||
        isRateLimitError
      ),
    });
  }
}

export async function signInWithSSO(
  domain: string,
  /**
   * Which client is initiating SSO. `"mobile"` lands the post-auth redirect on
   * the native-app callback path (which hands a session back to the app);
   * defaults to the web callback. The redirect path is built HERE (never taken
   * from the caller) so it is always an allow-listed, query-free Supabase
   * redirect URL — Supabase treats `?` as a wildcard in the allow-list.
   */
  { platform = "web" }: { platform?: "web" | "mobile" } = {}
) {
  try {
    const redirectTo = `${SERVER_URL}/oauth/callback${
      platform === "mobile" ? "/mobile" : ""
    }`;

    const { data, error } = await getSupabaseAdmin().auth.signInWithSSO({
      domain,
      options: {
        redirectTo,
      },
    });

    if (error) {
      throw error;
    }

    return data.url;
  } catch (cause) {
    let message =
      "Something went wrong. Please try again later or contact support.";
    let shouldBeCaptured = true;

    // @ts-expect-error
    if (cause?.code === "sso_provider_not_found") {
      message = "No SSO provider assigned for your organization's domain";
      shouldBeCaptured = false;
    }

    throw new ShelfError({
      cause,
      message,
      label,
      shouldBeCaptured,
      additionalData: { domain },
    });
  }
}

/**
 * Helper function to check if user is SSO-only and throw appropriate error
 * @param email User's email address
 * @throws ShelfError if user exists and is SSO-only
 */
async function validateNonSSOUser(email: string) {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { sso: true },
  });

  if (user?.sso) {
    throw new ShelfError({
      cause: null,
      title: "SSO User",
      message:
        "This email address is associated with an SSO account. Please use SSO login instead.",
      additionalData: { email },
      label: "Auth",
      shouldBeCaptured: false,
    });
  }
}

export async function sendOTP(email: string) {
  try {
    await validateNonSSOUser(email);

    const { error } = await getSupabaseAdmin().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: !config.disableSignup, // If signup is disabled, don't create a new user
      },
    });

    if (error) {
      throw error;
    }
  } catch (cause) {
    // Read `code` via narrowing instead of `@ts-expect-error` — `cause` is
    // `unknown`, and a bare property access would throw at runtime if it
    // were null/undefined.
    const errorCode =
      typeof cause === "object" && cause !== null && "code" in cause
        ? (cause as { code: unknown }).code
        : undefined;
    // Match `signInWithEmail`'s rate-limit handling: cover both the
    // Supabase OTP-specific `over_email_send_rate_limit` code and the
    // generic HTTP 429 `AuthApiError` (which can carry a different code).
    const isRateLimitError =
      errorCode === "over_email_send_rate_limit" ||
      (isAuthApiError(cause) && cause.status === 429);
    // Supabase 504s and intermittent fetch failures resolve on retry.
    const isTransientFetchError = isAuthRetryableFetchError(cause);
    // "Database error finding user" — Supabase backend hiccup, not actionable.
    const isDatabaseError =
      isAuthApiError(cause) && cause.message.includes("Database error");
    // SSO-mismatch / similar `validateNonSSOUser` rejections already opt out
    // via their own `shouldBeCaptured: false` — preserve that decision.
    const inheritedShouldBeCaptured = isLikeShelfError(cause)
      ? cause.shouldBeCaptured
      : undefined;

    const fallbackMessage =
      "Something went wrong while sending the OTP. Please try again later or contact support.";

    // AuthRetryableFetchError (e.g. from 504 timeout) can have "{}" as message,
    // so we validate the message is actually useful before showing it to users
    const hasUsableMessage =
      (cause instanceof AuthError || isLikeShelfError(cause)) &&
      cause.message &&
      cause.message !== "{}" &&
      !cause.message.startsWith("{");

    throw new ShelfError({
      cause,
      message: hasUsableMessage ? cause.message : fallbackMessage,
      additionalData: { email },
      label,
      shouldBeCaptured:
        inheritedShouldBeCaptured === false
          ? false
          : !(isRateLimitError || isTransientFetchError || isDatabaseError),
    });
  }
}

export async function sendResetPasswordLink(email: string) {
  try {
    await validateNonSSOUser(email);

    await getSupabaseAdmin().auth.resetPasswordForEmail(email);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while sending the reset password link. Please try again later or contact support.",
      additionalData: { email },
      label,
    });
  }
}

/**
 * Updates a user's password via the Supabase admin API.
 *
 * On success the user's existing sessions are revoked in two layers:
 *
 * 1. Explicit (this function): when an `accessToken` is supplied, we call
 *    `admin.signOut(accessToken, "others")` to revoke every OTHER session for
 *    the user, keeping the caller's own session alive.
 * 2. Implicit (GoTrue): `admin.updateUserById({ password })` runs
 *    `UpdatePassword(tx, nil)` internally, which calls `Logout(tx, userId)` —
 *    deleting ALL sessions for the user (including the caller's), with refresh
 *    tokens cascade-deleted via `refresh_tokens_session_id_fkey`.
 *
 * Layer 2 alone is sufficient on current GoTrue (≥ v2.79.0), so layer 1 is
 * deliberate defense-in-depth: it is not a documented API contract, so if a
 * future or self-hosted GoTrue stops cascading the logout, the explicit
 * `signOut` still revokes other sessions and prevents a "password changed but
 * stolen session still works" bug. It runs BEFORE the update on purpose — the
 * update deletes the session behind `accessToken`, after which the token can no
 * longer authenticate a `signOut` call.
 *
 * Layer 1 is best-effort: because layer 2 is the primary revocation, a `signOut`
 * failure must never block the password change, so it is caught and reported to
 * Sentry (`shouldBeCaptured: true`) rather than thrown — never swallowed
 * silently, since it is the safety net for exactly the GoTrue-regression case.
 *
 * Because all sessions (including the caller's) are gone after the update,
 * callers that must keep the user logged in have to mint a fresh session
 * afterwards (see the `signInWithEmail` call in the onboarding route). Shelf's
 * `protect()` middleware calls {@link validateSession} on every non-public
 * request, so any other logged-in browser is signed out on its next request.
 *
 * @param id - The Supabase auth user id whose password is being changed
 * @param password - The new plaintext password
 * @param accessToken - The caller's current access token. When provided, other
 *   sessions are explicitly revoked (defense-in-depth) before the password
 *   update; omit it when the caller has no live session to preserve.
 * @throws {ShelfError} If the user is SSO-backed, or the update fails
 */
export async function updateAccountPassword(
  id: string,
  password: string,
  accessToken?: string | undefined
) {
  try {
    const user = await db.user.findFirst({
      where: { id },
      select: {
        sso: true,
      },
    });
    if (user?.sso) {
      throw new ShelfError({
        cause: null,
        message: "You cannot update the password of an SSO user.",
        label,
      });
    }

    // Defense-in-depth: explicitly revoke all other sessions before the update.
    // The update below also revokes sessions on its own (see JSDoc), but that
    // is an undocumented GoTrue detail we don't want to depend on alone.
    //
    // Best-effort by design: this layer must never block the password change
    // (layer 2 below is the primary revocation). But it is a security-critical
    // safety net, so a failure is captured in Sentry rather than swallowed
    // silently — `admin.signOut` returns its error instead of throwing, so we
    // surface it explicitly. `shouldBeCaptured: true` guarantees the capture.
    if (accessToken) {
      try {
        const { error: signOutError } =
          await getSupabaseAdmin().auth.admin.signOut(accessToken, "others");
        if (signOutError) {
          throw signOutError;
        }
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message:
              "Failed to revoke other sessions before a password change. The password update still revokes all sessions on current GoTrue, but this defense-in-depth layer did not run — investigate if this recurs.",
            additionalData: { id },
            label,
            shouldBeCaptured: true,
          })
        );
      }
    }

    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(id, {
      password,
    });

    if (error) {
      throw error;
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while updating the password. Please try again later or contact support.",
      additionalData: { id },
      label,
    });
  }
}

export async function deleteAuthAccount(userId: string) {
  try {
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(userId);

    if (error) {
      throw error;
    }
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message:
          "Something went wrong while deleting the auth account. Please manually delete the user account in the Supabase dashboard.",
        additionalData: { userId },
        label,
      })
    );
  }
}

export async function getAuthUserById(userId: string) {
  try {
    const { data, error } =
      await getSupabaseAdmin().auth.admin.getUserById(userId);

    if (error) {
      throw error;
    }

    const { user } = data;

    return user;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while getting the auth user by id. Please try again later or contact support.",
      additionalData: { userId },
      label,
    });
  }
}

export async function getAuthResponseByAccessToken(accessToken: string) {
  try {
    return await getSupabaseAdmin().auth.getUser(accessToken);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while getting the auth response by access token. Please try again later or contact support.",
      label,
    });
  }
}

export async function validateSession(token: string) {
  try {
    // const t0 = performance.now();
    const result = await db.$queryRaw<{ id: string; revoked: boolean }[]>`
      SELECT id, revoked FROM auth.refresh_tokens 
      WHERE token = ${token} 
      AND revoked = false
      LIMIT 1 
    `;
    // const t1 = performance.now();

    // eslint-disable-next-line no-console
    // console.log(`Call to validateSession took ${t1 - t0} milliseconds.`);

    if (result.length === 0) {
      //logging for debug
      Logger.error(
        new ShelfError({
          cause: null,
          message: "Refresh token is invalid or has been revoked",
          label,
          shouldBeCaptured: false,
        })
      );
    }
    return result.length > 0;
  } catch (_err) {
    Logger.error(
      new ShelfError({
        cause: null,
        message: "Something went wrong while valdiating the session",
        label,
        shouldBeCaptured: false,
      })
    );
    return false;
  }
}

export async function refreshAccessToken(
  refreshToken?: string
): Promise<AuthSession> {
  try {
    if (!refreshToken) {
      throw new ShelfError({
        cause: null,
        message: "Refresh token is required",
        label,
      });
    }

    const { data, error } = await getSupabaseAdmin().auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) {
      throw error;
    }

    const { session } = data;

    if (!session) {
      throw new ShelfError({
        cause: null,
        message: "The session returned by Supabase is null",
        label,
      });
    }

    return mapAuthSession(session);
  } catch (cause) {
    // SECURITY: never put `refreshToken` (a long-lived bearer credential) in
    // additionalData — if this error is ever captured it would be spread into
    // the Sentry event's `extra`. `makeSentryContext` also redacts secret-ish
    // keys as a backstop, but the credential should not be in the error at all.
    throw new ShelfError({
      cause,
      message:
        "Unable to refresh access token. Please try again. If the issue persists, contact support",
      label,
    });
  }
}

export async function verifyAuthSession(authSession: AuthSession) {
  try {
    const authAccount = await getAuthResponseByAccessToken(
      authSession.accessToken
    );

    return Boolean(authAccount);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while verifying the auth session. Please try again later or contact support.",
      label,
    });
  }
}

export async function verifyOtpAndSignin(email: string, otp: string) {
  try {
    const { data, error } = await getSupabaseAdmin().auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });

    if (error) {
      throw error;
    }

    const { session } = data;

    if (!session) {
      throw new ShelfError({
        cause: null,
        message: "The session returned by Supabase is null",
        label,
      });
    }

    return mapAuthSession(session);
  } catch (cause) {
    let message =
      "Something went wrong. Please try again later or contact support.";
    let shouldBeCaptured = true;

    if (isAuthApiError(cause) && cause.message !== "") {
      message = cause.message;
      shouldBeCaptured = false;
    }

    throw new ShelfError({
      cause,
      message,
      label,
      shouldBeCaptured,
      additionalData: { email },
    });
  }
}
