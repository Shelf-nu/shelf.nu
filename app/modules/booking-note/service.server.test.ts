import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createBookingNote,
  createSystemBookingNote,
  getBookingNotes,
} from "./service.server";

// Mock the database
vi.mock("~/database/db.server", () => ({
  db: {
    bookingNote: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    booking: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock ShelfError
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
    it("should create a booking note with user", async () => {
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
      mockDb.db.bookingNote.create.mockResolvedValue(mockNote);

      const result = await createBookingNote({
        content: "Test note",
        type: "COMMENT",
        userId: "user-1",
        bookingId: "booking-1",
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

    it("should create a booking note without user", async () => {
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
      mockDb.db.bookingNote.create.mockResolvedValue(mockNote);

      const result = await createBookingNote({
        content: "System note",
        type: "UPDATE",
        bookingId: "booking-1",
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
  });

  describe("createSystemBookingNote", () => {
    it("should create a system booking note with UPDATE type", async () => {
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
      mockDb.db.bookingNote.create.mockResolvedValue(mockNote);

      const result = await createSystemBookingNote({
        content: "System generated note",
        bookingId: "booking-1",
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
  });

  describe("getBookingNotes", () => {
    it("should return booking notes when booking exists in organization", async () => {
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
            },
          },
        },
      });

      expect(result).toEqual(mockNotes);
    });

    it("should throw error when booking does not exist", async () => {
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
