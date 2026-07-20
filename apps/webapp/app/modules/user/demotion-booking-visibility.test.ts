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
 * Evaluates a booking `where` against one in-memory row, modelling the subset
 * of Prisma operators `transferEntitiesToNewOwner` actually emits: scalar
 * equality, an `AND` array of sub-clauses, and `{ not: value }` (including
 * `{ not: null }`).
 *
 * The combined `AND: [{ not: null }, { not: id }]` reproduces SQL's
 * `IS NOT NULL AND <> id`: a null value fails the `not: null` branch, so
 * null-custodian rows never match — which is the property that keeps a demoted
 * user's own drafts with them.
 */
function whereMatches(
  row: FakeBookingRow,
  where: Record<string, unknown>
): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") {
      const clauses = (Array.isArray(value) ? value : [value]) as Record<
        string,
        unknown
      >[];
      return clauses.every((clause) => whereMatches(row, clause));
    }
    if (value !== null && typeof value === "object" && "not" in value) {
      return (
        (row as unknown as Record<string, unknown>)[key] !==
        (value as { not: unknown }).not
      );
    }
    return (row as unknown as Record<string, unknown>)[key] === value;
  });
}

/**
 * Applies a Prisma-style `updateMany({ where, data })` call to an in-memory
 * row array — the minimal stand-in for what Postgres would do. A row only
 * gets `data` merged in when {@link whereMatches}; calls issued for other
 * models (e.g. `Asset.userId`) simply never match a booking row shape.
 */
function applyUpdateMany(
  rows: FakeBookingRow[],
  call: { where: Record<string, unknown>; data: Record<string, unknown> }
) {
  for (const row of rows) {
    if (whereMatches(row, call.where)) {
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
async function transferAndApply(
  reason: "demotion" | "removal",
  rows: FakeBookingRow[] = makeRows()
) {
  const tx = createMockTx();

  await transferEntitiesToNewOwner({
    tx: asTx(tx),
    id: PAUL_ID,
    newOwnerId: RECIPIENT_ID,
    organizationId: ORG,
    reason,
  });

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

  it("hands over a booking Paul created for a DIFFERENT custodian so he loses write access to it", async () => {
    const [createdForOther] = await transferAndApply("demotion", [
      {
        id: "booking-for-someone-else",
        status: "RESERVED",
        organizationId: ORG,
        creatorId: PAUL_ID,
        custodianUserId: "someone-else",
        custodianTeamMemberId: "someone-else-tm",
      },
    ]);

    expect(createdForOther.creatorId).toBe(RECIPIENT_ID);
  });

  it("keeps creatorId on Paul's unassigned draft (null custodian) — the null-safety case a blanket or null-inclusive transfer would break", async () => {
    const [ownDraft] = await transferAndApply("demotion", [
      {
        id: "booking-own-unassigned-draft",
        status: "DRAFT",
        organizationId: ORG,
        creatorId: PAUL_ID,
        custodianUserId: null,
        custodianTeamMemberId: null,
      },
    ]);

    // Still Paul's: creatorId is what keeps this draft visible to him and out
    // of the recipient's view.
    expect(ownDraft.creatorId).toBe(PAUL_ID);
    expect(
      matchesDraftVisibility(ownDraft, bookingDraftVisibilityClause(PAUL_ID))
    ).toBe(true);
    expect(
      matchesDraftVisibility(
        ownDraft,
        bookingDraftVisibilityClause(RECIPIENT_ID)
      )
    ).toBe(false);
  });
});
