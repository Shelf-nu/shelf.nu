/**
 * Tests for creating asset reminders.
 *
 * A reminder names an asset, and the reminder's email shows that asset's
 * title and image to the workspace that owns the reminder. The asset must
 * therefore be proven to belong to the caller's workspace before anything is
 * written or scheduled.
 *
 * @see {@link file://./service.server.ts}
 */
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { scheduleAssetReminder } from "./scheduler.server";
import { createAssetReminder } from "./service.server";

// @vitest-environment node

// why: exercising the service's write sequence without a real database
vi.mock("~/database/db.server", () => ({
  db: {
    $transaction: vi.fn(),
    asset: { findMany: vi.fn() },
    teamMember: { count: vi.fn() },
    assetReminder: { create: vi.fn() },
    note: { create: vi.fn() },
  },
}));

// why: scheduling enqueues a pg-boss job; the test only needs to know whether it was requested
vi.mock("./scheduler.server", () => ({
  ASSETS_EVENT_TYPE_MAP: { REMINDER: "REMINDER" },
  scheduleAssetReminder: vi.fn().mockResolvedValue(undefined),
  cancelAssetReminderScheduler: vi.fn(),
}));

// why: the user lookup pulls in the whole user service; only the name is used here
vi.mock("../user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: null,
  }),
}));

const REMINDER_ARGS = {
  name: "Return the camera",
  message: "Please bring it back",
  alertDateTime: new Date("2099-01-01T09:00:00Z"),
  assetId: "asset-1",
  createdById: "user-1",
  organizationId: "org-1",
  teamMembers: ["tm-1"],
};

describe("createAssetReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.$transaction).mockImplementation(
      // why: run the transaction body against the same mocked client
      (callback: unknown) => (callback as (tx: typeof db) => unknown)(db)
    );
    vi.mocked(db.teamMember.count).mockResolvedValue(1);
    vi.mocked(db.asset.findMany).mockResolvedValue([
      { id: "asset-1" },
    ] as never);
    vi.mocked(db.assetReminder.create).mockResolvedValue({
      id: "reminder-1",
      name: REMINDER_ARGS.name,
    } as never);
    vi.mocked(db.note.create).mockResolvedValue({} as never);
  });

  it("refuses an asset from another workspace without writing or scheduling anything", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([]);

    const error = await createAssetReminder({
      ...REMINDER_ARGS,
      assetId: "asset-from-another-org",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.status).toBe(400);
    expect(db.assetReminder.create).not.toHaveBeenCalled();
    expect(db.note.create).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });

  it("checks the asset against the caller's workspace before creating the reminder", async () => {
    await createAssetReminder(REMINDER_ARGS);

    expect(db.asset.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
      select: { id: true },
    });
    const assetCheckOrder = vi.mocked(db.asset.findMany).mock
      .invocationCallOrder[0];
    const createOrder = vi.mocked(db.assetReminder.create).mock
      .invocationCallOrder[0];
    expect(assetCheckOrder).toBeLessThan(createOrder);
  });

  it("writes the reminder and its note in one transaction, then schedules it", async () => {
    const reminder = await createAssetReminder(REMINDER_ARGS);

    expect(reminder).toMatchObject({ id: "reminder-1" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.note.create).toHaveBeenCalledTimes(1);
    expect(scheduleAssetReminder).toHaveBeenCalledWith({
      data: { reminderId: "reminder-1", eventType: "REMINDER" },
      when: REMINDER_ARGS.alertDateTime,
    });
  });

  it("does not schedule the reminder when writing its note fails", async () => {
    vi.mocked(db.note.create).mockRejectedValue(new Error("note failed"));

    await expect(createAssetReminder(REMINDER_ARGS)).rejects.toBeInstanceOf(
      ShelfError
    );
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });
});
