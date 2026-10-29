import { BookingStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { Logger } from "~/utils/logger";
import { scheduler } from "~/utils/scheduler.server";
import { BOOKING_SCHEDULER_EVENTS_ENUM } from "./constants";
import { sendCheckinReminder } from "./email-helpers";
import {
  createStatusTransitionNote,
  scheduleExpiryArchiveJob,
  scheduleNextBookingJob,
} from "./service.server";
import type { SchedulerData } from "./types";
import { registerBookingWorkers } from "./worker.server";
import { recordEvent } from "../activity-event/service.server";
import { createSystemBookingNote } from "../booking-note/service.server";

// @vitest-environment node

// why: testing worker handlers without executing actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findUnique: vitest.fn().mockResolvedValue(null),
      findFirstOrThrow: vitest.fn(),
      update: vitest.fn().mockResolvedValue({}),
    },
    bookingSettings: {
      findUnique: vitest.fn().mockResolvedValue(null),
    },
  },
}));

// why: preventing actual job scheduling during tests
vitest.mock("~/utils/scheduler.server", () => ({
  scheduler: {
    work: vitest.fn(),
    cancel: vitest.fn(),
    sendAfter: vitest.fn(),
  },
  QueueNames: {
    bookingQueue: "booking-queue",
  },
}));

// why: avoiding actual status transition note creation during worker tests
vitest.mock("./service.server", () => ({
  createStatusTransitionNote: vitest.fn().mockResolvedValue(undefined),
  scheduleNextBookingJob: vitest.fn().mockResolvedValue(undefined),
  scheduleExpiryArchiveJob: vitest.fn().mockResolvedValue(undefined),
}));

// why: avoiding actual booking note creation during worker tests
vitest.mock("../booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn().mockResolvedValue({}),
}));

// why: asserting the BOOKING_ARCHIVED activity event without touching the DB
vitest.mock("../activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
}));

// why: preventing actual email template rendering during tests
vitest.mock("~/emails/bookings-updates-template", () => ({
  bookingUpdatesTemplateString: vitest.fn().mockResolvedValue("<html></html>"),
}));

// why: preventing actual email sending during tests
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: vitest.fn(),
}));

// why: the overdue handler resolves email recipients from the database; no
// recipients keeps these tests on the status transition and the note
vitest.mock("./notification-recipients.server", () => ({
  getBookingNotificationRecipients: vitest.fn().mockResolvedValue([]),
}));

// why: preventing actual email content generation during tests
vitest.mock("./email-helpers", () => ({
  checkoutReminderEmailContent: vitest.fn().mockReturnValue(""),
  overdueBookingEmailContent: vitest.fn().mockReturnValue(""),
  sendCheckinReminder: vitest.fn().mockResolvedValue(undefined),
}));

// why: preventing actual markdoc wrapper execution during tests
vitest.mock("~/utils/markdoc-wrappers", () => ({
  wrapBookingStatusForNote: vitest.fn().mockReturnValue("[STATUS]"),
}));

// why: preventing actual date utility execution during tests
vitest.mock("~/utils/date-fns", () => ({
  getTimeRemainingMessage: vitest.fn().mockReturnValue("1 hour"),
}));

// why: spying on Logger to verify logging behavior without side effects
vitest.mock("~/utils/logger", () => ({
  Logger: {
    warn: vitest.fn(),
    info: vitest.fn(),
    error: vitest.fn(),
  },
}));

// why: preventing ShelfError from interfering with test assertions
vitest.mock("~/utils/error", () => ({
  ShelfError: class ShelfError extends Error {
    constructor(opts: {
      cause: unknown;
      message: string;
      [key: string]: unknown;
    }) {
      super(opts.message);
    }
  },
  isNotFoundError: vitest.fn().mockReturnValue(false),
}));

/**
 * Helper to register workers and extract the auto-archive handler.
 * Since handlers are internal (not exported), we invoke them via
 * the callback registered with scheduler.work.
 */
async function getWorkerHandler(): Promise<
  (job: { data: SchedulerData }) => Promise<void>
> {
  await registerBookingWorkers();
  // scheduler.work is called with (queueName, callback)
  const workMock = scheduler.work as ReturnType<typeof vitest.fn>;
  const callback = workMock.mock.calls[0][1];
  return callback;
}

describe("autoArchiveHandler", () => {
  let workerHandler: (job: { data: SchedulerData }) => Promise<void>;

  beforeAll(async () => {
    workerHandler = await getWorkerHandler();
  });

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const mockJob = {
    data: {
      id: "booking-1",
      hints: { timeZone: "UTC", locale: "en-US" },
      eventType: BOOKING_SCHEDULER_EVENTS_ENUM.autoArchiveHandler,
    },
  };

  it("should archive a COMPLETE booking", async () => {
    const mockBooking = {
      id: "booking-1",
      status: BookingStatus.COMPLETE,
      custodianUserId: "user-1",
      organizationId: "org-1",
    };

    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.bookingSettings.findUnique.mockResolvedValue({
      autoArchiveBookings: true,
    });
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.ARCHIVED,
    });

    await workerHandler(mockJob);

    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1", status: BookingStatus.COMPLETE },
        data: expect.objectContaining({
          status: BookingStatus.ARCHIVED,
          autoArchivedAt: expect.any(Date),
        }),
      })
    );
    expect(createStatusTransitionNote).toHaveBeenCalledWith({
      bookingId: "booking-1",
      organizationId: "org-1",
      fromStatus: BookingStatus.COMPLETE,
      toStatus: BookingStatus.ARCHIVED,
      custodianUserId: "user-1",
    });
    expect(Logger.info).toHaveBeenCalledWith("Auto-archived booking booking-1");
  });

  it("should skip when booking not found", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue(null);

    await workerHandler(mockJob);

    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not found")
    );
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("should skip when booking is no longer COMPLETE", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.ARCHIVED,
      custodianUserId: "user-1",
      organizationId: "org-1",
    });

    await workerHandler(mockJob);

    expect(Logger.info).toHaveBeenCalledWith(
      expect.stringContaining("no longer COMPLETE")
    );
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("should skip when auto-archive is disabled for org", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.COMPLETE,
      custodianUserId: "user-1",
      organizationId: "org-1",
    });
    //@ts-expect-error missing vitest type
    db.bookingSettings.findUnique.mockResolvedValue({
      autoArchiveBookings: false,
    });

    await workerHandler(mockJob);

    expect(Logger.info).toHaveBeenCalledWith(
      expect.stringContaining("disabled for organization")
    );
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("should skip on concurrent modification", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.COMPLETE,
      custodianUserId: "user-1",
      organizationId: "org-1",
    });
    //@ts-expect-error missing vitest type
    db.bookingSettings.findUnique.mockResolvedValue({
      autoArchiveBookings: true,
    });
    //@ts-expect-error missing vitest type
    db.booking.update.mockRejectedValue(new Error("concurrent modification"));

    await workerHandler(mockJob);

    expect(Logger.info).toHaveBeenCalledWith(
      expect.stringContaining("modified concurrently")
    );
  });

  it("should handle errors gracefully", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockRejectedValue(new Error("DB connection error"));

    await workerHandler(mockJob);

    expect(Logger.error).toHaveBeenCalled();
  });
});

describe("autoArchiveExpiredHandler", () => {
  let workerHandler: (job: { data: SchedulerData }) => Promise<void>;

  beforeAll(async () => {
    workerHandler = await getWorkerHandler();
  });

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const mockJob = {
    data: {
      id: "booking-1",
      hints: { timeZone: "UTC", locale: "en-US" },
      eventType: BOOKING_SCHEDULER_EVENTS_ENUM.autoArchiveExpiredHandler,
    },
  };

  const pastReservedBooking = {
    id: "booking-1",
    status: BookingStatus.RESERVED,
    to: new Date("2020-01-01T00:00:00Z"),
    custodianUserId: "user-1",
    organizationId: "org-1",
  };

  it("archives a past-due RESERVED booking and flags it as never-checked-in", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue(pastReservedBooking);
    //@ts-expect-error missing vitest type
    db.bookingSettings.findUnique.mockResolvedValue({
      autoArchiveExpiredReservations: true,
      autoArchiveDays: 2,
    });
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...pastReservedBooking,
      status: BookingStatus.ARCHIVED,
    });

    await workerHandler(mockJob);

    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1", status: BookingStatus.RESERVED },
        data: expect.objectContaining({
          status: BookingStatus.ARCHIVED,
          archivedWithoutCheckin: true,
          autoArchivedAt: expect.any(Date),
        }),
      })
    );
    expect(createStatusTransitionNote).toHaveBeenCalledWith({
      bookingId: "booking-1",
      organizationId: "org-1",
      fromStatus: BookingStatus.RESERVED,
      toStatus: BookingStatus.ARCHIVED,
      custodianUserId: "user-1",
    });
    expect(Logger.info).toHaveBeenCalledWith(
      "Auto-archived expired reservation booking-1"
    );
    // Parity with the manual archiveBooking path: a semantic BOOKING_ARCHIVED
    // event is emitted so reports counting it also see auto-archived
    // reservations. System action → no human actor.
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BOOKING_ARCHIVED",
        entityType: "BOOKING",
        entityId: "booking-1",
        bookingId: "booking-1",
        organizationId: "org-1",
        actorUserId: null,
      })
    );
  });

  it("skips a booking that is no longer RESERVED (e.g. checked out)", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue({
      ...pastReservedBooking,
      status: BookingStatus.ONGOING,
    });

    await workerHandler(mockJob);

    expect(db.bookingSettings.findUnique).not.toHaveBeenCalled();
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("skips when the setting is disabled for the organization", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue(pastReservedBooking);
    //@ts-expect-error missing vitest type
    db.bookingSettings.findUnique.mockResolvedValue({
      autoArchiveExpiredReservations: false,
      autoArchiveDays: 2,
    });

    await workerHandler(mockJob);

    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("reschedules (does not archive) when the end date + grace has not elapsed", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue({
      ...pastReservedBooking,
      to: new Date("2999-01-01T00:00:00Z"),
    });
    //@ts-expect-error missing vitest type
    db.bookingSettings.findUnique.mockResolvedValue({
      autoArchiveExpiredReservations: true,
      autoArchiveDays: 2,
    });

    await workerHandler(mockJob);

    expect(db.booking.update).not.toHaveBeenCalled();
    // dedupe:false is load-bearing — the reschedule runs while this job is still
    // `active` and holds the per-booking singletonKey, so a keyed re-queue would
    // be dropped by pg-boss and the booking would never be auto-archived.
    expect(scheduleExpiryArchiveJob).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: "booking-1", dedupe: false })
    );
  });
});

/**
 * The jobs a booking runs after its end date changes: the check-in reminder
 * fires an hour before the stored end and schedules the overdue job at the end
 * it reads then, and the overdue job moves ONGOING to OVERDUE. These are the
 * only path to OVERDUE, so a shortened booking turns overdue at its new end
 * only through this chain.
 */
describe("check-in reminder and overdue chain after an end-date change", () => {
  let workerHandler: (job: { data: SchedulerData }) => Promise<void>;

  beforeAll(async () => {
    workerHandler = await getWorkerHandler();
  });

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const hints = { timeZone: "UTC", locale: "en-US" };
  /** The end the booking was shortened to. */
  const SHORTENED_END = new Date("2030-06-01T15:00:00Z");

  /** The booking as the worker reads it after the end moved earlier. */
  function shortenedBooking(status: BookingStatus) {
    return {
      id: "booking-1",
      name: "Site survey",
      status,
      from: new Date("2030-06-01T09:00:00Z"),
      to: SHORTENED_END,
      organizationId: "org-1",
      custodianUserId: "user-1",
      _count: { bookingAssets: 1 },
    };
  }

  it("sends the reminder and schedules the overdue job at the end stored when it fires", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValue(
      shortenedBooking(BookingStatus.ONGOING)
    );

    await workerHandler({
      data: {
        id: "booking-1",
        hints,
        eventType: BOOKING_SCHEDULER_EVENTS_ENUM.checkinReminder,
      },
    });

    expect(sendCheckinReminder).toHaveBeenCalledTimes(1);
    expect(scheduleNextBookingJob).toHaveBeenCalledWith({
      data: {
        id: "booking-1",
        hints,
        eventType: BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler,
      },
      when: SHORTENED_END,
    });
  });

  it("does nothing when a reminder left over from the old, later end fires after the booking is overdue", async () => {
    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValue(
      shortenedBooking(BookingStatus.OVERDUE)
    );

    await workerHandler({
      data: {
        id: "booking-1",
        hints,
        eventType: BOOKING_SCHEDULER_EVENTS_ENUM.checkinReminder,
      },
    });

    expect(sendCheckinReminder).not.toHaveBeenCalled();
    expect(scheduleNextBookingJob).not.toHaveBeenCalled();
  });

  it("moves an ONGOING booking to OVERDUE and writes the transition note", async () => {
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(
      shortenedBooking(BookingStatus.OVERDUE)
    );

    await workerHandler({
      data: {
        id: "booking-1",
        hints,
        eventType: BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler,
      },
    });

    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1", status: BookingStatus.ONGOING },
        data: { status: BookingStatus.OVERDUE },
      })
    );
    expect(createSystemBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking-1",
        content: expect.stringContaining("Booking became overdue."),
      })
    );
  });

  it("changes nothing when an overdue job left over from the old end fires on an already overdue booking", async () => {
    // The update is gated on ONGOING, so on an OVERDUE booking it matches no
    // row and Prisma throws; the worker logs it and writes no second note.
    //@ts-expect-error missing vitest type
    db.booking.update.mockRejectedValue(
      new Error("Record to update not found")
    );

    await workerHandler({
      data: {
        id: "booking-1",
        hints,
        eventType: BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler,
      },
    });

    expect(createSystemBookingNote).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });
});
