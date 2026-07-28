import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import {
  createDefaultWorkingHours,
  getDefaultWeeklySchedule,
  getWorkingHoursForOrganization,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: testing working-hours service logic without executing actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    workingHours: {
      findUnique: vitest.fn(),
      upsert: vitest.fn(),
      findUniqueOrThrow: vitest.fn(),
    },
  },
}));

const mockOrganizationId = "org-1";

const mockWorkingHoursData = {
  id: "working-hours-1",
  enabled: true,
  weeklySchedule: getDefaultWeeklySchedule(),
  organizationId: mockOrganizationId,
  overrides: [],
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

/** The include the cold path uses both for the upsert and the P2002 re-read. */
const OVERRIDES_INCLUDE = { overrides: { orderBy: { date: "asc" } } };

/** The exact guarded upsert args the cold path / helper must pass. */
const EXPECTED_UPSERT_ARGS = {
  where: { organizationId: mockOrganizationId },
  update: {},
  create: {
    organizationId: mockOrganizationId,
    enabled: false,
    weeklySchedule: getDefaultWeeklySchedule(),
  },
  include: OVERRIDES_INCLUDE,
};

/** Builds a P2002 unique-constraint error the way Prisma raises one. */
function p2002Error() {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
  });
}

describe("getWorkingHoursForOrganization", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // why: default the read-first lookup to "not found" so the cold-path tests
    // don't have to restate it; the existing-row test overrides this.
    //@ts-expect-error missing vitest type
    db.workingHours.findUnique.mockResolvedValue(null);
  });

  it("returns the existing row without writing when one is found", async () => {
    expect.assertions(3);
    //@ts-expect-error missing vitest type
    db.workingHours.findUnique.mockResolvedValue(mockWorkingHoursData);

    const result = await getWorkingHoursForOrganization(mockOrganizationId);

    expect(db.workingHours.findUnique).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      include: OVERRIDES_INCLUDE,
    });
    // why: the read-first path must never take a write lock when the row
    // already exists — this is the connection-pool-exhaustion regression guard.
    expect(db.workingHours.upsert).not.toHaveBeenCalled();
    expect(result).toEqual(mockWorkingHoursData);
  });

  it("creates defaults via the guarded upsert when none exist", async () => {
    expect.assertions(2);
    const defaultRow = { ...mockWorkingHoursData, enabled: false };
    //@ts-expect-error missing vitest type
    db.workingHours.findUnique.mockResolvedValue(null);
    //@ts-expect-error missing vitest type
    db.workingHours.upsert.mockResolvedValue(defaultRow);

    const result = await getWorkingHoursForOrganization(mockOrganizationId);

    // Query contract: the cold path must upsert with `update: {}` (the actual
    // race recovery — losing the create race — is covered by the P2002 test
    // in the createDefaultWorkingHours suite).
    expect(db.workingHours.upsert).toHaveBeenCalledWith(EXPECTED_UPSERT_ARGS);
    expect(result).toEqual(defaultRow);
  });

  it("wraps a database failure in a ShelfError", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.workingHours.findUnique.mockRejectedValue(new Error("db down"));

    await expect(
      getWorkingHoursForOrganization(mockOrganizationId)
    ).rejects.toBeInstanceOf(ShelfError);
    expect(db.workingHours.upsert).not.toHaveBeenCalled();
  });
});

describe("createDefaultWorkingHours", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("passes the guarded upsert args (update:{}) to keep the create idempotent", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.workingHours.upsert.mockResolvedValue(mockWorkingHoursData);

    await createDefaultWorkingHours(mockOrganizationId);

    // Query contract only — reached from three find-then-create call sites
    // (loader, override creator, admin dashboard); `update: {}` makes a
    // concurrent second call a no-op that returns the existing row.
    expect(db.workingHours.upsert).toHaveBeenCalledWith(EXPECTED_UPSERT_ARGS);
  });

  it("recovers from a concurrent-create P2002 by re-reading the row", async () => {
    expect.assertions(2);
    // The `include` forces Prisma to emulate the upsert (read + create), so a
    // concurrent first-hit can lose the race and throw P2002. The function must
    // then re-read the row the winner created rather than surface the error —
    // this is the actual race-safety behavior, not just the query shape.
    const existingRow = { ...mockWorkingHoursData, enabled: false };
    //@ts-expect-error missing vitest type
    db.workingHours.upsert.mockRejectedValue(p2002Error());
    //@ts-expect-error missing vitest type
    db.workingHours.findUniqueOrThrow.mockResolvedValue(existingRow);

    const result = await createDefaultWorkingHours(mockOrganizationId);

    expect(db.workingHours.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { organizationId: mockOrganizationId },
      include: OVERRIDES_INCLUDE,
    });
    expect(result).toEqual(existingRow);
  });

  it("re-throws a non-P2002 database error without re-reading", async () => {
    expect.assertions(2);
    const dbError = Object.assign(new Error("connection reset"), {
      code: "P1001",
    });
    //@ts-expect-error missing vitest type
    db.workingHours.upsert.mockRejectedValue(dbError);

    await expect(createDefaultWorkingHours(mockOrganizationId)).rejects.toBe(
      dbError
    );
    expect(db.workingHours.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
