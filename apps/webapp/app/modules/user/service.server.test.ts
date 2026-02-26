import { Roles, AssetIndexMode, OrganizationRoles } from "@prisma/client";

import { matchRequestUrl, rest } from "msw";
import { server } from "@mocks";
import {
  SUPABASE_URL,
  SUPABASE_AUTH_TOKEN_API,
  SUPABASE_AUTH_ADMIN_USER_API,
  authSession,
  authAccount,
} from "@mocks/handlers";
import {
  ORGANIZATION_ID,
  USER_EMAIL,
  USER_ID,
  USER_PASSWORD,
} from "@mocks/user";
import { db } from "~/database/db.server";

import { USER_WITH_SSO_DETAILS_SELECT } from "./fields";
import {
  createUserAccountForTesting,
  createUserOrAttachOrg,
  defaultUserCategories,
} from "./service.server";
import { defaultFields } from "../asset-index-settings/helpers";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: testing user account creation logic without executing actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest.fn().mockImplementation((callback) => callback(db)),
    $queryRaw: vitest.fn().mockResolvedValue([]),
    user: {
      create: vitest.fn().mockResolvedValue({}),
      findFirst: vitest.fn().mockResolvedValue(null),
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

// why: ensureAssetIndexModeForRole has its own db dependencies unrelated to user creation
vitest.mock("~/modules/asset-index-settings/service.server", () => ({
  ensureAssetIndexModeForRole: vitest.fn().mockResolvedValue(undefined),
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
              hasSequentialIdsMigrated: true, // New personal organizations don't need migration
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
              assetIndexSettings: {
                create: {
                  mode: AssetIndexMode.ADVANCED,
                  columns: defaultFields,
                  user: {
                    connect: {
                      id: USER_ID,
                    },
                  },
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
      select: {
        organizations: {
          select: { id: true },
        },
        ...USER_WITH_SSO_DETAILS_SELECT,
      },
    });
    expect(result).toEqual(authSession);
    expect(fetchAuthAdminUserAPI.size).toEqual(1);
    expect(fetchAuthTokenAPI.size).toEqual(1);
  });
});

const newUserMock = {
  id: USER_ID,
  email: USER_EMAIL,
  organizations: [{ id: ORGANIZATION_ID }],
};

/**
 * Tests for the invite acceptance flow in `createUserOrAttachOrg`.
 *
 * Covers the fallback logic that handles the "limbo" state: a user who signed
 * up but never confirmed their email has a Supabase auth account but no Prisma
 * User record. When they later accept a team invite, `createEmailAuthAccount`
 * fails (email exists), so we fall back to `confirmExistingAuthAccount` to
 * confirm the existing auth account and create the Prisma User.
 */
describe(createUserOrAttachOrg.name, () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // Default: no existing Prisma user, no existing auth user
    // @ts-expect-error missing vitest type
    db.user.findFirst.mockResolvedValue(null);
    // @ts-expect-error missing vitest type
    db.$queryRaw.mockResolvedValue([]);
    // @ts-expect-error missing vitest type
    db.user.create.mockResolvedValue(newUserMock);
    // @ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback: any) => callback(db));
  });

  afterEach(() => {
    server.events.removeAllListeners();
  });

  /** Happy path: brand-new user with no prior Supabase account */
  it("creates a new user when no Prisma user and no Supabase account exists", async () => {
    const result = await createUserOrAttachOrg({
      email: USER_EMAIL,
      organizationId: ORGANIZATION_ID,
      roles: [OrganizationRoles.BASE],
      password: USER_PASSWORD,
      firstName: "Test",
      createdWithInvite: true,
    });

    expect(result.id).toBe(USER_ID);
    expect(db.user.create).toHaveBeenCalled();
  });

  /** The "limbo" bug: unconfirmed Supabase account exists, no Prisma User */
  it("falls back to confirming existing auth account when createEmailAuthAccount fails", async () => {
    // Override: createEmailAuthAccount fails (email already in Supabase)
    server.use(
      rest.post(
        `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}`,
        async (_req, res, ctx) =>
          res.once(
            ctx.status(400),
            ctx.json({ message: "User already registered", status: 400 })
          )
      ),
      // confirmExistingAuthAccount calls updateUserById (PUT)
      rest.put(
        `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}/:id`,
        async (_req, res, ctx) =>
          res.once(ctx.status(200), ctx.json(authAccount))
      )
    );

    // confirmExistingAuthAccount queries auth.users to find existing account
    // @ts-expect-error missing vitest type
    db.$queryRaw.mockResolvedValueOnce([{ id: USER_ID }]);

    const result = await createUserOrAttachOrg({
      email: USER_EMAIL,
      organizationId: ORGANIZATION_ID,
      roles: [OrganizationRoles.BASE],
      password: USER_PASSWORD,
      firstName: "Test",
      createdWithInvite: true,
    });

    expect(result.id).toBe(USER_ID);
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.user.create).toHaveBeenCalled();
  });

  /** No auth account can be created or found — user gets a clear error */
  it("throws when both createEmailAuthAccount and confirmExistingAuthAccount fail", async () => {
    // createEmailAuthAccount fails
    server.use(
      rest.post(
        `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}`,
        async (_req, res, ctx) =>
          res.once(
            ctx.status(400),
            ctx.json({ message: "User already registered", status: 400 })
          )
      )
    );

    // confirmExistingAuthAccount finds no auth user → returns null
    // @ts-expect-error missing vitest type
    db.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      createUserOrAttachOrg({
        email: USER_EMAIL,
        organizationId: ORGANIZATION_ID,
        roles: [OrganizationRoles.BASE],
        password: USER_PASSWORD,
        firstName: "Test",
        createdWithInvite: true,
      })
    ).rejects.toThrow("We are facing some issue with your account");
  });

  /** Existing user accepting invite for a new org — no auth changes needed */
  it("attaches org to existing Prisma user without creating a new auth account", async () => {
    const existingUser = {
      id: USER_ID,
      email: USER_EMAIL,
      firstName: "Existing",
      lastName: "User",
      sso: false,
      userOrganizations: [],
    };

    // @ts-expect-error missing vitest type
    db.user.findFirst.mockResolvedValueOnce(existingUser);

    const result = await createUserOrAttachOrg({
      email: USER_EMAIL,
      organizationId: ORGANIZATION_ID,
      roles: [OrganizationRoles.BASE],
      password: USER_PASSWORD,
      firstName: "Existing",
      createdWithInvite: true,
    });

    expect(result.id).toBe(USER_ID);
    expect(db.userOrganization.upsert).toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });
});
