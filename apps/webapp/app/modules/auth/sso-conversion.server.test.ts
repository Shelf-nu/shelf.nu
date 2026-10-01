// @vitest-environment node
/**
 * Tests for the SSO account conversion engine: the admin-initiated conversion
 * (`convertAccountToSso`), the callback merge of a duplicate SSO auth user
 * (`reconcileDuplicateSsoLogin`), and the candidate listing
 * (`findEligibleAccountsForSsoConversion`).
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
  findEligibleAccountsForSsoConversion,
  reconcileDuplicateSsoLogin,
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
    linkedOrganizations: [],
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
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses to convert a workspace owner", async () => {
    vi.mocked(db.organization.count).mockResolvedValue(1);

    await expect(convertAccountToSso({ userId: ORIGINAL_ID })).rejects.toThrow(
      /owner/i
    );
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses an OWNER role on a team membership", async () => {
    vi.mocked(db.userOrganization.count).mockResolvedValue(1);

    await expect(convertAccountToSso({ userId: ORIGINAL_ID })).rejects.toThrow(
      /owner/i
    );
    expect(db.$executeRaw).not.toHaveBeenCalled();
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
  it("matches the domain case-insensitively and flags owners in batch", async () => {
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
    expect(db.organization.findMany).toHaveBeenCalledTimes(1);
    expect(db.userOrganization.findMany).toHaveBeenCalledTimes(1);
    expect(result.map((r) => [r.id, r.ownsTeamOrg, r.alreadySso])).toEqual([
      ["u1", true, false],
      ["u2", false, true],
      ["u3", true, false],
    ]);
    expect(result[0].displayName).toBe("Annie");
  });

  it("skips the ownership queries when nothing matches", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    await expect(
      findEligibleAccountsForSsoConversion("acme.com")
    ).resolves.toEqual([]);
    expect(db.organization.findMany).not.toHaveBeenCalled();
    expect(db.userOrganization.findMany).not.toHaveBeenCalled();
  });
});
