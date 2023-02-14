const { rest } = require("msw");

const { USER_EMAIL, USER_ID, USER_PASSWORD } = require("./user");

const supabaseAuthSession = {
  user: { id: USER_ID, email: USER_EMAIL },
  refresh_token: "valid",
  access_token: "valid",
  expires_in: -1,
};

const authSession = {
  refreshToken: "valid",
  accessToken: "valid",
  userId: USER_ID,
  email: USER_EMAIL,
  expiresIn: -1,
  expiresAt: -1,
};

const authAccount = {
  id: USER_ID,
  email: USER_EMAIL,
};

const SUPABASE_URL = "https://supabase-project.supabase.co";
const SUPABASE_AUTH_TOKEN_API = "/auth/v1/token";
const SUPABASE_AUTH_USER_API = "/auth/v1/user";
const SUPABASE_AUTH_ADMIN_USER_API = "/auth/v1/admin/users";

const handlers = [
  rest.post(
    `${SUPABASE_URL}${SUPABASE_AUTH_TOKEN_API}`,
    async (req, res, ctx) => {
      const { email, password, refresh_token } = await req.json();

      if (refresh_token) {
        if (refresh_token !== "valid")
          return res(ctx.status(401), ctx.json({ error: "Token expired" }));
        return res(ctx.status(200), ctx.json(supabaseAuthSession));
      }

      if (!email || !password || password !== USER_PASSWORD)
        return res(
          ctx.status(401),
          ctx.json({ message: "Wrong email or password" })
        );
      return res(ctx.status(200), ctx.json(supabaseAuthSession));
    }
  ),
  rest.get(
    `${SUPABASE_URL}${SUPABASE_AUTH_USER_API}`,
    async (req, res, ctx) => {
      const token = req.headers.get("authorization")?.split("Bearer ")?.[1];

      if (token !== "valid")
        return res(ctx.status(401), ctx.json({ error: "Token expired" }));
      return res(ctx.status(200), ctx.json({ id: USER_ID }));
    }
  ),
  rest.post(
    `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}`,
    async (req, res, ctx) => res(ctx.status(200), ctx.json(authAccount))
  ),
  rest.delete(
    `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}/*`,
    async (req, res, ctx) => res(ctx.status(200), ctx.json({}))
  ),
];

module.exports = {
  handlers,
  SUPABASE_URL,
  SUPABASE_AUTH_TOKEN_API,
  SUPABASE_AUTH_USER_API,
  SUPABASE_AUTH_ADMIN_USER_API,
  authAccount,
  authSession,
  supabaseAuthSession,
};
