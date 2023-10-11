import { getSupabaseAdmin } from "~/integrations/supabase";
import { SERVER_URL } from "~/utils/env";

import { mapAuthSession } from "./mappers.server";
import type { AuthSession } from "./types";

export async function createEmailAuthAccount(email: string, password: string) {
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (!data.user || error) return null;

  return data.user;
}

export async function signUpWithEmailPass(email: string, password: string) {
  const { data, error } = await getSupabaseAdmin().auth.signUp({
    email: email,
    password: password,
    options: {
      emailRedirectTo: `${SERVER_URL}/oauth/callback`,
      data: {
        signup_method: "email-password",
      },
    },
  });

  if (!data || error)
    return { status: "error", error: "Unable to create account" };

  return { status: "Email verification_required", user: data.user };
}

export async function resendVerificationEmail(email: string) {
  const { data, error } = await getSupabaseAdmin().auth.resend({
    type: "signup",
    email: email,
  });

  if (error) {
    return { status: "error", error: error.message };
  }

  if (data) {
    return {
      status: "success",
      message: "Verification email resent successfully",
    };
  }

  return { status: "error", error: "Somthing went wring please try again" };
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await getSupabaseAdmin().auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { status: "error", message: error.message };
  }
  if (!data.session) {
    return { status: "error", message: "something went wrong try login again" };
  }

  const mappedSession = await mapAuthSession(data.session);

  if (!mappedSession) {
    return { status: "error", message: "something went wrong try login again" };
  }

  return { status: "success", authSession: mappedSession };
}

export async function sendMagicLink(email: string) {
  return getSupabaseAdmin().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${SERVER_URL}/oauth/callback`,
    },
  });
}

export async function sendResetPasswordLink(email: string) {
  return getSupabaseAdmin().auth.resetPasswordForEmail(email, {
    redirectTo: `${SERVER_URL}/reset-password`,
  });
}

export async function updateAccountPassword(id: string, password: string) {
  const { data, error } = await getSupabaseAdmin().auth.admin.updateUserById(
    id,
    { password }
  );

  if (!data.user || error) return null;

  return data.user;
}

export async function deleteAuthAccount(userId: string) {
  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(userId);

  if (error) return null;

  return true;
}

export async function getAuthUserByAccessToken(accessToken: string) {
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);

  if (!data.user || error) return null;

  return data.user;
}

export async function getAuthResponseByAccessToken(accessToken: string) {
  return await getSupabaseAdmin().auth.getUser(accessToken);
}
export async function refreshAccessToken(
  refreshToken?: string
): Promise<AuthSession | null> {
  if (!refreshToken) return null;

  const { data, error } = await getSupabaseAdmin().auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (!data.session || error) return null;

  return await mapAuthSession(data.session);
}

export async function verifyAuthSession(authSession: AuthSession) {
  const authAccount = await getAuthResponseByAccessToken(
    authSession.accessToken
  );

  return Boolean(authAccount);
}
