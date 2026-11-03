/**
 * Organization Service — ownership transfer authorization
 *
 * Pins the authorization contract of {@link transferOwnership}: only the
 * workspace's current OWNER, or a Shelf platform admin, may transfer
 * ownership. A workspace ADMIN must not. The check compares the requesting
 * `userId` with the owner's id; ADMIN and OWNER share every permission, so no
 * role comparison can tell them apart.
 *
 * Also pins how each refusal surfaces: rule refusals are uncaptured 4xx the
 * admin can act on, while a workspace with no owner stays a captured 500.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../../routes/_layout+/settings.general.tsx}
 */

import { OrganizationRoles, OrganizationType, Roles } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOrganization,
  isSsoUser,
  transferOwnership,
} from "./service.server";

// @vitest-environment node

const ORG_ID = "org-1";
const OWNER_ID = "user-owner";
const ADMIN_ID = "user-admin";
const NEW_OWNER_ID = "user-new-owner";
const SHELF_ADMIN_ID = "user-shelf-admin";

type MockDb = {
  $transaction: <T>(callback: (tx: MockDb) => Promise<T>) => Promise<T>;
  user: {
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirstOrThrow: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $queryRaw: ReturnType<typeof vi.fn>;
  userOrganization: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  organization: {
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  image: { create: ReturnType<typeof vi.fn> };
};

const dbMock = vi.hoisted<MockDb>(() => ({
  $transaction: vi.fn(
    <T>(callback: (tx: MockDb) => Promise<T>): Promise<T> =>
      callback(dbMock as MockDb)
  ) as <T>(callback: (tx: MockDb) => Promise<T>) => Promise<T>,
  user: {
    findUniqueOrThrow: vi.fn(),
    findUnique: vi.fn(),
    // why: createOrganization reads the owner only to build the team member's
    // display name — not the behaviour under test, so it is stubbed to let the
    // logo path be reached.
    findFirstOrThrow: vi.fn(),
    // why: the only write that carries the spent free trial to the new owner,
    // so whether it ran is the assertion target of the free-trial tests.
    update: vi.fn(),
  },
  // why: transferOwnership locks both memberships with a raw
  // `SELECT ... FOR UPDATE` before re-reading them inside the transaction.
  $queryRaw: vi.fn().mockResolvedValue([]),
  userOrganization: {
    findMany: vi.fn(),
    // why: the locked re-read answers with the same membership rows the
    // test's earlier `findMany` returned, so the transfer sees no change in
    // between unless a test says otherwise.
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { userId_organizationId: { userId: string } };
      }) => {
        const results = dbMock.userOrganization.findMany.mock.results;
        const rows = (await results[results.length - 1]?.value) as
          | { roles: OrganizationRoles[]; user: { id: string } }[]
          | undefined;
        const row = rows?.find(
          (r) => r.user.id === where.userId_organizationId.userId
        );
        return row ? { roles: row.roles } : null;
      }
    ),
    update: vi.fn(),
  },
  organization: {
    update: vi.fn(),
    // why: this is the assertion target. Whether it was called is exactly what
    // distinguishes "validated before writing" from "left an orphan workspace".
    create: vi.fn(),
  },
  // why: the second write in the same flow, asserted both for the content type
  // it persists and for not running when validation refuses the bytes.
  image: { create: vi.fn() },
}));

// why: isolating database calls so the authorization branch can be unit tested
vi.mock("~/database/db.server", () => ({ db: dbMock }));

// why: ownership transfer sends notification emails as a side effect
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

const stripeMock = vi.hoisted(() => ({
  premiumIsEnabled: false,
  getUserActiveSubscription: vi.fn(),
}));

// why: premium/Stripe paths would otherwise require a full Stripe client. The
// getter lets one test switch billing on to reach the active-subscription
// refusal; every other test runs with it off.
vi.mock("~/utils/stripe.server", () => ({
  get premiumIsEnabled() {
    return stripeMock.premiumIsEnabled;
  },
  getUserActiveSubscription: stripeMock.getUserActiveSubscription,
  getUserActiveSubscriptions: vi.fn(),
  transferSubscriptionToCustomer: vi.fn(),
  createStripeCustomer: vi.fn(),
  customerHasPaymentMethod: vi.fn(),
}));

// why: tier writes are a subscription-transfer side effect, and these tests run
// with premiumIsEnabled false to assert only the authorization branch
vi.mock("../tier/service.server", () => ({
  updateUserTierId: vi.fn(),
  // why: createOrganization reads the owner's tier to seed its PDF documents.
  getUserTierLimit: vi
    .fn()
    .mockResolvedValue({ canCustomizePdfDocuments: false }),
}));

const currentOrganization = {
  id: ORG_ID,
  name: "Test Org",
  type: OrganizationType.TEAM,
};

/** Builds a UserOrganization row shaped like the service's `select` clause */
function userOrg(
  userId: string,
  roles: OrganizationRoles[],
  usedFreeTrial = false
) {
  return {
    id: `uo-${userId}`,
    user: {
      id: userId,
      firstName: "Test",
      lastName: "User",
      displayName: null,
      email: `${userId}@example.com`,
      roles: [],
      customerId: null,
      tierId: "free",
      usedFreeTrial,
    },
    roles,
  };
}

describe("transferOwnership authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (dbMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      <T>(callback: (tx: MockDb) => Promise<T>): Promise<T> => callback(dbMock)
    );

    // Default: the requesting user is NOT a Shelf platform admin
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: ADMIN_ID,
      roles: [],
    });

    // The service's findMany returns the org OWNER plus the new-owner candidate
    dbMock.userOrganization.findMany.mockResolvedValue([
      userOrg(OWNER_ID, [OrganizationRoles.OWNER]),
      userOrg(NEW_OWNER_ID, [OrganizationRoles.ADMIN]),
    ]);

    dbMock.userOrganization.update.mockResolvedValue({});
    dbMock.organization.update.mockResolvedValue({});
  });

  it("rejects a workspace ADMIN who is not the owner", async () => {
    await expect(
      transferOwnership({
        currentOrganization,
        newOwnerId: NEW_OWNER_ID,
        // The caller is a workspace ADMIN, not the OWNER
        userId: ADMIN_ID,
      })
    ).rejects.toThrow(/not the owner/i);

    // Nothing may be written when authorization fails
    expect(dbMock.organization.update).not.toHaveBeenCalled();
    expect(dbMock.userOrganization.update).not.toHaveBeenCalled();
  });

  it("allows the current OWNER to transfer ownership", async () => {
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: OWNER_ID,
      roles: [],
    });

    const { newOwner } = await transferOwnership({
      currentOrganization,
      newOwnerId: NEW_OWNER_ID,
      userId: OWNER_ID,
    });

    expect(newOwner.id).toBe(NEW_OWNER_ID);
    expect(dbMock.organization.update).toHaveBeenCalled();
  });

  it("allows a Shelf platform admin who is not an organization member", async () => {
    // Shelf admins act from the admin dashboard and are not org members, so
    // they never appear in the userOrganization rows.
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: SHELF_ADMIN_ID,
      roles: [{ name: Roles.ADMIN }],
    });

    const { newOwner } = await transferOwnership({
      currentOrganization,
      newOwnerId: NEW_OWNER_ID,
      userId: SHELF_ADMIN_ID,
    });

    expect(newOwner.id).toBe(NEW_OWNER_ID);
    expect(dbMock.organization.update).toHaveBeenCalled();
  });

  it("demotes the real outgoing owner, not the requesting Shelf admin", async () => {
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: SHELF_ADMIN_ID,
      roles: [{ name: Roles.ADMIN }],
    });

    await transferOwnership({
      currentOrganization,
      newOwnerId: NEW_OWNER_ID,
      userId: SHELF_ADMIN_ID,
    });

    // The row demoted to ADMIN must be the previous OWNER's row. This is what
    // breaks if `currentOwnerUserOrg` is repointed at the requesting user.
    expect(dbMock.userOrganization.update).toHaveBeenCalledWith({
      where: { id: `uo-${OWNER_ID}` },
      data: { roles: { set: [OrganizationRoles.ADMIN] } },
    });
  });
});

describe("transferOwnership refusals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stripeMock.premiumIsEnabled = false;

    (dbMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      <T>(callback: (tx: MockDb) => Promise<T>): Promise<T> => callback(dbMock)
    );
    // Default: the owner asks, and the candidate is an ADMIN member
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: OWNER_ID,
      roles: [],
    });
    dbMock.userOrganization.findMany.mockResolvedValue([
      userOrg(OWNER_ID, [OrganizationRoles.OWNER]),
      userOrg(NEW_OWNER_ID, [OrganizationRoles.ADMIN]),
    ]);
  });

  afterEach(() => {
    stripeMock.premiumIsEnabled = false;
  });

  /** A rule refusal: shown to the admin, not reported to Sentry */
  const refusal = (message: RegExp, status: number) =>
    expect.objectContaining({
      message: expect.stringMatching(message),
      status,
      shouldBeCaptured: false,
    });

  it("refuses a personal workspace as a 400", async () => {
    await expect(
      transferOwnership({
        currentOrganization: {
          ...currentOrganization,
          type: OrganizationType.PERSONAL,
        },
        newOwnerId: NEW_OWNER_ID,
        userId: OWNER_ID,
      })
    ).rejects.toEqual(refusal(/personal workspaces/i, 400));
  });

  it("refuses a requester who is not the owner as a 403", async () => {
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: ADMIN_ID,
      roles: [],
    });

    await expect(
      transferOwnership({
        currentOrganization,
        newOwnerId: NEW_OWNER_ID,
        userId: ADMIN_ID,
      })
    ).rejects.toEqual(refusal(/not the owner/i, 403));
  });

  it("refuses a new owner who is not a member as a 400", async () => {
    dbMock.userOrganization.findMany.mockResolvedValue([
      userOrg(OWNER_ID, [OrganizationRoles.OWNER]),
    ]);

    await expect(
      transferOwnership({
        currentOrganization,
        newOwnerId: NEW_OWNER_ID,
        userId: OWNER_ID,
      })
    ).rejects.toEqual(refusal(/not a member/i, 400));
  });

  it("refuses a new owner who is not an admin as a 400", async () => {
    dbMock.userOrganization.findMany.mockResolvedValue([
      userOrg(OWNER_ID, [OrganizationRoles.OWNER]),
      userOrg(NEW_OWNER_ID, [OrganizationRoles.BASE]),
    ]);

    await expect(
      transferOwnership({
        currentOrganization,
        newOwnerId: NEW_OWNER_ID,
        userId: OWNER_ID,
      })
    ).rejects.toEqual(refusal(/not an admin/i, 400));
  });

  it("refuses a new owner with an active subscription as a 400", async () => {
    stripeMock.premiumIsEnabled = true;
    stripeMock.getUserActiveSubscription.mockResolvedValue({ id: "sub_1" });

    await expect(
      transferOwnership({
        currentOrganization,
        newOwnerId: NEW_OWNER_ID,
        userId: OWNER_ID,
      })
    ).rejects.toEqual(refusal(/already has an active subscription/i, 400));
    expect(dbMock.organization.update).not.toHaveBeenCalled();
  });

  it("keeps a workspace with no owner a captured 500", async () => {
    // Broken data, not a user mistake: it must still reach Sentry.
    dbMock.userOrganization.findMany.mockResolvedValue([
      userOrg(NEW_OWNER_ID, [OrganizationRoles.ADMIN]),
    ]);

    await expect(
      transferOwnership({
        currentOrganization,
        newOwnerId: NEW_OWNER_ID,
        userId: OWNER_ID,
      })
    ).rejects.toEqual(
      expect.objectContaining({ status: 500, shouldBeCaptured: true })
    );
  });
});

/**
 * Ownership transfer carries the spent free trial to the new owner.
 *
 * A workspace whose plan has ended transfers no subscription, so a rule tied to
 * the subscription transfer never fires and leaves the new owner able to start
 * a second 7-day trial on a workspace that is already full of assets.
 *
 * These tests run with `premiumIsEnabled: false` (see the module mock above) to
 * pin that the flag is carried regardless of whether billing is switched on.
 */
describe("transferOwnership free trial flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (dbMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      <T>(callback: (tx: MockDb) => Promise<T>): Promise<T> => callback(dbMock)
    );

    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      id: OWNER_ID,
      roles: [],
    });
    dbMock.user.update.mockResolvedValue({ id: NEW_OWNER_ID });
    dbMock.userOrganization.update.mockResolvedValue({});
    dbMock.organization.update.mockResolvedValue({});
  });

  it("marks the new owner when no subscription moves with the workspace", async () => {
    dbMock.userOrganization.findMany.mockResolvedValue([
      userOrg(OWNER_ID, [OrganizationRoles.OWNER], true),
      userOrg(NEW_OWNER_ID, [OrganizationRoles.ADMIN], false),
    ]);

    await transferOwnership({
      currentOrganization,
      newOwnerId: NEW_OWNER_ID,
      userId: OWNER_ID,
      // The cancelled-plan case: the caller asks for no subscription transfer
      // because there is no live subscription left to carry.
      transferSubscription: false,
    });

    expect(dbMock.user.update).toHaveBeenCalledWith({
      where: { id: NEW_OWNER_ID },
      data: { usedFreeTrial: true },
      select: { id: true },
    });
  });

  it("leaves the new owner's trial alone when the outgoing owner never used one", async () => {
    dbMock.userOrganization.findMany.mockResolvedValue([
      userOrg(OWNER_ID, [OrganizationRoles.OWNER], false),
      userOrg(NEW_OWNER_ID, [OrganizationRoles.ADMIN], false),
    ]);

    await transferOwnership({
      currentOrganization,
      newOwnerId: NEW_OWNER_ID,
      userId: OWNER_ID,
    });

    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("does not write again when the new owner has already used their trial", async () => {
    dbMock.userOrganization.findMany.mockResolvedValue([
      userOrg(OWNER_ID, [OrganizationRoles.OWNER], true),
      userOrg(NEW_OWNER_ID, [OrganizationRoles.ADMIN], true),
    ]);

    await transferOwnership({
      currentOrganization,
      newOwnerId: NEW_OWNER_ID,
      userId: OWNER_ID,
    });

    expect(dbMock.user.update).not.toHaveBeenCalled();
  });
});

describe("isSsoUser", () => {
  /**
   * The SSO flag is carried on every membership, so it is usually read from the
   * list the caller already has. A user with no memberships has no row to read
   * it from, and that user — an SSO account with nowhere to land — is the one
   * the pending-assignment page exists for.
   */
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the flag from the memberships without another query", async () => {
    await expect(
      isSsoUser({
        userId: "user-1",
        userOrganizations: [{ user: { sso: true } }],
      })
    ).resolves.toBe(true);
    expect(dbMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("answers for an SSO user with no memberships at all", async () => {
    // why: the user row is the only place left to read the flag from.
    dbMock.user.findUnique.mockResolvedValue({ sso: true });

    await expect(
      isSsoUser({ userId: "user-1", userOrganizations: [] })
    ).resolves.toBe(true);
  });

  it("answers false for a password user with no memberships", async () => {
    // why: as above, for an account that does not use SSO.
    dbMock.user.findUnique.mockResolvedValue({ sso: false });

    await expect(
      isSsoUser({ userId: "user-1", userOrganizations: [] })
    ).resolves.toBe(false);
  });
});

/**
 * A workspace logo the caller claims is a PNG. `type` is the client's claim and
 * is deliberately not the thing under test — validation reads the bytes.
 */
function logoFile(bytes: BlobPart) {
  return new File([bytes], "logo.png", { type: "image/png" });
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const HTML_BYTES = "<script>alert(document.domain)</script>";

describe("createOrganization logo validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.user.findFirstOrThrow.mockResolvedValue({
      id: OWNER_ID,
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: null,
    });
    dbMock.organization.create.mockResolvedValue({ id: ORG_ID });
    dbMock.image.create.mockResolvedValue({ id: "image-1" });
  });

  const args = (image: File | null) => ({
    name: "Acme",
    userId: OWNER_ID,
    currency: "USD" as Parameters<typeof createOrganization>[0]["currency"],
    image,
  });

  it("does not create the workspace when the logo is not an image", async () => {
    await expect(
      createOrganization(args(logoFile(HTML_BYTES)))
    ).rejects.toThrow();

    // The workspace counts against the caller's plan limit the moment it is
    // written, so a rejected logo must not leave one behind.
    expect(dbMock.organization.create).not.toHaveBeenCalled();
    expect(dbMock.image.create).not.toHaveBeenCalled();
  });

  it("reports a rejected logo as user input rather than a server fault", async () => {
    await expect(
      createOrganization(args(logoFile(HTML_BYTES)))
    ).rejects.toMatchObject({ status: 400, shouldBeCaptured: false });
  });

  it("stores the format proved by the bytes for a valid logo", async () => {
    await createOrganization(args(logoFile(PNG_BYTES)));

    expect(dbMock.organization.create).toHaveBeenCalledOnce();
    expect(dbMock.image.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contentType: "image/png" }),
      })
    );
  });

  it("creates the workspace when no logo is supplied", async () => {
    await createOrganization(args(null));

    expect(dbMock.organization.create).toHaveBeenCalledOnce();
    expect(dbMock.image.create).not.toHaveBeenCalled();
  });
});
