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

/** The exact args the cold-path/helper must pass to keep the write race-safe. */
const EXPECTED_UPSERT_ARGS = {
  where: { organizationId: mockOrganizationId },
  update: {},
  create: {
    organizationId: mockOrganizationId,
    enabled: false,
    weeklySchedule: getDefaultWeeklySchedule(),
  },
  include: { overrides: { orderBy: { date: "asc" } } },
};

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
      include: { overrides: { orderBy: { date: "asc" } } },
    });
    // why: the read-first path must never take a write lock when the row
    // already exists — this is the connection-pool-exhaustion regression guard.
    expect(db.workingHours.upsert).not.toHaveBeenCalled();
    expect(result).toEqual(mockWorkingHoursData);
  });

  it("creates defaults via a race-safe upsert when none exist", async () => {
    expect.assertions(2);
    const defaultRow = { ...mockWorkingHoursData, enabled: false };
    //@ts-expect-error missing vitest type
    db.workingHours.findUnique.mockResolvedValue(null);
    //@ts-expect-error missing vitest type
    db.workingHours.upsert.mockResolvedValue(defaultRow);

    const result = await getWorkingHoursForOrganization(mockOrganizationId);

    // why: cold path must use upsert (not a bare create) with `update: {}` so
    // two concurrent first requests can't race a unique-constraint violation on
    // WorkingHours.organizationId.
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

  it("upserts (idempotent) instead of a bare create", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.workingHours.upsert.mockResolvedValue(mockWorkingHoursData);

    await createDefaultWorkingHours(mockOrganizationId);

    // why: this shared helper is reached from three separate find-then-create
    // call sites; making it an upsert makes all of them race-safe at once
    // (update:{} = no-op when a concurrent request already created the row).
    expect(db.workingHours.upsert).toHaveBeenCalledWith(EXPECTED_UPSERT_ARGS);
  });
});
