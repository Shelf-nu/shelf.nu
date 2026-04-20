import { http, HttpResponse } from "msw";

import { USER_EMAIL, USER_ID, USER_PASSWORD } from "./user";

export const supabaseAuthSession = {
  user: { id: USER_ID, email: USER_EMAIL },
  refresh_token: "valid",
  access_token: "valid",
  expires_in: -1,
};

export const authSession = {
  refreshToken: "valid",
  accessToken: "valid",
  userId: USER_ID,
  email: USER_EMAIL,
  expiresIn: -1,
  expiresAt: -1,
};

export const authAccount = {
  id: USER_ID,
  email: USER_EMAIL,
};

export const SUPABASE_URL = "https://supabase-project.supabase.co";
export const SUPABASE_AUTH_TOKEN_API = "/auth/v1/token";
export const SUPABASE_AUTH_USER_API = "/auth/v1/user";
export const SUPABASE_AUTH_ADMIN_USER_API = "/auth/v1/admin/users";

export const handlers = [
  http.post(
    `${SUPABASE_URL}${SUPABASE_AUTH_TOKEN_API}`,
    async ({ request }) => {
      const { email, password, refresh_token } =
        (await request.json()) as Record<string, string>;

      if (refresh_token) {
        if (refresh_token !== "valid")
          return HttpResponse.json({ error: "Token expired" }, { status: 401 });
        return HttpResponse.json(supabaseAuthSession, { status: 200 });
      }

      if (!email || !password || password !== USER_PASSWORD)
        return HttpResponse.json(
          { message: "Wrong email or password" },
          { status: 401 }
        );
      return HttpResponse.json(supabaseAuthSession, { status: 200 });
    }
  ),
  http.get(`${SUPABASE_URL}${SUPABASE_AUTH_USER_API}`, async ({ request }) => {
    const token = request.headers.get("authorization")?.split("Bearer ")?.[1];

    if (token !== "valid")
      return HttpResponse.json({ error: "Token expired" }, { status: 401 });
    return HttpResponse.json({ id: USER_ID }, { status: 200 });
  }),
  http.post(`${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}`, async () =>
    HttpResponse.json(authAccount, { status: 200 })
  ),
  http.delete(
    `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}/:userId`,
    async () => HttpResponse.json({}, { status: 200 })
  ),
];
