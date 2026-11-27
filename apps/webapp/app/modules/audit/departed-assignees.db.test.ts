// @vitest-environment node
/**
 * Removing a member from a workspace, and their audit assignments, against a
 * real database.
 *
 * The unit tests mock the transaction client, so they cannot show that the
 * row locks actually queue. These run `revokeAccessToOrganization` on real
 * rows, including while another transaction is assigning the same person.
 *
 * Needs a database with every migration applied, so it is skipped unless
 * `AUDIT_ASSIGNEES_TEST_DATABASE_URL` is set. It creates its own users and
 * workspace and deletes them at the end:
 *
 *   AUDIT_ASSIGNEES_TEST_DATABASE_URL="$DATABASE_URL" \
 *     pnpm webapp:test -- --run app/modules/audit/departed-assignees.db.test.ts
 *
 * @see {@link file://./departed-assignees.server.ts}
 * @see {@link file://../../utils/org-validation.server.ts} filterUsersInOrg
 */
import type { AuditStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Types only: the modules are imported inside `beforeAll`, once the database
// URL points at the real database.
import type * as DbModule from "~/database/db.server";
import type * as UserService from "~/modules/user/service.server";
import type * as OrgValidation from "~/utils/org-validation.server";

const DATABASE_URL = process.env.AUDIT_ASSIGNEES_TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)(
  "removing a member from their audits (real database)",
  () => {
    let db: typeof DbModule.db;
    let userService: typeof UserService;
    let orgValidation: typeof OrgValidation;

    const stamp = Date.now().toString(36);
    const userIds: string[] = [];
    let organizationId = "";
    let ownerId = "";

    async function createUser(key: string) {
      const user = await db.user.create({
        data: {
          email: `audit-assignees-${key}-${stamp}@example.com`,
          firstName: `ZZ ${key}`,
          lastName: "Test",
        },
      });
      userIds.push(user.id);
      return user.id;
    }

    /** A member with the BASE role in the test workspace. */
    async function createMember(key: string) {
      const userId = await createUser(key);
      await db.userOrganization.create({
        data: { userId, organizationId, roles: ["BASE"] },
      });
      return userId;
    }

    async function createAudit(status: AuditStatus, assigneeId?: string) {
      const audit = await db.auditSession.create({
        data: {
          name: `ZZ ${status} audit ${stamp}`,
          createdById: ownerId,
          organizationId,
          status,
        },
      });
      if (assigneeId) {
        await db.auditAssignment.create({
          data: { auditSessionId: audit.id, userId: assigneeId },
        });
      }
      return audit.id;
    }

    const assignedAuditIds = async (userId: string) =>
      (
        await db.auditAssignment.findMany({
          where: { userId, auditSession: { organizationId } },
          select: { auditSessionId: true },
        })
      ).map((row) => row.auditSessionId);

    beforeAll(async () => {
      // The test environment points Prisma at a placeholder; the client is
      // built on first import, so switch the URL before importing anything.
      process.env.DATABASE_URL = DATABASE_URL ?? "";
      process.env.DIRECT_URL = DATABASE_URL ?? "";
      delete (globalThis as { __db__?: unknown }).__db__;

      ({ db } = await import("~/database/db.server"));
      userService = await import("~/modules/user/service.server");
      orgValidation = await import("~/utils/org-validation.server");

      ownerId = await createUser("owner");
      const organization = await db.organization.create({
        data: {
          name: `ZZ Audit assignees ${stamp}`,
          userId: ownerId,
          type: "TEAM",
        },
      });
      organizationId = organization.id;
      await db.userOrganization.create({
        data: { userId: ownerId, organizationId, roles: ["OWNER"] },
      });
    }, 120_000);

    afterAll(async () => {
      if (!db) return;
      if (organizationId) {
        await db.organization.delete({ where: { id: organizationId } });
        await db.$executeRawUnsafe(
          `DROP SEQUENCE IF EXISTS "org_${organizationId}_asset_sequence"`
        );
      }
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.$disconnect();
    }, 120_000);

    it("takes the member off open audits and keeps finished ones", async () => {
      const memberId = await createMember("leaver");
      const pending = await createAudit("PENDING", memberId);
      const active = await createAudit("ACTIVE", memberId);
      const completed = await createAudit("COMPLETED", memberId);

      await userService.revokeAccessToOrganization({
        userId: memberId,
        organizationId,
        actorUserId: ownerId,
      });

      expect(await assignedAuditIds(memberId)).toEqual([completed]);

      const events = await db.activityEvent.findMany({
        where: {
          organizationId,
          action: "AUDIT_ASSIGNEE_REMOVED",
          targetUserId: memberId,
        },
        select: { auditSessionId: true, actorUserId: true },
      });
      expect(events.map((event) => event.auditSessionId).sort()).toEqual(
        [pending, active].sort()
      );
      expect(events.every((event) => event.actorUserId === ownerId)).toBe(true);

      const notes = await db.auditNote.findMany({
        where: { auditSessionId: { in: [pending, active, completed] } },
        select: { auditSessionId: true, content: true },
      });
      expect(notes.map((note) => note.auditSessionId).sort()).toEqual(
        [pending, active].sort()
      );
      expect(notes[0].content).toContain("removed from the workspace");
    });

    it("cleans up an assignment that was being written while the member was removed", async () => {
      const memberId = await createMember("racer");
      const audit = await createAudit("PENDING");

      let lockTaken!: () => void;
      const locked = new Promise<void>((resolve) => {
        lockTaken = resolve;
      });
      let releaseAssignment!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseAssignment = resolve;
      });

      // An audit create or edit: membership checked (and share-locked), then
      // the assignment written, in one transaction that is still open when
      // the removal starts.
      const assigning = db.$transaction(
        async (tx) => {
          const members = await orgValidation.filterUsersInOrg(
            { userIds: [memberId], organizationId },
            tx
          );
          lockTaken();
          await gate;
          await tx.auditAssignment.createMany({
            data: members.map((userId) => ({ auditSessionId: audit, userId })),
          });
        },
        { timeout: 15_000 }
      );

      await locked;
      let revoked = false;
      const revoking = userService
        .revokeAccessToOrganization({ userId: memberId, organizationId })
        .then(() => {
          revoked = true;
        });

      // The removal queues behind the assignment's share lock.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(revoked).toBe(false);

      releaseAssignment();
      await assigning;
      await revoking;

      // The assignment committed first, so the removal saw it and took it off.
      expect(await assignedAuditIds(memberId)).toEqual([]);
      expect(
        await db.userOrganization.findFirst({
          where: { userId: memberId, organizationId },
        })
      ).toBeNull();
    }, 30_000);

    it("refuses to assign a member whose removal is already under way", async () => {
      const memberId = await createMember("late");

      // The removal holds the membership lock (FOR UPDATE) until it commits.
      let releaseRemoval!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseRemoval = resolve;
      });
      let lockTaken!: () => void;
      const locked = new Promise<void>((resolve) => {
        lockTaken = resolve;
      });
      const removing = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "UserOrganization"
            WHERE "userId" = ${memberId} AND "organizationId" = ${organizationId}
            FOR UPDATE
          `;
          lockTaken();
          await gate;
          await tx.userOrganization.deleteMany({
            where: { userId: memberId, organizationId },
          });
        },
        { timeout: 15_000 }
      );

      await locked;
      const checking = db.$transaction((tx) =>
        orgValidation.filterUsersInOrg(
          { userIds: [memberId], organizationId },
          tx
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 500));
      releaseRemoval();
      await removing;

      // The check waited for the removal and then read the member as gone.
      await expect(checking).resolves.toEqual([]);
    }, 30_000);
  }
);
