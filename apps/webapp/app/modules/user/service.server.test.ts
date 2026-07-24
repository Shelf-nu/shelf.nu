import { Roles, AssetIndexMode, OrganizationRoles } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

import { matchRequestUrl, http, HttpResponse } from "msw";
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
  createUser,
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
      findUnique: vitest.fn().mockResolvedValue(null),
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
    server.events.on("request:start", ({ request, requestId }) => {
      const matchesMethod = request.method === "POST";
      const matchesUrl = matchRequestUrl(
        new URL(request.url),
        SUPABASE_AUTH_ADMIN_USER_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl)
        fetchAuthAdminUserAPI.set(requestId, request.clone());
    });
    // https://mswjs.io/docs/api/setup-server/use#one-time-override
    server.use(
      http.post(
        `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}`,
        () =>
          HttpResponse.json(
            { message: "create-account-error", status: 400 },
            { status: 400 }
          ),
        { once: true }
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
    expect(await request.json()).toEqual({
      email: USER_EMAIL,
      password: USER_PASSWORD,
      email_confirm: true,
    });
  });
  it("should return null and delete auth account if unable to sign in", async () => {
    expect.assertions(5);
    const fetchAuthTokenAPI = new Map();
    const fetchAuthAdminUserAPI = new Map();
    server.events.on("request:start", ({ request, requestId }) => {
      const matchesMethod = request.method === "POST";
      const matchesUrl = matchRequestUrl(
        new URL(request.url),
        SUPABASE_AUTH_TOKEN_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl)
        fetchAuthTokenAPI.set(requestId, request.clone());
    });
    server.events.on("request:start", ({ request, requestId }) => {
      const matchesMethod = request.method === "DELETE";
      const matchesUrl = matchRequestUrl(
        new URL(request.url),
        `${SUPABASE_AUTH_ADMIN_USER_API}/:userId`,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl)
        fetchAuthAdminUserAPI.set(requestId, request.clone());
    });
    server.use(
      http.post(
        `${SUPABASE_URL}${SUPABASE_AUTH_TOKEN_API}`,
        () =>
          HttpResponse.json(
            { message: "sign-in-error", status: 400 },
            { status: 400 }
          ),
        { once: true }
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
    expect(await signInRequest.json()).toEqual({
      email: USER_EMAIL,
      password: USER_PASSWORD,
      gotrue_meta_security: {},
    });
    expect(fetchAuthAdminUserAPI.size).toEqual(1);
    // expect call delete auth account with the expected user id
    const [authAdminUserReq] = fetchAuthAdminUserAPI.values();
    expect(new URL(authAdminUserReq.url).pathname).toEqual(
      `${SUPABASE_AUTH_ADMIN_USER_API}/${USER_ID}`
    );
  });
  it("should return null and delete auth account if unable to create user in database", async () => {
    expect.assertions(4);
    const fetchAuthTokenAPI = new Map();
    const fetchAuthAdminUserAPI = new Map();
    server.events.on("request:start", ({ request, requestId }) => {
      const matchesMethod = request.method === "POST";
      const matchesUrl = matchRequestUrl(
        new URL(request.url),
        SUPABASE_AUTH_TOKEN_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl)
        fetchAuthTokenAPI.set(requestId, request.clone());
    });
    server.events.on("request:start", ({ request, requestId }) => {
      const matchesMethod = request.method === "DELETE";
      const matchesUrl = matchRequestUrl(
        new URL(request.url),
        `${SUPABASE_AUTH_ADMIN_USER_API}/:userId`,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl)
        fetchAuthAdminUserAPI.set(requestId, request.clone());
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
    expect(new URL(authAdminUserReq.url).pathname).toEqual(
      `${SUPABASE_AUTH_ADMIN_USER_API}/${USER_ID}`
    );
  });
  it("should create an account", async () => {
    expect.assertions(4);
    const fetchAuthAdminUserAPI = new Map();
    const fetchAuthTokenAPI = new Map();
    server.events.on("request:start", ({ request, requestId }) => {
      const matchesMethod = request.method === "POST";
      const matchesUrl = matchRequestUrl(
        new URL(request.url),
        SUPABASE_AUTH_ADMIN_USER_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl)
        fetchAuthAdminUserAPI.set(requestId, request.clone());
    });
    server.events.on("request:start", ({ request, requestId }) => {
      const matchesMethod = request.method === "POST";
      const matchesUrl = matchRequestUrl(
        new URL(request.url),
        SUPABASE_AUTH_TOKEN_API,
        SUPABASE_URL
      ).matches;
      if (matchesMethod && matchesUrl)
        fetchAuthTokenAPI.set(requestId, request.clone());
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
        createdWithInvite: undefined,
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
                  name: "(Owner)",
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
      http.post(
        `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}`,
        () =>
          HttpResponse.json(
            { message: "User already registered", status: 400 },
            { status: 400 }
          ),
        { once: true }
      ),
      // confirmExistingAuthAccount calls updateUserById (PUT)
      http.put(
        `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}/:id`,
        () => HttpResponse.json(authAccount, { status: 200 }),
        { once: true }
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
      http.post(
        `${SUPABASE_URL}${SUPABASE_AUTH_ADMIN_USER_API}`,
        () =>
          HttpResponse.json(
            { message: "User already registered", status: 400 },
            { status: 400 }
          ),
        { once: true }
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

/**
 * Tests for `createUser` idempotency on the primary key (SHELF-WEBAPP-1EA).
 *
 * When `user.create` hits a P2002 unique-constraint violation on `id`, a `User`
 * row already exists for this Supabase auth id (re-signup / partial signup).
 * Because the create + all side-effects run in one `$transaction`, the P2002
 * rolls everything back, so returning the pre-existing row is safe and does not
 * duplicate any side-effects.
 */
describe(createUser.name, () => {
  /** Prisma payload shape the transaction's create returns (subset used here). */
  const existingUser = {
    id: USER_ID,
    email: USER_EMAIL,
    organizations: [{ id: ORGANIZATION_ID }],
  };

  beforeEach(() => {
    vitest.clearAllMocks();
    // why: the mocked $transaction just invokes the callback with the mocked db,
    // so the callback's `tx.user.create` resolves to whatever db.user.create does
    // @ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback: any) => callback(db));
  });

  it("returns the existing user when create throws a P2002 unique violation on id", async () => {
    // why: simulate Prisma raising a primary-key unique violation (id already
    // has a User row) so the create inside the transaction rejects with P2002
    const p2002 = new PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`id`)",
      { code: "P2002", clientVersion: "test", meta: { target: ["id"] } }
    );
    // @ts-expect-error missing vitest type
    db.user.create.mockRejectedValueOnce(p2002);
    // @ts-expect-error missing vitest type
    db.user.findUnique.mockResolvedValueOnce(existingUser);

    const result = await createUser({
      email: USER_EMAIL,
      userId: USER_ID,
      username,
    });

    expect(result).toEqual(existingUser);
    // Looks the row up by id, not by any other field
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: expect.objectContaining({
        organizations: { select: { id: true } },
      }),
    });
    // No duplicate side-effects: nothing was re-created
    expect(db.userOrganization.upsert).not.toHaveBeenCalled();
  });

  it("reconciles the org association when an invite/SSO caller races a P2002 and the existing user is not yet a member", async () => {
    // why: the create + org association run in one rolled-back transaction, so a
    // concurrent P2002 race returns the existing user WITHOUT the requested org.
    // The recovery path must re-attach it (SHELF-WEBAPP-1EA follow-up).
    const NEW_ORG_ID = "org-the-user-is-not-in-yet";
    // Fresh object per test: the recovery path mutates `organizations` via push.
    const userMissingOrg = {
      id: USER_ID,
      email: USER_EMAIL,
      organizations: [] as { id: string }[],
    };
    const p2002 = new PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`id`)",
      { code: "P2002", clientVersion: "test", meta: { target: ["id"] } }
    );
    // @ts-expect-error missing vitest type
    db.user.create.mockRejectedValueOnce(p2002);
    // @ts-expect-error missing vitest type
    db.user.findUnique.mockResolvedValueOnce(userMissingOrg);

    const result = await createUser({
      email: USER_EMAIL,
      userId: USER_ID,
      username,
      organizationId: NEW_ORG_ID,
      roles: [OrganizationRoles.ADMIN],
    });

    // Re-attaches the existing user to the requested org idempotently
    expect(db.userOrganization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_organizationId: {
            userId: USER_ID,
            organizationId: NEW_ORG_ID,
          },
        },
      })
    );
    // Still returns the pre-existing user, now carrying the reconciled org
    expect(result).toBe(userMissingOrg);
    expect(result.organizations).toContainEqual({ id: NEW_ORG_ID });
  });

  it("does NOT re-attach the org when the racing user is already a member", async () => {
    // why: re-attaching an existing membership would re-push roles via the
    // upsert's `push` update branch — the membership check must short-circuit.
    const userAlreadyMember = {
      id: USER_ID,
      email: USER_EMAIL,
      organizations: [{ id: ORGANIZATION_ID }],
    };
    const p2002 = new PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`id`)",
      { code: "P2002", clientVersion: "test", meta: { target: ["id"] } }
    );
    // @ts-expect-error missing vitest type
    db.user.create.mockRejectedValueOnce(p2002);
    // @ts-expect-error missing vitest type
    db.user.findUnique.mockResolvedValueOnce(userAlreadyMember);

    const result = await createUser({
      email: USER_EMAIL,
      userId: USER_ID,
      username,
      organizationId: ORGANIZATION_ID,
      roles: [OrganizationRoles.ADMIN],
    });

    expect(result).toBe(userAlreadyMember);
    expect(db.userOrganization.upsert).not.toHaveBeenCalled();
  });

  it("throws when P2002 has no matching row for this id (conflict on another unique field)", async () => {
    // why: a P2002 on e.g. `email` with no row for this id is a genuine conflict
    const p2002 = new PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      { code: "P2002", clientVersion: "test", meta: { target: ["email"] } }
    );
    // @ts-expect-error missing vitest type
    db.user.create.mockRejectedValueOnce(p2002);
    // @ts-expect-error missing vitest type
    db.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      createUser({ email: USER_EMAIL, userId: USER_ID, username })
    ).rejects.toThrow("We had trouble while creating your account");
  });

  it("throws when create fails with a non-P2002 error", async () => {
    // why: a generic DB failure must still surface as a ShelfError, not silently
    // resolve — and must not attempt the idempotent lookup
    // @ts-expect-error missing vitest type
    db.user.create.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      createUser({ email: USER_EMAIL, userId: USER_ID, username })
    ).rejects.toThrow("We had trouble while creating your account");
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
