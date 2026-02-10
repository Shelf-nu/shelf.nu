import { AuthError, isAuthApiError } from "@supabase/supabase-js";
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
    const message = isRateLimitError
      ? "You're trying too fast. Please wait a few seconds and try again."
      : "Something went wrong, refresh page and try to signup again.";
    throw new ShelfError({
      cause,
      message,
      additionalData: { email },
      label,
      shouldBeCaptured: !isRateLimitError,
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
    let message =
      "Something went wrong. Please try again later or contact support.";
    let shouldBeCaptured = true;

    if (
      isAuthApiError(cause) &&
      cause.message === "Invalid login credentials"
    ) {
      message = "Incorrect email or password";
      shouldBeCaptured = false;
    }

    throw new ShelfError({
      cause,
      message,
      label,
      shouldBeCaptured,
    });
  }
}

export async function signInWithSSO(domain: string) {
  try {
    const { data, error } = await getSupabaseAdmin().auth.signInWithSSO({
      domain,
      options: {
        redirectTo: `${SERVER_URL}/oauth/callback`,
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
    // @ts-expect-error
    const isRateLimitError = cause.code === "over_email_send_rate_limit";
    throw new ShelfError({
      cause,
      message:
        cause instanceof AuthError || isLikeShelfError(cause)
          ? cause.message
          : "Something went wrong while sending the OTP. Please try again later or contact support.",
      additionalData: { email },
      label,
      shouldBeCaptured: isRateLimitError ? false : undefined,
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
    //logout all the others session expect the current sesssion.
    if (accessToken) {
      await getSupabaseAdmin().auth.admin.signOut(accessToken, "others");
    }
    //on password update, it is remvoing the session in th supbase.
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
    throw new ShelfError({
      cause,
      message:
        "Unable to refresh access token. Please try again. If the issue persists, contact support",
      label,
      additionalData: {
        refreshToken,
      },
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
