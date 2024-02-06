// TODO: import your AuthSession
export type AuthSession = {
  userId: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  expiresIn: number;
};

export const authSessionKey = "auth";

export type SessionData = {
  [authSessionKey]: AuthSession;
};

export type FlashData = { errorMessage: string };
