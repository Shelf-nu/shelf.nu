import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createBookingNote,
  createSystemBookingNote,
  createSystemBookingNotes,
  deleteBookingNote,
  getBookingNotes,
} from "./service.server";

// why: testing booking note service logic without executing actual database operations
vi.mock("~/database/db.server", () => ({
  db: {
    bookingNote: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    booking: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// why: testing error handling behavior without actual ShelfError implementation
vi.mock("~/utils/error", () => ({
  ShelfError: class ShelfError extends Error {
    constructor(config: any) {
      super(config.message);
      Object.assign(this, config);
    }
  },
}));

const mockDb = await import("~/database/db.server");

describe("BookingNote Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createBookingNote", () => {
    it("creates a booking note with user when booking is in the organization", async () => {
      const mockNote = {
        id: "note-1",
        content: "Test note",
        type: "COMMENT",
        bookingId: "booking-1",
        userId: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      //@ts-expect-error missing vitest type
      mockDb.db.booking.findFirst.mockResolvedValue({ id: "booking-1" });
      //@ts-expect-error missing vitest type
      mockDb.db.bookingNote.create.mockResolvedValue(mockNote);

      const result = await createBookingNote({
        content: "Test note",
        type: "COMMENT",
        userId: "user-1",
        bookingId: "booking-1",
        organizationId: "org-1",
      });

      // Service must verify booking org scope BEFORE writing the note
      expect(mockDb.db.booking.findFirst).toHaveBeenCalledWith({
        where: { id: "booking-1", organizationId: "org-1" },
        select: { id: true },
      });
      expect(mockDb.db.bookingNote.create).toHaveBeenCalledWith({
        data: {
          content: "Test note",
          type: "COMMENT",
          booking: {
            connect: {
              id: "booking-1",
            },
          },
          user: {
            connect: {
              id: "user-1",
            },
          },
        },
      });
      expect(result).toEqual(mockNote);
    });

    it("creates a booking note without user (system note) when booking is in the organization", async () => {
      const mockNote = {
        id: "note-1",
        content: "System note",
        type: "UPDATE",
        bookingId: "booking-1",
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      //@ts-expect-error missing vitest type
      mockDb.db.booking.findFirst.mockResolvedValue({ id: "booking-1" });
      //@ts-expect-error missing vitest type
      mockDb.db.bookingNote.create.mockResolvedValue(mockNote);

      const result = await createBookingNote({
        content: "System note",
        type: "UPDATE",
        bookingId: "booking-1",
        organizationId: "org-1",
      });

      expect(mockDb.db.bookingNote.create).toHaveBeenCalledWith({
        data: {
          content: "System note",
          type: "UPDATE",
          booking: {
            connect: {
              id: "booking-1",
            },
          },
        },
      });
      expect(result).toEqual(mockNote);
    });

    it("throws 404 and does NOT write a note when the booking is not in the organization", async () => {
      //@ts-expect-error missing vitest type
      mockDb.db.booking.findFirst.mockResolvedValue(null);

      await expect(
        createBookingNote({
          content: "Cross-org injection attempt",
          type: "COMMENT",
          userId: "attacker-user",
          bookingId: "victim-booking",
          organizationId: "attacker-org",
        })
      ).rejects.toThrow("Booking not found or access denied");

      // Crucial: the note write is never attempted
      expect(mockDb.db.bookingNote.create).not.toHaveBeenCalled();
    });
  });

  describe("createSystemBookingNote", () => {
    it("creates a system booking note with UPDATE type when booking is in the organization", async () => {
      const mockNote = {
        id: "note-1",
        content: "System generated note",
        type: "UPDATE",
        bookingId: "booking-1",
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      //@ts-expect-error missing vitest type
      mockDb.db.booking.findFirst.mockResolvedValue({ id: "booking-1" });
      //@ts-expect-error missing vitest type
      mockDb.db.bookingNote.create.mockResolvedValue(mockNote);

      const result = await createSystemBookingNote({
        content: "System generated note",
        bookingId: "booking-1",
        organizationId: "org-1",
      });

      expect(mockDb.db.booking.findFirst).toHaveBeenCalledWith({
        where: { id: "booking-1", organizationId: "org-1" },
        select: { id: true },
      });
      expect(mockDb.db.bookingNote.create).toHaveBeenCalledWith({
        data: {
          content: "System generated note",
          type: "UPDATE",
          booking: {
            connect: {
              id: "booking-1",
            },
          },
        },
      });
      expect(result).toEqual(mockNote);
    });

    it("throws when system note target booking is outside the organization", async () => {
      //@ts-expect-error missing vitest type
      mockDb.db.booking.findFirst.mockResolvedValue(null);

      await expect(
        createSystemBookingNote({
          content: "System message",
          bookingId: "booking-1",
          organizationId: "wrong-org",
        })
      ).rejects.toThrow("Booking not found or access denied");

      expect(mockDb.db.bookingNote.create).not.toHaveBeenCalled();
    });
  });

  describe("createSystemBookingNotes", () => {
    it("validates every target booking and inserts in a single batch", async () => {
      // The whole point of the plural helper: a fixed TWO statements no matter
      // how many notes are written, so a large batch can't burn the caller's
      // transaction budget on audit notes.
      (mockDb.db.booking.findMany as any).mockResolvedValue([
        { id: "booking-1" },
        { id: "booking-2" },
      ]);
      (mockDb.db.bookingNote.createMany as any).mockResolvedValue({ count: 3 });

      await createSystemBookingNotes({
        notes: [
          { bookingId: "booking-1", content: "a" },
          { bookingId: "booking-2", content: "b" },
          { bookingId: "booking-1", content: "c" },
        ],
        organizationId: "org-1",
      });

      // One ownership check covering the DISTINCT booking ids...
      expect(mockDb.db.booking.findMany).toHaveBeenCalledTimes(1);
      expect(mockDb.db.booking.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["booking-1", "booking-2"] },
          organizationId: "org-1",
        },
        select: { id: true },
      });
      // ...and one insert for all three notes, all typed as system notes.
      expect(mockDb.db.bookingNote.createMany).toHaveBeenCalledTimes(1);
      expect(mockDb.db.bookingNote.createMany).toHaveBeenCalledWith({
        data: [
          { bookingId: "booking-1", content: "a", type: "UPDATE" },
          { bookingId: "booking-2", content: "b", type: "UPDATE" },
          { bookingId: "booking-1", content: "c", type: "UPDATE" },
        ],
      });
    });

    it("writes nothing when a target booking is outside the organization", async () => {
      // Cross-org guard: the caller passes booking ids derived from related
      // records, so a foreign id must abort the whole batch rather than
      // silently writing the notes it could match.
      (mockDb.db.booking.findMany as any).mockResolvedValue([
        { id: "booking-1" },
      ]);

      await expect(
        createSystemBookingNotes({
          notes: [
            { bookingId: "booking-1", content: "a" },
            { bookingId: "foreign-booking", content: "b" },
          ],
          organizationId: "org-1",
        })
      ).rejects.toThrow("Booking not found or access denied");

      expect(mockDb.db.bookingNote.createMany).not.toHaveBeenCalled();
    });

    it("is a no-op for an empty list (no ownership query, no insert)", async () => {
      await createSystemBookingNotes({ notes: [], organizationId: "org-1" });

      expect(mockDb.db.booking.findMany).not.toHaveBeenCalled();
      expect(mockDb.db.bookingNote.createMany).not.toHaveBeenCalled();
    });
  });

  describe("deleteBookingNote", () => {
    it("scopes the delete to userId, the route's bookingId, AND the booking's organization", async () => {
      //@ts-expect-error missing vitest type
      mockDb.db.bookingNote.deleteMany.mockResolvedValue({ count: 1 });

      const result = await deleteBookingNote({
        id: "note-1",
        bookingId: "booking-1",
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(mockDb.db.bookingNote.deleteMany).toHaveBeenCalledWith({
        where: {
          id: "note-1",
          userId: "user-1",
          booking: { id: "booking-1", organizationId: "org-1" },
        },
      });
      expect(result).toEqual({ count: 1 });
    });

    /**
     * The predicate carries the authorization, so zero rows is a refusal — the
     * note is someone else's, on another booking, or in another workspace. It
     * has to be reported: the caller cannot tell the difference, and the
     * activity route showed "deleted successfully" on the strength of the call
     * returning at all. Matches `deleteTeamMemberNote`, `deleteNote` and
     * `deleteLocationNote`, which all refuse here.
     */
    it("refuses when the note's booking is not in the organization", async () => {
      //@ts-expect-error missing vitest type
      mockDb.db.bookingNote.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        deleteBookingNote({
          id: "cross-org-note",
          bookingId: "booking-1",
          userId: "user-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow(
        "Note not found or you don't have permission to delete it."
      );
    });

    it("refuses when the note belongs to a different booking in the same org", async () => {
      // The relational where { booking: { id: bookingId, organizationId } }
      // means a note on booking B cannot be deleted via a handler bound to
      // booking A, even when both bookings sit in the same workspace.
      //@ts-expect-error missing vitest type
      mockDb.db.bookingNote.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        deleteBookingNote({
          id: "note-on-booking-B",
          bookingId: "booking-A",
          userId: "user-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow(
        "Note not found or you don't have permission to delete it."
      );
    });

    it("refuses as a client error rather than a server fault", async () => {
      // A 5xx would page someone over a user trying to delete a note that is
      // not theirs.
      //@ts-expect-error missing vitest type
      mockDb.db.bookingNote.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        deleteBookingNote({
          id: "not-mine",
          bookingId: "booking-1",
          userId: "user-1",
          organizationId: "org-1",
        })
      ).rejects.toMatchObject({ status: 403, shouldBeCaptured: false });
    });
  });

  describe("getBookingNotes", () => {
    it("returns booking notes when booking exists in organization", async () => {
      const mockBooking = { id: "booking-1" };
      const mockNotes = [
        {
          id: "note-1",
          content: "Test note",
          type: "COMMENT",
          bookingId: "booking-1",
          userId: "user-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { firstName: "John", lastName: "Doe" },
        },
      ];

      //@ts-expect-error missing vitest type
      mockDb.db.booking.findFirst.mockResolvedValue(mockBooking);
      //@ts-expect-error missing vitest type
      mockDb.db.bookingNote.findMany.mockResolvedValue(mockNotes);

      const result = await getBookingNotes({
        bookingId: "booking-1",
        organizationId: "org-1",
      });

      expect(mockDb.db.booking.findFirst).toHaveBeenCalledWith({
        where: {
          id: "booking-1",
          organizationId: "org-1",
        },
        select: {
          id: true,
        },
      });

      expect(mockDb.db.bookingNote.findMany).toHaveBeenCalledWith({
        where: {
          bookingId: "booking-1",
        },
        orderBy: {
          createdAt: "desc",
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      });

      expect(result).toEqual(mockNotes);
    });

    it("throws error when booking does not exist", async () => {
      //@ts-expect-error missing vitest type
      mockDb.db.booking.findFirst.mockResolvedValue(null);

      await expect(
        getBookingNotes({
          bookingId: "booking-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow("Booking not found or access denied");
    });
  });
});
