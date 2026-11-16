// @vitest-environment node
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { describe, expect, it, vi } from "vitest";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { transferEntitiesToNewOwner } from "./service.server";

// why: service.server.ts imports `db` from `~/database/db.server` at module
// scope, and that module calls `createDatabaseClient()` + `db.$connect()` as
// a side effect of being imported (app/database/db.server.ts). The function
// under test only ever touches the `tx` param passed in by its caller, so a
// stub is enough to keep this suite off a real Prisma client.
vi.mock("~/database/db.server", () => ({
  db: {},
}));

const TARGET = "user-target";
const RECIPIENT = "user-recipient";
const ORG = "org-1";
/** A role change that moves both ownership and bookings created for others. */
const BOTH = { ownership: true, bookingsCreatedForOthers: true };

/**
 * Builds a fake transaction client exposing only the model methods
 * `transferEntitiesToNewOwner` calls, each spied with `vi.fn()` so a test
 * can assert on call shape without a real Prisma client.
 */
function createMockTx() {
  return {
    asset: { updateMany: vi.fn() },
    category: { updateMany: vi.fn() },
    tag: { updateMany: vi.fn() },
    location: { updateMany: vi.fn() },
    customField: { updateMany: vi.fn() },
    invite: { updateMany: vi.fn() },
    booking: { updateMany: vi.fn() },
    image: { updateMany: vi.fn() },
    kit: { updateMany: vi.fn() },
    assetReminder: { updateMany: vi.fn() },
  };
}

type MockTx = ReturnType<typeof createMockTx>;

/** Casts the fake tx to the type `transferEntitiesToNewOwner` requires. */
function asTx(tx: MockTx) {
  return tx as unknown as Omit<ExtendedPrismaClient, ITXClientDenyList>;
}

/**
 * Asserts the 8 OWNERSHIP rewrites (Asset/Category/Tag/Location/CustomField/
 * Image/Kit/AssetReminder) fired with the expected `where`/`data` shape.
 * They move on every removal, and on a role change when `moves.ownership`.
 */
function expectOwnershipTransferred(tx: MockTx) {
  expect(tx.asset.updateMany).toHaveBeenCalledWith({
    where: { userId: TARGET, organizationId: ORG },
    data: { userId: RECIPIENT },
  });
  expect(tx.category.updateMany).toHaveBeenCalledWith({
    where: { userId: TARGET, organizationId: ORG },
    data: { userId: RECIPIENT },
  });
  expect(tx.tag.updateMany).toHaveBeenCalledWith({
    where: { userId: TARGET, organizationId: ORG },
    data: { userId: RECIPIENT },
  });
  expect(tx.location.updateMany).toHaveBeenCalledWith({
    where: { userId: TARGET, organizationId: ORG },
    data: { userId: RECIPIENT },
  });
  expect(tx.customField.updateMany).toHaveBeenCalledWith({
    where: { userId: TARGET, organizationId: ORG },
    data: { userId: RECIPIENT },
  });
  expect(tx.image.updateMany).toHaveBeenCalledWith({
    // Image scopes on `ownerOrgId`, not `organizationId`.
    where: { userId: TARGET, ownerOrgId: ORG },
    data: { userId: RECIPIENT },
  });
  expect(tx.kit.updateMany).toHaveBeenCalledWith({
    where: { createdById: TARGET, organizationId: ORG },
    data: { createdById: RECIPIENT },
  });
  expect(tx.assetReminder.updateMany).toHaveBeenCalledWith({
    where: { createdById: TARGET, organizationId: ORG },
    data: { createdById: RECIPIENT },
  });
}

describe("transferEntitiesToNewOwner", () => {
  describe("reason: demotion", () => {
    it("never nulls the custodian on any booking.updateMany call", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "demotion",
        moves: BOTH,
      });

      for (const call of tx.booking.updateMany.mock.calls) {
        expect(call[0].data).not.toHaveProperty("custodianUserId");
      }
    });

    it("transfers creatorId ONLY for bookings whose custodian is a different registered user", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "demotion",
        moves: BOTH,
      });

      const creatorCalls = tx.booking.updateMany.mock.calls.filter((call) =>
        Object.prototype.hasOwnProperty.call(call[0].data, "creatorId")
      );

      // Exactly one creatorId transfer, and it is scoped to created-for-others.
      expect(creatorCalls).toHaveLength(1);
      expect(creatorCalls[0][0]).toEqual({
        where: {
          creatorId: TARGET,
          organizationId: ORG,
          AND: [
            { custodianUserId: { not: null } },
            { custodianUserId: { not: TARGET } },
          ],
        },
        data: { creatorId: RECIPIENT },
      });
    });

    it("never issues a blanket creatorId transfer that would sweep the user's own bookings", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "demotion",
        moves: BOTH,
      });

      // The `not: null` guard is load-bearing: without it, a null custodian
      // (the user's own unassigned draft, or a legacy team-member-link row)
      // would be transferred away, hiding it from them and leaking it to the
      // recipient — the exact failure a blanket `{ creatorId: id }` where, or a
      // null-inclusive `{ not: id }`, would cause. No creatorId transfer may
      // omit that guard.
      for (const call of tx.booking.updateMany.mock.calls) {
        if (!Object.prototype.hasOwnProperty.call(call[0].data, "creatorId")) {
          continue;
        }
        expect(call[0].where.AND).toContainEqual({
          custodianUserId: { not: null },
        });
      }
    });

    it("leaves invites untouched", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "demotion",
        moves: BOTH,
      });

      expect(tx.invite.updateMany).not.toHaveBeenCalled();
    });

    it("still transfers all ownership columns", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "demotion",
        moves: BOTH,
      });

      expectOwnershipTransferred(tx);
    });
  });

  describe("reason: demotion, moving one group only", () => {
    it("moves ownership without touching bookings when only ownership moves", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "demotion",
        moves: { ownership: true, bookingsCreatedForOthers: false },
      });

      expectOwnershipTransferred(tx);
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it("moves only bookings created for others when ownership stays", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "demotion",
        moves: { ownership: false, bookingsCreatedForOthers: true },
      });

      expect(tx.booking.updateMany).toHaveBeenCalledTimes(1);
      for (const model of [
        tx.asset,
        tx.category,
        tx.tag,
        tx.location,
        tx.customField,
        tx.image,
        tx.kit,
        tx.assetReminder,
        tx.invite,
      ]) {
        expect(model.updateMany).not.toHaveBeenCalled();
      }
    });
  });

  describe("reason: removal", () => {
    it("transfers the creator", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "removal",
      });

      expect(tx.booking.updateMany).toHaveBeenCalledWith({
        where: { creatorId: TARGET, organizationId: ORG },
        data: { creatorId: RECIPIENT },
      });
    });

    it("nulls the custodian", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "removal",
      });

      expect(tx.booking.updateMany).toHaveBeenCalledWith({
        where: { custodianUserId: TARGET, organizationId: ORG },
        data: { custodianUserId: null },
      });
    });

    it("transfers invites", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "removal",
      });

      expect(tx.invite.updateMany).toHaveBeenCalledWith({
        where: { inviterId: TARGET, organizationId: ORG },
        data: { inviterId: RECIPIENT },
      });
    });

    it("still transfers all ownership columns", async () => {
      const tx = createMockTx();

      await transferEntitiesToNewOwner({
        tx: asTx(tx),
        id: TARGET,
        newOwnerId: RECIPIENT,
        organizationId: ORG,
        reason: "removal",
      });

      expectOwnershipTransferred(tx);
    });
  });
});
