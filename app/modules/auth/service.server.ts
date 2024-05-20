import { isAuthApiError } from "@supabase/supabase-js";
import type { AuthSession } from "server/session";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { NODE_ENV, SERVER_URL } from "~/utils/env";

import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
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
    throw new ShelfError({
      cause,
      message: "Something went wrong, refresh page and try to signup again.",
      additionalData: { email },
      label,
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
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while resending the verification email. Please try again later or contact support.",
      additionalData: { email },
      label,
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

export async function sendOTP(email: string) {
  try {
    const { error } = await getSupabaseAdmin().auth.signInWithOtp({ email });

    if (error) {
      throw error;
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while sending the OTP. Please try again later or contact support.",
      additionalData: { email },
      label,
    });
  }
}

export async function sendResetPasswordLink(email: string) {
  try {
    await getSupabaseAdmin().auth.resetPasswordForEmail(email, {
      redirectTo: `${SERVER_URL}/reset-password`,
    });
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

export async function updateAccountPassword(id: string, password: string) {
  try {
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
    /** This is meant for e2e tests
     * In that case we manually generate an OTP and use it to verify the email
     */
    if (NODE_ENV === "test" || process.env.CI === "true") {
      const { data } = await getSupabaseAdmin().auth.admin.generateLink({
        type: "magiclink",
        email: email,
      });

      otp = data.properties?.email_otp as string;
    }

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
