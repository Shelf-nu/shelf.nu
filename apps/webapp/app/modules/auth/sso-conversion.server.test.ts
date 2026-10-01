// @vitest-environment node
/**
 * Tests for the SSO account conversion engine: the admin-initiated conversion
 * (`convertAccountToSso`), Convert all (`convertAllEligibleOnDomain`), the
 * revert to a standard account (`revertAccountToStandard`), the callback merge
 * of a duplicate SSO auth user (`reconcileDuplicateSsoLogin`), and the
 * candidate listing (`findEligibleAccountsForSsoConversion`).
 *
 * @see {@link file://./sso-conversion.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the engine writes to the `auth` schema with raw SQL, which needs a real
// Supabase database. `$transaction` runs its callback against the same mock so
// raw writes inside the transaction land on `db.$executeRaw`, where the tests
// read the SQL text and bound values back.
vi.mock("~/database/db.server", () => {
  const db = {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    userOrganization: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return { db };
});

// why: getAuthUserById calls the Supabase admin API.
vi.mock("~/modules/auth/service.server", () => ({
  getAuthUserById: vi.fn(),
}));

// why: the domain to provider lookup reads auth.sso_domains; each test sets
// whether the domain is configured.
vi.mock("~/utils/sso.server", () => ({
  checkDomainSSOStatus: vi.fn(),
}));

import { db } from "~/database/db.server";
import { getAuthUserById } from "~/modules/auth/service.server";
import { checkDomainSSOStatus } from "~/utils/sso.server";
import {
  convertAccountToSso,
  convertAllEligibleOnDomain,
  findEligibleAccountsForSsoConversion,
  reconcileDuplicateSsoLogin,
  revertAccountToStandard,
} from "./sso-conversion.server";

const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const PROVIDER = `sso:${PROVIDER_ID}`;
const ORIGINAL_ID = "user-old-uuid";
const DUPLICATE_ID = "user-new-sso-uuid";

const baseUser = {
  id: ORIGINAL_ID,
  email: "Jane.Doe@Acme.com",
  sso: false,
};

const duplicateSession = {
  accessToken: "a",
  refreshToken: "r",
  userId: DUPLICATE_ID,
  email: "jane.doe@acme.com",
  expiresIn: 3600,
  expiresAt: 0,
};

/** The workspace whose SSO settings list the test domain. */
const LINKED_ORG_ID = "org-sso";

/** The organizations `checkDomainSSOStatus` reports as linked to a domain. */
type LinkedOrganizations = Awaited<
  ReturnType<typeof checkDomainSSOStatus>
>["linkedOrganizations"];

/**
 * Linked-organization rows for `checkDomainSSOStatus`. The engine reads only
 * their ids.
 */
function linkedOrgs(ids: string[]): LinkedOrganizations {
  return ids.map((id) => ({ id })) as unknown as LinkedOrganizations;
}

const existingSsoUser = {
  id: ORIGINAL_ID,
  email: "jane.doe@acme.com",
  sso: true,
};

/** One recorded `$executeRaw` tagged-template call, flattened for asserts. */
type RawCall = { sql: string; values: unknown[] };

/** Every `$executeRaw` call so far, as normalized SQL text plus bound values. */
function rawCalls(): RawCall[] {
  return vi.mocked(db.$executeRaw).mock.calls.map((call) => {
    const [strings, ...values] = call as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return { sql: strings.join("?").replace(/\s+/g, " ").trim(), values };
  });
}

/** Every `$queryRaw` call so far, as normalized SQL text plus bound values. */
function rawQueries(): RawCall[] {
  return vi.mocked(db.$queryRaw).mock.calls.map((call) => {
    const [strings, ...values] = call as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return { sql: strings.join("?").replace(/\s+/g, " ").trim(), values };
  });
}

/**
 * Makes the earlier-SSO-login lookup report `emails` (lowercased) as having
 * another SSO auth user.
 */
function earlierSsoLoginFor(emails: string[]) {
  vi.mocked(db.$queryRaw).mockResolvedValue(
    emails.map((email) => ({ email })) as unknown as Awaited<
      ReturnType<typeof db.$queryRaw>
    >
  );
}

/** The single raw call whose SQL contains `fragment`; fails if not exactly one. */
function rawCallMatching(fragment: string): RawCall {
  const matches = rawCalls().filter((c) => c.sql.includes(fragment));
  expect(matches).toHaveLength(1);
  return matches[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.$transaction).mockImplementation(((
    cb: (tx: typeof db) => unknown
  ) => cb(db)) as unknown as typeof db.$transaction);
  // clearAllMocks leaves mockResolvedValueOnce queues in place; reset them.
  vi.mocked(db.$executeRaw).mockReset();
  vi.mocked(db.$executeRaw).mockResolvedValue(1);
  vi.mocked(db.$queryRaw).mockReset();
  earlierSsoLoginFor([]);
  vi.mocked(db.user.findUnique).mockResolvedValue(
    baseUser as unknown as Awaited<ReturnType<typeof db.user.findUnique>>
  );
  vi.mocked(db.user.update).mockResolvedValue(
    {} as Awaited<ReturnType<typeof db.user.update>>
  );
  vi.mocked(db.organization.count).mockResolvedValue(0);
  vi.mocked(db.userOrganization.count).mockResolvedValue(0);
  vi.mocked(checkDomainSSOStatus).mockResolvedValue({
    isConfiguredForSSO: true,
    linkedOrganizations: linkedOrgs([LINKED_ORG_ID]),
    ssoProviderId: PROVIDER_ID,
  });
  vi.mocked(getAuthUserById).mockResolvedValue({
    id: ORIGINAL_ID,
    app_metadata: { provider: "email" },
  } as unknown as Awaited<ReturnType<typeof getAuthUserById>>);
});

describe("convertAccountToSso", () => {
  it("converts an eligible standard account and sets User.sso = true", async () => {
    const result = await convertAccountToSso({
      userId: ORIGINAL_ID,
      actorUserId: "admin-id",
    });

    expect(result).toEqual({
      userId: ORIGINAL_ID,
      email: baseUser.email,
      status: "converted",
      needsExtraSignIn: false,
    });
    const seal = rawCallMatching("UPDATE auth.users");
    expect(seal.sql).toContain("is_sso_user = true");
    expect(seal.sql).toContain("encrypted_password = NULL");
    expect(seal.values).toContain(ORIGINAL_ID);
    expect(rawCallMatching("DELETE FROM auth.identities").sql).toContain(
      "provider = 'email'"
    );
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: ORIGINAL_ID },
      data: { sso: true, onboarded: true },
    });
  });

  it("seeds the SSO identity with the lowercased email", async () => {
    await convertAccountToSso({ userId: ORIGINAL_ID });

    const insert = rawCallMatching("INSERT INTO auth.identities");
    expect(insert.sql).toContain(
      "ON CONFLICT (provider_id, provider) DO NOTHING"
    );
    // user_id, provider_id, provider, sub, email
    expect(insert.values).toEqual([
      ORIGINAL_ID,
      "jane.doe@acme.com",
      PROVIDER,
      "jane.doe@acme.com",
      "jane.doe@acme.com",
    ]);
  });

  it("looks up an earlier SSO login for this user only, by lowercased email", async () => {
    await convertAccountToSso({ userId: ORIGINAL_ID });

    const queries = rawQueries();
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("FROM auth.users");
    expect(queries[0].sql).toContain("is_sso_user = true");
    expect(queries[0].sql).toContain("lower(email) = ANY(");
    expect(queries[0].sql).toContain("id::text <> ALL(");
    expect(queries[0].values).toEqual([["jane.doe@acme.com"], [ORIGINAL_ID]]);
  });

  it("reports the extra sign-in when the user tried SSO before conversion", async () => {
    earlierSsoLoginFor(["jane.doe@acme.com"]);

    const result = await convertAccountToSso({ userId: ORIGINAL_ID });

    expect(result).toMatchObject({
      status: "converted",
      needsExtraSignIn: true,
    });
  });

  it("signs out the user's existing sessions", async () => {
    await convertAccountToSso({ userId: ORIGINAL_ID });

    const sessions = rawCallMatching("DELETE FROM auth.sessions");
    expect(sessions.values).toEqual([ORIGINAL_ID]);
  });

  it("is idempotent: skips a user who is already SSO", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      ...baseUser,
      sso: true,
    } as unknown as Awaited<ReturnType<typeof db.user.findUnique>>);

    const result = await convertAccountToSso({ userId: ORIGINAL_ID });

    expect(result.status).toBe("skipped_already_sso");
    expect(result.needsExtraSignIn).toBe(false);
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("converts an owner of the linked workspace", async () => {
    vi.mocked(db.organization.count).mockResolvedValue(1);

    const result = await convertAccountToSso({ userId: ORIGINAL_ID });

    expect(result.status).toBe("converted");
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: ORIGINAL_ID },
      data: { sso: true, onboarded: true },
    });
  });

  it("converts a user with an OWNER role on the linked workspace", async () => {
    vi.mocked(db.userOrganization.count).mockResolvedValue(1);

    const result = await convertAccountToSso({ userId: ORIGINAL_ID });

    expect(result.status).toBe("converted");
    rawCallMatching("UPDATE auth.users");
  });

  it("refuses when the domain is not configured for SSO", async () => {
    vi.mocked(checkDomainSSOStatus).mockResolvedValue({
      isConfiguredForSSO: false,
      linkedOrganizations: [],
      ssoProviderId: null,
    });

    await expect(convertAccountToSso({ userId: ORIGINAL_ID })).rejects.toThrow(
      /not configured for sso/i
    );
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("reconcileDuplicateSsoLogin", () => {
  it("moves the duplicate's identity onto the original and deletes only an SSO duplicate", async () => {
    await reconcileDuplicateSsoLogin({
      authSession: duplicateSession,
      existingUser: existingSsoUser,
    });

    const move = rawCallMatching("UPDATE auth.identities");
    expect(move.values).toEqual([ORIGINAL_ID, DUPLICATE_ID, PROVIDER]);

    const remove = rawCallMatching("DELETE FROM auth.users");
    expect(remove.sql).toContain("is_sso_user = true");
    expect(remove.sql).toContain("id <> ?::uuid");
    expect(remove.values).toEqual([DUPLICATE_ID, ORIGINAL_ID]);

    expect(rawCallMatching("DELETE FROM auth.sessions").values).toEqual([
      ORIGINAL_ID,
    ]);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: ORIGINAL_ID },
      data: { sso: true, onboarded: true },
    });
  });

  it("throws and deletes nothing when no identity row moved", async () => {
    vi.mocked(db.$executeRaw).mockResolvedValueOnce(0);

    await expect(
      reconcileDuplicateSsoLogin({
        authSession: duplicateSession,
        existingUser: existingSsoUser,
      })
    ).rejects.toThrow(/could not move the sso identity/i);

    expect(
      rawCalls().some((c) => c.sql.includes("DELETE FROM auth.users"))
    ).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("throws when the duplicate auth user was not deleted", async () => {
    // Identity move, seal update, email-identity delete, session delete, then
    // the guarded duplicate delete matches nothing.
    vi.mocked(db.$executeRaw)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await expect(
      reconcileDuplicateSsoLogin({
        authSession: duplicateSession,
        existingUser: existingSsoUser,
      })
    ).rejects.toThrow(/could not remove the duplicate/i);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses when the session belongs to the original account", async () => {
    await expect(
      reconcileDuplicateSsoLogin({
        authSession: { ...duplicateSession, userId: ORIGINAL_ID },
        existingUser: existingSsoUser,
      })
    ).rejects.toThrow(/same account/i);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("throws when the domain has no SSO provider", async () => {
    vi.mocked(checkDomainSSOStatus).mockResolvedValue({
      isConfiguredForSSO: false,
      linkedOrganizations: [],
      ssoProviderId: null,
    });

    await expect(
      reconcileDuplicateSsoLogin({
        authSession: duplicateSession,
        existingUser: existingSsoUser,
      })
    ).rejects.toThrow(/not configured for sso/i);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("findEligibleAccountsForSsoConversion", () => {
  it("matches the domain case-insensitively and flags linked-workspace owners in batch", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        id: "u1",
        email: "a@acme.com",
        firstName: "Ann",
        lastName: "Lee",
        displayName: "Annie",
        sso: false,
      },
      {
        id: "u2",
        email: "B@ACME.com",
        firstName: "Bo",
        lastName: "Kim",
        displayName: null,
        sso: true,
      },
      {
        id: "u3",
        email: "c@acme.com",
        firstName: null,
        lastName: null,
        displayName: null,
        sso: false,
      },
    ] as unknown as Awaited<ReturnType<typeof db.user.findMany>>);
    vi.mocked(db.organization.findMany).mockResolvedValue([
      { userId: "u1" },
    ] as unknown as Awaited<ReturnType<typeof db.organization.findMany>>);
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([
      { userId: "u3" },
    ] as unknown as Awaited<ReturnType<typeof db.userOrganization.findMany>>);

    const result = await findEligibleAccountsForSsoConversion("  ACME.com ");

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          email: { endsWith: "@acme.com", mode: "insensitive" },
        },
      })
    );
    expect(checkDomainSSOStatus).toHaveBeenCalledWith("@acme.com");
    // Both ownership queries are scoped to the domain's linked workspaces, so
    // owning any other workspace never marks a candidate.
    expect(db.organization.findMany).toHaveBeenCalledTimes(1);
    expect(db.organization.findMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ["u1", "u2", "u3"] },
        id: { in: [LINKED_ORG_ID] },
      },
      select: { userId: true },
    });
    expect(db.userOrganization.findMany).toHaveBeenCalledTimes(1);
    expect(db.userOrganization.findMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ["u1", "u2", "u3"] },
        roles: { has: "OWNER" },
        organizationId: { in: [LINKED_ORG_ID] },
      },
      select: { userId: true },
    });
    expect(result.map((r) => [r.id, r.ownsSsoWorkspace, r.alreadySso])).toEqual(
      [
        ["u1", true, false],
        ["u2", false, true],
        ["u3", true, false],
      ]
    );
    expect(result[0].displayName).toBe("Annie");
  });

  it("flags candidates whose email another SSO auth user holds, in one query", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        id: "u1",
        email: "A@acme.com",
        firstName: null,
        lastName: null,
        displayName: null,
        sso: false,
      },
      {
        id: "u2",
        email: "b@acme.com",
        firstName: null,
        lastName: null,
        displayName: null,
        sso: false,
      },
    ] as unknown as Awaited<ReturnType<typeof db.user.findMany>>);
    vi.mocked(db.organization.findMany).mockResolvedValue([]);
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([]);
    earlierSsoLoginFor(["a@acme.com"]);

    const result = await findEligibleAccountsForSsoConversion("acme.com");

    const queries = rawQueries();
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("is_sso_user = true");
    // The candidates' own auth rows are excluded by id.
    expect(queries[0].sql).toContain("id::text <> ALL(");
    expect(queries[0].values).toEqual([
      ["a@acme.com", "b@acme.com"],
      ["u1", "u2"],
    ]);
    expect(result.map((r) => [r.id, r.hasEarlierSsoLogin])).toEqual([
      ["u1", true],
      ["u2", false],
    ]);
  });

  it("marks no one as an owner when no workspace is linked to the domain", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        id: "u1",
        email: "a@acme.com",
        firstName: null,
        lastName: null,
        displayName: null,
        sso: false,
      },
    ] as unknown as Awaited<ReturnType<typeof db.user.findMany>>);
    vi.mocked(checkDomainSSOStatus).mockResolvedValue({
      isConfiguredForSSO: true,
      linkedOrganizations: [],
      ssoProviderId: PROVIDER_ID,
    });

    const result = await findEligibleAccountsForSsoConversion("acme.com");

    expect(result.map((r) => r.ownsSsoWorkspace)).toEqual([false]);
    expect(db.organization.findMany).not.toHaveBeenCalled();
    expect(db.userOrganization.findMany).not.toHaveBeenCalled();
  });

  it("skips the ownership queries when nothing matches", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    await expect(
      findEligibleAccountsForSsoConversion("acme.com")
    ).resolves.toEqual([]);
    expect(db.organization.findMany).not.toHaveBeenCalled();
    expect(db.userOrganization.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("convertAccountToSso when the SSO identity already exists", () => {
  it("still converts the account", async () => {
    // ON CONFLICT DO NOTHING: an identity already held (by this user on a
    // re-run, or by an SSO auth user from a sign-in before conversion) seeds
    // nothing. The callback's reconcile merges any duplicate at sign-in.
    vi.mocked(db.$executeRaw).mockImplementation(((
      strings: TemplateStringsArray
    ) =>
      Promise.resolve(
        strings.join("").includes("INSERT INTO auth.identities") ? 0 : 1
      )) as unknown as typeof db.$executeRaw);

    const result = await convertAccountToSso({ userId: ORIGINAL_ID });

    expect(result.status).toBe("converted");
    expect(rawCallMatching("INSERT INTO auth.identities").sql).toContain(
      "ON CONFLICT (provider_id, provider) DO NOTHING"
    );
    rawCallMatching("UPDATE auth.users");
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: ORIGINAL_ID },
      data: { sso: true, onboarded: true },
    });
  });
});

describe("convertAllEligibleOnDomain", () => {
  /** Candidate rows as `db.user.findMany` returns them for the listing. */
  const listed = [
    { id: "u-std-1", email: "one@acme.com", sso: false },
    { id: "u-owner", email: "owner@acme.com", sso: false },
    { id: "u-sso", email: "sso@acme.com", sso: true },
    { id: "u-std-2", email: "two@acme.com", sso: false },
    { id: "u-std-3", email: "three@acme.com", sso: false },
  ].map((u) => ({ ...u, firstName: null, lastName: null, displayName: null }));

  beforeEach(() => {
    vi.mocked(db.user.findMany).mockResolvedValue(
      listed as unknown as Awaited<ReturnType<typeof db.user.findMany>>
    );
    vi.mocked(db.organization.findMany).mockResolvedValue([
      { userId: "u-owner" },
    ] as unknown as Awaited<ReturnType<typeof db.organization.findMany>>);
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([]);
    // Each conversion re-reads its own user by id.
    vi.mocked(db.user.findUnique).mockImplementation(((args: {
      where: { id: string };
    }) => {
      const row = listed.find((u) => u.id === args.where.id);
      return Promise.resolve(
        row ? { id: row.id, email: row.email, sso: row.sso } : null
      );
    }) as unknown as typeof db.user.findUnique);
  });

  /** User ids whose SSO identity INSERT ran, in order. */
  function seededUserIds(): unknown[] {
    return rawCalls()
      .filter((c) => c.sql.includes("INSERT INTO auth.identities"))
      .map((c) => c.values[0]);
  }

  it("converts only standard non-owner accounts, one after another", async () => {
    const result = await convertAllEligibleOnDomain({
      domain: " ACME.com ",
      actorUserId: "admin-id",
    });

    expect(result).toEqual({ converted: 3, needsExtraSignIn: 0, failed: [] });
    expect(seededUserIds()).toEqual(["u-std-1", "u-std-2", "u-std-3"]);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          email: { endsWith: "@acme.com", mode: "insensitive" },
        },
      })
    );
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it("converts the owner of a workspace that is not linked to the domain", async () => {
    // "u-owner" owns a workspace of their own, not the one linked to the
    // domain, so the scoped ownership queries find nothing.
    vi.mocked(db.organization.findMany).mockResolvedValue([]);

    const result = await convertAllEligibleOnDomain({ domain: "acme.com" });

    expect(result).toEqual({ converted: 4, needsExtraSignIn: 0, failed: [] });
    expect(seededUserIds()).toEqual([
      "u-std-1",
      "u-owner",
      "u-std-2",
      "u-std-3",
    ]);
  });

  it("counts the converted accounts whose users tried SSO before conversion", async () => {
    earlierSsoLoginFor(["one@acme.com", "three@acme.com"]);

    const result = await convertAllEligibleOnDomain({ domain: "acme.com" });

    expect(result).toEqual({ converted: 3, needsExtraSignIn: 2, failed: [] });
  });

  it("keeps going after one account fails and reports it", async () => {
    vi.mocked(getAuthUserById).mockImplementation(((id: string) =>
      Promise.resolve(
        id === "u-std-2" ? null : { id, app_metadata: { provider: "email" } }
      )) as unknown as typeof getAuthUserById);

    const result = await convertAllEligibleOnDomain({ domain: "acme.com" });

    expect(result.converted).toBe(2);
    expect(result.failed).toEqual([
      {
        userId: "u-std-2",
        email: "two@acme.com",
        message: "No auth account found for this user.",
      },
    ]);
    expect(seededUserIds()).toEqual(["u-std-1", "u-std-3"]);
  });

  it("throws once, before touching any account, when the domain has no SSO provider", async () => {
    vi.mocked(checkDomainSSOStatus).mockResolvedValue({
      isConfiguredForSSO: false,
      linkedOrganizations: [],
      ssoProviderId: null,
    });

    await expect(
      convertAllEligibleOnDomain({ domain: "acme.com" })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/not configured for sso/i),
    });
    expect(checkDomainSSOStatus).toHaveBeenCalledTimes(1);
    expect(checkDomainSSOStatus).toHaveBeenCalledWith("@acme.com");
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("revertAccountToStandard", () => {
  beforeEach(() => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      ...baseUser,
      sso: true,
    } as unknown as Awaited<ReturnType<typeof db.user.findUnique>>);
  });

  it("refuses an account that is not SSO", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(
      baseUser as unknown as Awaited<ReturnType<typeof db.user.findUnique>>
    );

    await expect(
      revertAccountToStandard({ userId: ORIGINAL_ID })
    ).rejects.toMatchObject({
      status: 400,
      message: "This account is not an SSO account.",
    });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown user", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);

    await expect(
      revertAccountToStandard({ userId: ORIGINAL_ID })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a non-owner whose domain still uses SSO", async () => {
    await expect(
      revertAccountToStandard({ userId: ORIGINAL_ID })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/only an owner of the workspace/i),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses the owner of a workspace that is not linked to the SSO domain", async () => {
    // The user owns a workspace of their own; the ownership counts are scoped
    // to the linked workspace and find nothing.
    vi.mocked(db.organization.count).mockResolvedValue(0);
    vi.mocked(db.userOrganization.count).mockResolvedValue(0);

    await expect(
      revertAccountToStandard({ userId: ORIGINAL_ID })
    ).rejects.toMatchObject({ status: 400 });
    expect(db.organization.count).toHaveBeenCalledWith({
      where: { userId: ORIGINAL_ID, id: { in: [LINKED_ORG_ID] } },
    });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("refuses everyone when the SSO domain has no linked workspace", async () => {
    vi.mocked(checkDomainSSOStatus).mockResolvedValue({
      isConfiguredForSSO: true,
      linkedOrganizations: [],
      ssoProviderId: PROVIDER_ID,
    });
    vi.mocked(db.organization.count).mockResolvedValue(1);

    await expect(
      revertAccountToStandard({ userId: ORIGINAL_ID })
    ).rejects.toMatchObject({ status: 400 });
    expect(db.organization.count).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("reverts an owner of the linked workspace on an SSO domain", async () => {
    vi.mocked(db.organization.count).mockResolvedValue(1);

    const result = await revertAccountToStandard({
      userId: ORIGINAL_ID,
      actorUserId: "admin-id",
    });

    expect(result).toEqual({
      userId: ORIGINAL_ID,
      email: baseUser.email,
      status: "reverted",
    });

    const identityDelete = rawCallMatching("DELETE FROM auth.identities");
    expect(identityDelete.sql).toContain("provider LIKE 'sso:%'");
    expect(identityDelete.values).toEqual([ORIGINAL_ID]);

    const insert = rawCallMatching("INSERT INTO auth.identities");
    expect(insert.sql).toContain("'email'");
    expect(insert.sql).toContain("'email_verified', true");
    expect(insert.sql).toContain(
      "ON CONFLICT (provider_id, provider) DO NOTHING"
    );
    // user_id, provider_id, sub, email (lowercased)
    expect(insert.values).toEqual([
      ORIGINAL_ID,
      ORIGINAL_ID,
      ORIGINAL_ID,
      "jane.doe@acme.com",
    ]);

    const authUser = rawCallMatching("UPDATE auth.users");
    expect(authUser.sql).toContain("is_sso_user = false");
    expect(authUser.sql).toContain("'provider', 'email'");
    expect(authUser.sql).not.toContain("encrypted_password");
    expect(authUser.values).toEqual([ORIGINAL_ID]);

    expect(rawCallMatching("DELETE FROM auth.sessions").values).toEqual([
      ORIGINAL_ID,
    ]);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: ORIGINAL_ID },
      data: { sso: false },
    });
  });

  it("reverts a non-owner once the domain no longer uses SSO", async () => {
    vi.mocked(checkDomainSSOStatus).mockResolvedValue({
      isConfiguredForSSO: false,
      linkedOrganizations: [],
      ssoProviderId: null,
    });

    const result = await revertAccountToStandard({ userId: ORIGINAL_ID });

    expect(result.status).toBe("reverted");
    // The owner queries are not needed once the domain is off SSO.
    expect(db.organization.count).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: ORIGINAL_ID },
      data: { sso: false },
    });
  });

  it("returns 409 when another standard account already uses the email", async () => {
    vi.mocked(db.organization.count).mockResolvedValue(1);
    // Shape of the Prisma error a raw unique violation surfaces as.
    const uniqueViolation = Object.assign(
      new Error(
        'Raw query failed. Code: `23505`. Message: `ERROR: duplicate key value violates unique constraint "users_email_partial_key"`'
      ),
      { code: "P2010", meta: { code: "23505" } }
    );
    vi.mocked(db.$executeRaw).mockImplementation(((
      strings: TemplateStringsArray
    ) =>
      strings.join("").includes("UPDATE auth.users")
        ? Promise.reject(uniqueViolation)
        : Promise.resolve(1)) as unknown as typeof db.$executeRaw);

    await expect(
      revertAccountToStandard({ userId: ORIGINAL_ID })
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/another standard account/i),
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
