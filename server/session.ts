export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresIn: number;
  expiresAt: number;
  passwordLastUpdatedAt?: number | null;
};

export const authSessionKey = "auth";

export type SessionData = {
  [authSessionKey]: AuthSession;
};

export type FlashData = { errorMessage: string };
