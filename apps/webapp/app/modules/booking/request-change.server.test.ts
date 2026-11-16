/**
 * An approval covers what was approved: a change that asks for more, made by
 * someone who may not approve, clears it; an approver's change keeps it, and
 * so does anything that is not an approved reservation.
 *
 * @see {@link file://./request-change.server.ts}
 */
import { BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { clearApprovalWhenRequestGrows } from "./request-change.server";

// @vitest-environment node

// why: the note is asserted by its content, not written to a database.
vi.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vi.fn().mockResolvedValue(undefined),
}));

// why: the actor's display name for the note; no database here.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Sam",
    lastName: "Student",
    displayName: null,
  }),
}));

/** A transaction client recording the booking reads and writes. */
const tx = {
  booking: { findFirst: vi.fn(), updateMany: vi.fn() },
  bookingNote: {},
  userOrganization: { findUnique: vi.fn() },
  bookingSettings: { findUnique: vi.fn() },
};

const args = {
  bookingId: "booking-1",
  organizationId: "org-1",
  actorUserId: "user-1",
};

const APPROVED = {
  status: BookingStatus.RESERVED,
  approvedAt: new Date("2026-11-16T09:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.booking.findFirst.mockResolvedValue(APPROVED);
  // A Self service member, whose own approval switch is on.
  tx.userOrganization.findUnique.mockResolvedValue({ roles: ["SELF_SERVICE"] });
  tx.bookingSettings.findUnique.mockResolvedValue({
    requireApprovalForBase: true,
    requireApprovalForSelfService: true,
  });
});

describe("clearApprovalWhenRequestGrows", () => {
  it("clears the approval of a requester's grown request and notes why", async () => {
    await expect(
      clearApprovalWhenRequestGrows(tx as never, args)
    ).resolves.toBe(true);

    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "booking-1", organizationId: "org-1" },
      data: { approvedAt: null, approvedById: null },
    });
    expect(createSystemBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking-1",
        content: expect.stringContaining("needs approval again"),
      }),
      tx
    );
  });

  it("keeps the approval when the change is an approver's", async () => {
    tx.userOrganization.findUnique.mockResolvedValue({ roles: ["MANAGER"] });

    await expect(
      clearApprovalWhenRequestGrows(tx as never, args)
    ).resolves.toBe(false);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the approval when the member's own approval switch is off", async () => {
    // why: Base approval on, Self service off. A Self service reservation is
    // final; clearing its approval would leave it pending under Base's switch
    // and block its owner's check-out.
    tx.bookingSettings.findUnique.mockResolvedValue({
      requireApprovalForBase: true,
      requireApprovalForSelfService: false,
    });

    await expect(
      clearApprovalWhenRequestGrows(tx as never, args)
    ).resolves.toBe(false);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("judges a mixed membership by its effective role", async () => {
    // Self service + Base resolves to Self service, as `access.policy` does.
    tx.userOrganization.findUnique.mockResolvedValue({
      roles: ["BASE", "SELF_SERVICE"],
    });
    tx.bookingSettings.findUnique.mockResolvedValue({
      requireApprovalForBase: true,
      requireApprovalForSelfService: false,
    });

    await expect(
      clearApprovalWhenRequestGrows(tx as never, args)
    ).resolves.toBe(false);
  });

  it.each([
    ["a request still pending", { ...APPROVED, approvedAt: null }],
    ["a booking already out", { ...APPROVED, status: BookingStatus.ONGOING }],
    ["a draft", { status: BookingStatus.DRAFT, approvedAt: null }],
  ])("leaves %s alone", async (_label, booking) => {
    tx.booking.findFirst.mockResolvedValue(booking);

    await expect(
      clearApprovalWhenRequestGrows(tx as never, args)
    ).resolves.toBe(false);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("leaves a system write alone", async () => {
    await expect(
      clearApprovalWhenRequestGrows(tx as never, { ...args, actorUserId: null })
    ).resolves.toBe(false);
    expect(tx.booking.findFirst).not.toHaveBeenCalled();
  });
});
