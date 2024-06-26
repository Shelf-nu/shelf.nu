import { Roles } from "@prisma/client";
import { matchRequestUrl, rest } from "msw";

import { server } from "mocks";
import {
  SUPABASE_URL,
  SUPABASE_AUTH_TOKEN_API,
  SUPABASE_AUTH_ADMIN_USER_API,
  authSession,
} from "mocks/handlers";
import {
  ORGANIZATION_ID,
  USER_EMAIL,
  USER_ID,
  USER_PASSWORD,
} from "mocks/user";
import { db } from "~/database/db.server";

import { INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION } from "./fields";
import {
  createUserAccountForTesting,
  defaultUserCategories,
  // defaultUserCategories,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// mock db
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest.fn().mockImplementation((callback) => callback(db)),
    user: {
      create: vitest.fn().mockResolvedValue({}),
    },
    organization: {
      findFirst: vitest.fn().mockResolvedValue({
        id: ORGANIZATION_ID,
      }),
    },
    userOrganization: {
      upsert: vitest.fn().mockResolvedValue({}),
    },
  },
}));

const username = `test-user-${USER_ID}`;

describe(createUserAccountForTesting.name, () => {
  it("should return null if no auth account created", async () => {
    expect.assertions(3);
    const fetchAuthAdminUserAPI = new Map();
    server.events.on("request:start", (req) => {
      const matchesMethod = req.method === "POST";
      const matchesUrl = matchRequestUrl(
        req.url,
        SUPABASE_AUTH_ADMIN_USER_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl) fetchAuthAdminUserAPI.set(req.id, req);
    });
    // https://mswjs.io/docs/api/setup-server/use#one-time-override
    server.use(
      rest.post(
        `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}`,
        async (_req, res, ctx) =>
          res.once(
            ctx.status(400),
            ctx.json({ message: "create-account-error", status: 400 })
          )
      )
    );
    const result = await createUserAccountForTesting(
      USER_EMAIL,
      USER_PASSWORD,
      username
    );
    server.events.removeAllListeners();
    expect(result).toBeNull();
    expect(fetchAuthAdminUserAPI.size).toEqual(1);
    const [request] = fetchAuthAdminUserAPI.values();
    expect(request.body).toEqual({
      email: USER_EMAIL,
      password: USER_PASSWORD,
      email_confirm: true,
    });
  });
  it("should return null and delete auth account if unable to sign in", async () => {
    expect.assertions(5);
    const fetchAuthTokenAPI = new Map();
    const fetchAuthAdminUserAPI = new Map();
    server.events.on("request:start", (req) => {
      const matchesMethod = req.method === "POST";
      const matchesUrl = matchRequestUrl(
        req.url,
        SUPABASE_AUTH_TOKEN_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl) fetchAuthTokenAPI.set(req.id, req);
    });
    server.events.on("request:start", (req) => {
      const matchesMethod = req.method === "DELETE";
      const matchesUrl = matchRequestUrl(
        req.url,
        `${SUPABASE_AUTH_ADMIN_USER_API}/*`,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl) fetchAuthAdminUserAPI.set(req.id, req);
    });
    server.use(
      rest.post(
        `${SUPABASE_URL}${SUPABASE_AUTH_TOKEN_API}`,
        async (_req, res, ctx) =>
          res.once(
            ctx.status(400),
            ctx.json({ message: "sign-in-error", status: 400 })
          )
      )
    );
    const result = await createUserAccountForTesting(
      USER_EMAIL,
      USER_PASSWORD,
      username
    );
    server.events.removeAllListeners();
    expect(result).toBeNull();
    expect(fetchAuthTokenAPI.size).toEqual(1);
    const [signInRequest] = fetchAuthTokenAPI.values();
    expect(signInRequest.body).toEqual({
      email: USER_EMAIL,
      password: USER_PASSWORD,
      gotrue_meta_security: {},
    });
    expect(fetchAuthAdminUserAPI.size).toEqual(1);
    // expect call delete auth account with the expected user id
    const [authAdminUserReq] = fetchAuthAdminUserAPI.values();
    expect(authAdminUserReq.url.pathname).toEqual(
      `${SUPABASE_AUTH_ADMIN_USER_API}/${USER_ID}`
    );
  });
  it("should return null and delete auth account if unable to create user in database", async () => {
    expect.assertions(4);
    const fetchAuthTokenAPI = new Map();
    const fetchAuthAdminUserAPI = new Map();
    server.events.on("request:start", (req) => {
      const matchesMethod = req.method === "POST";
      const matchesUrl = matchRequestUrl(
        req.url,
        SUPABASE_AUTH_TOKEN_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl) fetchAuthTokenAPI.set(req.id, req);
    });
    server.events.on("request:start", (req) => {
      const matchesMethod = req.method === "DELETE";
      const matchesUrl = matchRequestUrl(
        req.url,
        `${SUPABASE_AUTH_ADMIN_USER_API}/*`,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl) fetchAuthAdminUserAPI.set(req.id, req);
    });
    //@ts-expect-error missing vitest type
    db.user.create.mockResolvedValue(null);
    const result = await createUserAccountForTesting(
      USER_EMAIL,
      USER_PASSWORD,
      username
    );
    server.events.removeAllListeners();
    expect(result).toBeNull();
    expect(fetchAuthTokenAPI.size).toEqual(1);
    expect(fetchAuthAdminUserAPI.size).toEqual(1);
    // expect call delete auth account with the expected user id
    const [authAdminUserReq] = fetchAuthAdminUserAPI.values();
    expect(authAdminUserReq.url.pathname).toEqual(
      `${SUPABASE_AUTH_ADMIN_USER_API}/${USER_ID}`
    );
  });
  it("should create an account", async () => {
    expect.assertions(4);
    const fetchAuthAdminUserAPI = new Map();
    const fetchAuthTokenAPI = new Map();
    server.events.on("request:start", (req) => {
      const matchesMethod = req.method === "POST";
      const matchesUrl = matchRequestUrl(
        req.url,
        SUPABASE_AUTH_ADMIN_USER_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl) fetchAuthAdminUserAPI.set(req.id, req);
    });
    server.events.on("request:start", (req) => {
      const matchesMethod = req.method === "POST";
      const matchesUrl = matchRequestUrl(
        req.url,
        SUPABASE_AUTH_TOKEN_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl) fetchAuthTokenAPI.set(req.id, req);
    });

    //@ts-expect-error missing vitest type
    db.user.create.mockResolvedValue({
      id: USER_ID,
      email: USER_EMAIL,
      username: username,
      organizations: [
        {
          id: "org-id",
        },
      ],
    });
    // mock db transaction passing the db instance
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementationOnce((callback) => callback(db));
    const result = await createUserAccountForTesting(
      USER_EMAIL,
      USER_PASSWORD,
      username
    );

    // we don't want to test the implementation of the function
    result!.expiresAt = -1;
    server.events.removeAllListeners();

    expect(db.user.create).toBeCalledWith({
      data: {
        email: USER_EMAIL,
        id: USER_ID,
        username: username,
        firstName: undefined,
        lastName: undefined,
        // After the last changes because of SSO we dont need this anymore
        organizations: {
          create: [
            {
              name: "Personal",
              categories: {
                create: defaultUserCategories.map((c) => ({
                  ...c,
                  userId: USER_ID,
                })),
              },
              members: {
                create: {
                  name: `${undefined} ${undefined} (Owner)`,
                  user: { connect: { id: USER_ID } },
                },
              },
            },
          ],
        },
        roles: {
          connect: {
            name: Roles["USER"],
          },
        },
      },
      include: {
        organizations: true,
        ...INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION,
      },
    });
    expect(result).toEqual(authSession);
    expect(fetchAuthAdminUserAPI.size).toEqual(1);
    expect(fetchAuthTokenAPI.size).toEqual(1);
  });
});
