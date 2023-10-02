export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  organizationId: string;
  email: string;
  expiresIn: number;
  expiresAt: number;
}
