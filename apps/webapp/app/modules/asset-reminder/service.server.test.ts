/**
 * Tests for creating and editing asset reminders.
 *
 * A reminder names an asset, and the reminder's email shows that asset's
 * title and image to the workspace that owns the reminder. The asset must
 * therefore be proven to belong to the caller's workspace before anything is
 * written or scheduled.
 *
 * Recurring reminders are a tier capability. Create persists the cadence and
 * schedules the job with retry options; edit enforces the tier gate only when
 * the edit adds or changes recurrence relative to the stored row, so a
 * downgraded workspace can still edit other fields or turn repeat off.
 *
 * @see {@link file://./service.server.ts}
 */
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { ShelfError } from "~/utils/error";
import {
  findUndeliveredReminderJobIds,
  recurringReminderJobOptions,
  scheduleAssetReminder,
} from "./scheduler.server";
import {
  createAssetReminder,
  editAssetReminder,
  getPaginatedAndFilterableReminders,
  getUpcomingRemindersForHomePage,
} from "./service.server";

// @vitest-environment node

// why: exercising the service's write sequence without a real database
vi.mock("~/database/db.server", () => ({
  db: {
    $transaction: vi.fn(),
    asset: { findMany: vi.fn() },
    teamMember: { count: vi.fn() },
    assetReminder: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
    },
    note: { create: vi.fn() },
  },
}));

// why: scheduling enqueues a pg-boss job; the test only needs to know whether it was requested
vi.mock("./scheduler.server", () => ({
  ASSETS_EVENT_TYPE_MAP: { REMINDER: "REMINDER" },
  scheduleAssetReminder: vi.fn().mockResolvedValue(undefined),
  cancelAssetReminderScheduler: vi.fn(),
  // why: reads pg-boss's job table; the test decides which jobs are live
  findUndeliveredReminderJobIds: vi.fn(),
  // why: the real helper lives beside pg-boss wiring; a stand-in that echoes
  // its inputs lets the tests prove which options reached the scheduler
  recurringReminderJobOptions: vi.fn((reminderId: string, when: Date) => ({
    singletonKey: `asset-reminder-${reminderId}-${when.toISOString()}`,
  })),
}));

// why: the per-page cookie is request plumbing unrelated to the rows returned
vi.mock("~/utils/cookies.server", () => ({
  updateCookieWithPerPage: vi.fn().mockResolvedValue({ perPage: 20 }),
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
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      // why: run the transaction body against the same mocked client
      (callback: (tx: typeof db) => unknown) => callback(db)
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
      // A one-shot reminder adds no options to the scheduler's defaults.
      options: {},
    });
  });

  it("does not schedule the reminder when writing its note fails", async () => {
    vi.mocked(db.note.create).mockRejectedValue(new Error("note failed"));

    await expect(createAssetReminder(REMINDER_ARGS)).rejects.toBeInstanceOf(
      ShelfError
    );
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });

  it("persists the cadence and schedules a recurring reminder with retry options", async () => {
    const endsAt = new Date("2099-12-31T23:59:59.999Z");

    await createAssetReminder({
      ...REMINDER_ARGS,
      recurrence: {
        unit: "MONTH",
        interval: 1,
        timezone: "Europe/Sofia",
        endsAt,
      },
    });

    expect(db.assetReminder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recurrenceUnit: "MONTH",
        recurrenceInterval: 1,
        recurrenceTimezone: "Europe/Sofia",
        recurrenceEndsAt: endsAt,
      }),
    });
    expect(recurringReminderJobOptions).toHaveBeenCalledWith(
      "reminder-1",
      REMINDER_ARGS.alertDateTime
    );
    expect(scheduleAssetReminder).toHaveBeenCalledWith({
      data: { reminderId: "reminder-1", eventType: "REMINDER" },
      when: REMINDER_ARGS.alertDateTime,
      options: recurringReminderJobOptions(
        "reminder-1",
        REMINDER_ARGS.alertDateTime
      ),
    });
  });

  it.each([
    ["null", null],
    ["absent", undefined],
  ])(
    "writes empty cadence fields and plain options when recurrence is %s",
    async (_label, recurrence) => {
      await createAssetReminder({ ...REMINDER_ARGS, recurrence });

      expect(db.assetReminder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recurrenceUnit: null,
          recurrenceInterval: null,
          recurrenceTimezone: null,
          recurrenceEndsAt: null,
        }),
      });
      expect(recurringReminderJobOptions).not.toHaveBeenCalled();
      expect(scheduleAssetReminder).toHaveBeenCalledWith(
        expect.objectContaining({ options: {} })
      );
    }
  );
});

/** The next fire date of the stored row, which an edit round-trips unchanged. */
const STORED_ALERT = new Date("2099-01-01T09:00:00Z");

/** A stored one-shot reminder row in the caller's workspace. */
const ONE_SHOT_ROW = {
  id: "reminder-1",
  name: "Return the camera",
  message: "Please bring it back",
  alertDateTime: STORED_ALERT,
  organizationId: "org-1",
  assetId: "asset-1",
  recurrenceUnit: null,
  recurrenceInterval: null,
  recurrenceTimezone: null,
  recurrenceEndsAt: null,
  activeSchedulerReference: null,
};

/** A stored monthly series with no end date, anchored in UTC. */
const MONTHLY_ROW = {
  ...ONE_SHOT_ROW,
  recurrenceUnit: "MONTH",
  recurrenceInterval: 1,
  recurrenceTimezone: "UTC",
};

/** Edit arguments that round-trip the stored monthly series unchanged. */
const EDIT_ARGS = {
  id: "reminder-1",
  name: "Return the camera",
  message: "Please bring it back",
  alertDateTime: STORED_ALERT,
  organizationId: "org-1",
  teamMembers: ["tm-1"],
  recurrence: {
    unit: "MONTH" as const,
    interval: 1,
    timezone: "UTC",
    endsAt: null,
  },
  canUseRecurringReminders: false,
};

describe("editAssetReminder tier gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.teamMember.count).mockResolvedValue(1);
    vi.mocked(db.assetReminder.update).mockResolvedValue({
      id: "reminder-1",
    } as never);
  });

  /** Makes the org-scoped lookup return the given stored row. */
  function givenStoredRow(row: typeof ONE_SHOT_ROW | typeof MONTHLY_ROW) {
    vi.mocked(db.assetReminder.findFirstOrThrow).mockResolvedValue(
      row as never
    );
  }

  /** Asserts the edit was refused with a 403 and nothing was written. */
  async function expectRefused(args: Parameters<typeof editAssetReminder>[0]) {
    const error = await editAssetReminder(args).catch((e) => e);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.status).toBe(403);
    expect(db.assetReminder.update).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  }

  it("refuses to edit a one-shot reminder that already fired, as a client error", async () => {
    givenStoredRow({
      ...ONE_SHOT_ROW,
      alertDateTime: new Date("2020-01-01T09:00:00Z"),
    });

    const error = await editAssetReminder({
      ...EDIT_ARGS,
      recurrence: null,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.status).toBe(400);
    expect(db.assetReminder.update).not.toHaveBeenCalled();
  });

  it("refuses to add recurrence to a one-shot reminder", async () => {
    givenStoredRow(ONE_SHOT_ROW);

    await expectRefused(EDIT_ARGS);
  });

  it("refuses to change the interval of a stored series", async () => {
    givenStoredRow(MONTHLY_ROW);

    await expectRefused({
      ...EDIT_ARGS,
      recurrence: { ...EDIT_ARGS.recurrence, interval: 3 },
    });
  });

  it("refuses to change the end date of a stored series", async () => {
    givenStoredRow(MONTHLY_ROW);

    await expectRefused({
      ...EDIT_ARGS,
      recurrence: {
        ...EDIT_ARGS.recurrence,
        endsAt: new Date("2099-06-30T23:59:59.999Z"),
      },
    });
  });

  it("refuses to move the next fire date of a stored series", async () => {
    givenStoredRow(MONTHLY_ROW);

    await expectRefused({
      ...EDIT_ARGS,
      alertDateTime: new Date("2099-01-15T09:00:00Z"),
    });
  });

  it("allows a message-only edit that keeps the stored cadence", async () => {
    givenStoredRow(MONTHLY_ROW);

    await editAssetReminder({ ...EDIT_ARGS, message: "New wording" });

    expect(db.assetReminder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: "New wording",
          recurrenceUnit: "MONTH",
          recurrenceInterval: 1,
          recurrenceTimezone: "UTC",
          recurrenceEndsAt: null,
        }),
      })
    );
    expect(scheduleAssetReminder).toHaveBeenCalledTimes(1);
  });

  it("allows turning repeat off and clears the cadence fields", async () => {
    givenStoredRow(MONTHLY_ROW);

    await editAssetReminder({ ...EDIT_ARGS, recurrence: null });

    expect(db.assetReminder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurrenceUnit: null,
          recurrenceInterval: null,
          recurrenceTimezone: null,
          recurrenceEndsAt: null,
        }),
      })
    );
    expect(scheduleAssetReminder).toHaveBeenCalledWith(
      expect.objectContaining({ options: {} })
    );
  });

  it("keeps the stored timezone and its end-of-day when edited from another zone", async () => {
    // Stored series: New York, ending 2099-07-15 at end of day there (EDT).
    givenStoredRow({
      ...MONTHLY_ROW,
      recurrenceTimezone: "America/New_York",
      recurrenceEndsAt: new Date("2099-07-16T03:59:59.999Z"),
    } as unknown as typeof MONTHLY_ROW);

    // Editor in Tokyo submits the same calendar day, end of day in Tokyo.
    await editAssetReminder({
      ...EDIT_ARGS,
      recurrence: {
        ...EDIT_ARGS.recurrence,
        timezone: "Asia/Tokyo",
        endsAt: new Date("2099-07-15T14:59:59.999Z"),
      },
    });

    // A plain edit on a plan without recurrence is not refused, and the
    // series keeps its zone and its end instant.
    expect(db.assetReminder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recurrenceTimezone: "America/New_York",
          recurrenceEndsAt: new Date("2099-07-16T03:59:59.999Z"),
        }),
      })
    );
  });

  it("lets a tier with the capability change the cadence", async () => {
    givenStoredRow(MONTHLY_ROW);

    await editAssetReminder({
      ...EDIT_ARGS,
      canUseRecurringReminders: true,
      recurrence: { ...EDIT_ARGS.recurrence, interval: 3 },
    });

    expect(db.assetReminder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ recurrenceInterval: 3 }),
      })
    );
  });
});

describe("getUpcomingRemindersForHomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.assetReminder.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );
  });

  it("leaves out reminders whose asset is archived, since they will not fire", async () => {
    await getUpcomingRemindersForHomePage({ organizationId: "org-1" });

    expect(db.assetReminder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          asset: { archivedAt: null },
        }),
      })
    );
  });
});

describe("getPaginatedAndFilterableReminders delivery state", () => {
  const PAST = new Date("2020-01-01T09:00:00Z");
  const FUTURE = new Date("2099-01-01T09:00:00Z");
  const ROWS = [
    { id: "queued", alertDateTime: PAST, activeSchedulerReference: "job-q" },
    { id: "done", alertDateTime: PAST, activeSchedulerReference: "job-d" },
    { id: "ahead", alertDateTime: FUTURE, activeSchedulerReference: "job-f" },
    { id: "skipped", alertDateTime: PAST, activeSchedulerReference: null },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.assetReminder.findMany).mockResolvedValue(ROWS as never);
    vi.mocked(db.assetReminder.count).mockResolvedValue(ROWS.length);
    vi.mocked(updateCookieWithPerPage).mockResolvedValue({
      perPage: 20,
    } as never);
  });

  async function loadRows() {
    const { reminders } = await getPaginatedAndFilterableReminders({
      organizationId: "org-1",
      request: new Request("https://localhost/reminders"),
    });
    return Object.fromEntries(
      reminders.map((row) => [row.id, row.deliveryPending])
    );
  }

  it("marks only due reminders whose job is still live", async () => {
    vi.mocked(findUndeliveredReminderJobIds).mockResolvedValue(
      new Set(["job-q"])
    );

    expect(await loadRows()).toEqual({
      queued: true,
      done: false,
      ahead: false,
      skipped: false,
    });
    // Only past-due rows with a job are looked up.
    expect(findUndeliveredReminderJobIds).toHaveBeenCalledWith([
      "job-q",
      "job-d",
    ]);
  });

  it("falls back to unmarked rows when the job lookup fails", async () => {
    vi.mocked(findUndeliveredReminderJobIds).mockRejectedValue(
      new Error("pgboss unavailable")
    );

    expect(Object.values(await loadRows())).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
