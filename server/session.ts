import { createCookieSessionStorage } from "@remix-run/node";
import { env } from "~/utils/env";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresIn: number;
  expiresAt: number;
};

export const authSessionKey = "auth";

export type SessionData = {
  [authSessionKey]: AuthSession;
};

export type FlashData = { errorMessage: string };

/** Creates a session storage */
export function createSessionStorage() {
  return createCookieSessionStorage({
    cookie: {
      name: "__authSession",
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secrets: [env.SESSION_SECRET],
      secure: env.NODE_ENV === "production",
    },
  });
}
