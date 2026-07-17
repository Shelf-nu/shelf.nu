// @vitest-environment node
import { OrganizationRoles } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { describe, expect, it, vi } from "vitest";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { bookingDraftVisibilityClause } from "~/modules/booking/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { transferEntitiesToNewOwner } from "./service.server";

// why: service.server.ts (user) imports `db` from `~/database/db.server` at
// module scope, and that module calls `createDatabaseClient()` +
// `db.$connect()` as a side effect of being imported. Neither
// transferEntitiesToNewOwner nor the pure predicates under test here touch
// `db` directly, so a stub keeps this suite off a real Prisma client.
vi.mock("~/database/db.server", () => ({
  db: {},
}));

const PAUL_ID = "paul";
const PAUL_TM = "paul-team-member";
const RECIPIENT_ID = "recipient";
const ORG = "org-1";

/** Shape of the in-memory rows this suite drives the real predicates over. */
interface FakeBookingRow {
  id: string;
  status: "RESERVED" | "DRAFT";
  organizationId: string;
  creatorId: string | null;
  custodianUserId: string | null;
  custodianTeamMemberId: string | null;
}

/**
 * Applies a Prisma-style `updateMany({ where, data })` call to an in-memory
 * row array — the minimal stand-in for what Postgres would do. A row only
 * gets `data` merged in when every key in `where` matches; calls issued for
 * other models (e.g. `Asset.userId`) simply never match a booking row shape.
 */
function applyUpdateMany(
  rows: FakeBookingRow[],
  call: { where: Record<string, unknown>; data: Record<string, unknown> }
) {
  for (const row of rows) {
    const matches = Object.entries(call.where).every(
      ([key, value]) =>
        (row as unknown as Record<string, unknown>)[key] === value
    );
    if (matches) {
      Object.assign(row, call.data);
    }
  }
}

/** Two fresh in-memory booking rows, both owned end-to-end by Paul. */
function makeRows(): FakeBookingRow[] {
  return [
    {
      id: "booking-reserved",
      status: "RESERVED",
      organizationId: ORG,
      creatorId: PAUL_ID,
      custodianUserId: PAUL_ID,
      custodianTeamMemberId: PAUL_TM,
    },
    {
      id: "booking-draft",
      status: "DRAFT",
      organizationId: ORG,
      creatorId: PAUL_ID,
      custodianUserId: PAUL_ID,
      custodianTeamMemberId: PAUL_TM,
    },
  ];
}

/**
 * Fake tx exposing every model method `transferEntitiesToNewOwner` calls,
 * each spied with `vi.fn()` so the calls it recorded can be replayed onto
 * the in-memory rows above.
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

function asTx(tx: MockTx) {
  return tx as unknown as Omit<ExtendedPrismaClient, ITXClientDenyList>;
}

/**
 * Runs `transferEntitiesToNewOwner` for the given `reason` and replays every
 * `updateMany` call it made across every model onto a fresh pair of rows
 * from {@link makeRows}, mirroring what those writes would do in Postgres.
 */
async function transferAndApply(reason: "demotion" | "removal") {
  const tx = createMockTx();

  await transferEntitiesToNewOwner({
    tx: asTx(tx),
    id: PAUL_ID,
    newOwnerId: RECIPIENT_ID,
    organizationId: ORG,
    reason,
  });

  const rows = makeRows();
  for (const model of Object.values(tx)) {
    for (const call of model.updateMany.mock.calls) {
      applyUpdateMany(rows, call[0]);
    }
  }
  return rows;
}

/**
 * Minimal evaluator for the exact `Prisma.BookingWhereInput` shape returned
 * by {@link bookingDraftVisibilityClause}:
 * `{ OR: [{ status: { not: "DRAFT" } }, { AND: [{ status: "DRAFT" }, { creatorId }] }] }`.
 * Not a general Prisma-where interpreter — scoped to this one predicate so
 * the test exercises the REAL clause instead of re-deriving its logic.
 */
function matchesDraftVisibility(
  row: Pick<FakeBookingRow, "status" | "creatorId">,
  clause: Prisma.BookingWhereInput
): boolean {
  const branches = clause.OR ?? [];
  return branches.some((branch) => {
    if (
      branch.status &&
      typeof branch.status === "object" &&
      "not" in branch.status
    ) {
      return row.status !== branch.status.not;
    }
    if (branch.AND) {
      const conditions = Array.isArray(branch.AND) ? branch.AND : [branch.AND];
      return conditions.every((cond) => {
        if (cond.status !== undefined) return row.status === cond.status;
        if (cond.creatorId !== undefined)
          return row.creatorId === cond.creatorId;
        return true;
      });
    }
    return false;
  });
}

describe("demotion preserves booking visibility (observable outcome)", () => {
  it("keeps the RESERVED booking's custodianUserId so it stays visible on the index and detail routes", async () => {
    const [reserved] = await transferAndApply("demotion");
    expect(reserved.custodianUserId).toBe(PAUL_ID);
  });

  it("keeps the DRAFT booking's creatorId so Paul's own draft-visibility clause still matches it (a custody-only fix fails this case)", async () => {
    const [, draft] = await transferAndApply("demotion");
    expect(
      matchesDraftVisibility(draft, bookingDraftVisibilityClause(PAUL_ID))
    ).toBe(true);
  });

  it("does not throw validateBookingOwnership for a demoted SELF_SERVICE Paul on either row, including checkCustodianOnly (PDF / .ics paths)", async () => {
    const [reserved, draft] = await transferAndApply("demotion");

    for (const booking of [reserved, draft]) {
      expect(() =>
        validateBookingOwnership({
          booking,
          userId: PAUL_ID,
          role: OrganizationRoles.SELF_SERVICE,
          action: "view",
        })
      ).not.toThrow();

      expect(() =>
        validateBookingOwnership({
          booking,
          userId: PAUL_ID,
          role: OrganizationRoles.SELF_SERVICE,
          action: "view",
          checkCustodianOnly: true,
        })
      ).not.toThrow();
    }
  });

  it("does not leak Paul's draft to the recipient", async () => {
    const [, draft] = await transferAndApply("demotion");
    expect(
      matchesDraftVisibility(draft, bookingDraftVisibilityClause(RECIPIENT_ID))
    ).toBe(false);
  });

  it("negative control: reason 'removal' on the same rows nulls the custodian and transfers the creator", async () => {
    const [reserved, draft] = await transferAndApply("removal");

    expect(reserved.custodianUserId).toBeNull();
    expect(reserved.creatorId).toBe(RECIPIENT_ID);
    expect(draft.custodianUserId).toBeNull();
    expect(draft.creatorId).toBe(RECIPIENT_ID);
  });
});
