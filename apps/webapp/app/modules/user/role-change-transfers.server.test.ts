/**
 * Role-change transfers and the non-registered-member boundary.
 *
 * `transferOnRoleChange` is the one path every role change uses to move a
 * member's entities. It must validate the recipient INSIDE the caller's
 * transaction and before any write, refuse a recipient whose role cannot
 * receive transfers or who is the member being changed, and move only bookings
 * created for a different REGISTERED custodian.
 *
 * @see {@link file://./service.server.ts} transferOnRoleChange
 */
import type { OrganizationRoles } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeBookingRow } from "@helpers/in-memory-booking-rows";
import { applyUpdateMany } from "@helpers/in-memory-booking-rows";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { transferOnRoleChange } from "./service.server";

// @vitest-environment node

// why: service.server imports the database client at module load; every write
// under test goes through the fake transaction below, never through `db`
vi.mock("~/database/db.server", () => ({ db: {} }));

const ORG = "org-1";
const TARGET = "demoted";
const OWNER = "owner";

/** A fake transaction exposing every delegate the transfer and the check use. */
function fakeTx(recipientRoles: Record<string, string[] | null>) {
  const model = () => ({ updateMany: vi.fn().mockResolvedValue({ count: 0 }) });
  return {
    userOrganization: {
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: { userId_organizationId: { userId: string } };
        }) => {
          const roles = recipientRoles[where.userId_organizationId.userId];
          return Promise.resolve(roles ? { roles } : null);
        }
      ),
    },
    asset: model(),
    category: model(),
    tag: model(),
    location: model(),
    customField: model(),
    invite: model(),
    booking: model(),
    image: model(),
    kit: model(),
    assetReminder: model(),
  };
}
type FakeTx = ReturnType<typeof fakeTx>;
const asTx = (tx: FakeTx) =>
  tx as unknown as Omit<ExtendedPrismaClient, ITXClientDenyList>;

/** Every `updateMany` the transaction received, across all models. */
function writes(tx: FakeTx) {
  return Object.entries(tx)
    .filter(([name]) => name !== "userOrganization")
    .flatMap(
      ([, delegate]) =>
        (delegate as unknown as { updateMany: ReturnType<typeof vi.fn> })
          .updateMany.mock.calls
    );
}

function run(
  tx: FakeTx,
  fromRoles: string[],
  toRole: "ADMIN" | "SELF_SERVICE" | "BASE",
  recipientId: string
) {
  return transferOnRoleChange({
    tx: asTx(tx),
    targetUserId: TARGET,
    organizationId: ORG,
    fromRoles: fromRoles as OrganizationRoles[],
    toRole,
    recipientId,
  });
}

describe("transferOnRoleChange", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses the member being changed as their own recipient, writing nothing", async () => {
    const tx = fakeTx({ [TARGET]: ["ADMIN"] });
    await expect(run(tx, ["ADMIN"], "BASE", TARGET)).rejects.toMatchObject({
      status: 400,
    });
    expect(writes(tx)).toEqual([]);
  });

  it("refuses a recipient whose role cannot receive transfers, writing nothing", async () => {
    const tx = fakeTx({ "base-user": ["BASE"] });
    await expect(
      run(tx, ["ADMIN"], "SELF_SERVICE", "base-user")
    ).rejects.toMatchObject({ status: 400 });
    expect(writes(tx)).toEqual([]);
  });

  it("refuses a recipient who is not a member of the workspace", async () => {
    const tx = fakeTx({});
    await expect(run(tx, ["ADMIN"], "BASE", "stranger")).rejects.toMatchObject({
      status: 400,
    });
    expect(writes(tx)).toEqual([]);
  });

  it("validates the recipient inside the transaction it was given", async () => {
    const tx = fakeTx({ [OWNER]: ["OWNER"] });
    await run(tx, ["ADMIN"], "BASE", OWNER);
    expect(tx.userOrganization.findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: OWNER, organizationId: ORG } },
      select: { roles: true },
    });
  });

  it("accepts a recipient holding an eligible role anywhere in a mixed membership", async () => {
    const tx = fakeTx({ "mixed-admin": ["SELF_SERVICE", "ADMIN"] });
    await expect(run(tx, ["ADMIN"], "BASE", "mixed-admin")).resolves.toEqual({
      ownership: true,
      bookingsCreatedForOthers: true,
    });
  });

  it("SELF_SERVICE -> BASE looks up no recipient and writes nothing", async () => {
    const tx = fakeTx({});
    await expect(run(tx, ["SELF_SERVICE"], "BASE", "anyone")).resolves.toEqual({
      ownership: false,
      bookingsCreatedForOthers: false,
    });
    expect(tx.userOrganization.findUnique).not.toHaveBeenCalled();
    expect(writes(tx)).toEqual([]);
  });

  it("moves bookings made for a registered custodian, keeps non-registered and own bookings", async () => {
    const tx = fakeTx({ [OWNER]: ["OWNER"] });
    await run(tx, ["ADMIN"], "SELF_SERVICE", OWNER);

    const rows: FakeBookingRow[] = [
      {
        id: "for-registered",
        status: "RESERVED",
        organizationId: ORG,
        creatorId: TARGET,
        custodianUserId: "someone",
        custodianTeamMemberId: "tm-someone",
      },
      {
        id: "for-nrm",
        status: "RESERVED",
        organizationId: ORG,
        creatorId: TARGET,
        custodianUserId: null,
        custodianTeamMemberId: "tm-nrm",
      },
      {
        id: "own",
        status: "RESERVED",
        organizationId: ORG,
        creatorId: TARGET,
        custodianUserId: TARGET,
        custodianTeamMemberId: "tm-self",
      },
    ];
    for (const call of tx.booking.updateMany.mock.calls)
      applyUpdateMany(rows, call[0]);

    expect(rows.map((r) => [r.id, r.creatorId])).toEqual([
      ["for-registered", OWNER],
      ["for-nrm", TARGET],
      ["own", TARGET],
    ]);
  });
});
