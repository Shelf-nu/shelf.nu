import { OrganizationRoles } from "@shelf/database";

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
import { create, findFirst, upsert } from "~/database/query-helpers.server";

import {
  createUserAccountForTesting,
  createUserOrAttachOrg,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: stub db object so service.server.ts can pass it to query helpers
vitest.mock("~/database/db.server", () => ({
  db: {
    rpc: vitest.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

// why: auto-mock query helpers so we can control return values per test
vitest.mock("~/database/query-helpers.server");

// why: ensureAssetIndexModeForRole has its own db dependencies unrelated to user creation
vitest.mock("~/modules/asset-index-settings/service.server", () => ({
  ensureAssetIndexModeForRole: vitest.fn().mockResolvedValue(undefined),
}));

const username = `test-user-${USER_ID}`;

describe(createUserAccountForTesting.name, () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // Default: create returns a user-like object
    vi.mocked(create).mockResolvedValue({} as any);
    vi.mocked(findFirst).mockResolvedValue(null as any);
  });

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
    vi.mocked(create).mockRejectedValueOnce(new Error("DB error"));
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
    expect.assertions(3);
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

    const createdUser = {
      id: USER_ID,
      email: USER_EMAIL,
      username: username,
    };
    vi.mocked(create).mockResolvedValue(createdUser as any);

    const result = await createUserAccountForTesting(
      USER_EMAIL,
      USER_PASSWORD,
      username
    );

    // we don't want to test the implementation of the function
    result!.expiresAt = -1;
    server.events.removeAllListeners();

    expect(create).toHaveBeenCalledWith(
      db,
      "User",
      expect.objectContaining({
        email: USER_EMAIL,
        id: USER_ID,
        username: username,
      })
    );
    expect(result).toEqual(authSession);
    expect(fetchAuthAdminUserAPI.size).toEqual(1);
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
    // Default: no existing user, create returns new user
    vi.mocked(findFirst).mockResolvedValue(null as any);
    vi.mocked(create).mockResolvedValue(newUserMock as any);
    // Default: db.rpc returns no auth users
    vi.mocked(db.rpc as any).mockResolvedValue({ data: [], error: null });
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
    expect(create).toHaveBeenCalled();
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

    // confirmExistingAuthAccount calls db.rpc to find existing auth account
    vi.mocked(db.rpc as any).mockResolvedValueOnce({
      data: [{ id: USER_ID }],
      error: null,
    });

    const result = await createUserOrAttachOrg({
      email: USER_EMAIL,
      organizationId: ORGANIZATION_ID,
      roles: [OrganizationRoles.BASE],
      password: USER_PASSWORD,
      firstName: "Test",
      createdWithInvite: true,
    });

    expect(result.id).toBe(USER_ID);
    expect(db.rpc).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
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
    vi.mocked(db.rpc as any).mockResolvedValueOnce({
      data: [],
      error: null,
    });

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

    vi.mocked(findFirst).mockResolvedValueOnce(existingUser as any);

    const result = await createUserOrAttachOrg({
      email: USER_EMAIL,
      organizationId: ORGANIZATION_ID,
      roles: [OrganizationRoles.BASE],
      password: USER_PASSWORD,
      firstName: "Existing",
      createdWithInvite: true,
    });

    expect(result.id).toBe(USER_ID);
    expect(upsert).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
