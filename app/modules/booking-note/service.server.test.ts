import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import {
  createBookingNote,
  createSystemBookingNote,
  getBookingNotes,
} from "./service.server";

vi.mock("~/database/db.server", () => ({
  db: {
    bookingNote: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

type BookingNoteCreateArgs = Parameters<typeof db.bookingNote.create>[0];

describe("booking note service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createBookingNote", () => {
    it("creates a manual booking note with a connected user", async () => {
      const mockNote = { id: "note-1" };
      const createMock = vi.mocked(db.bookingNote.create);
      createMock.mockResolvedValue(mockNote as never);

      const result = await createBookingNote({
        bookingId: "booking-1",
        content: "Manual note",
        userId: "user-1",
      });

      expect(result).toBe(mockNote);
      expect(db.bookingNote.create).toHaveBeenCalledWith({
        data: {
          content: "Manual note",
          type: "COMMENT",
          booking: { connect: { id: "booking-1" } },
          user: { connect: { id: "user-1" } },
        },
      } satisfies BookingNoteCreateArgs);
    });

    it("wraps errors in a ShelfError", async () => {
      const createMock = vi.mocked(db.bookingNote.create);
      createMock.mockRejectedValue(new Error("create error"));

      await expect(
        createBookingNote({
          bookingId: "booking-1",
          content: "Manual note",
          userId: "user-1",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });
  });

  describe("createSystemBookingNote", () => {
    it("creates a system booking note without a user", async () => {
      const createMock = vi.mocked(db.bookingNote.create);
      createMock.mockResolvedValue({} as never);

      await createSystemBookingNote({
        bookingId: "booking-1",
        content: "System note",
      });

      expect(db.bookingNote.create).toHaveBeenCalledWith({
        data: {
          content: "System note",
          type: "UPDATE",
          booking: { connect: { id: "booking-1" } },
        },
      } satisfies BookingNoteCreateArgs);
    });

    it("creates a system booking note and connects a user when provided", async () => {
      const createMock = vi.mocked(db.bookingNote.create);
      createMock.mockResolvedValue({} as never);

      await createSystemBookingNote({
        bookingId: "booking-1",
        content: "System note",
        userId: "user-2",
      });

      expect(db.bookingNote.create).toHaveBeenCalledWith({
        data: {
          content: "System note",
          type: "UPDATE",
          booking: { connect: { id: "booking-1" } },
          user: { connect: { id: "user-2" } },
        },
      } satisfies BookingNoteCreateArgs);
    });

    it("wraps system note creation errors in a ShelfError", async () => {
      const createMock = vi.mocked(db.bookingNote.create);
      createMock.mockRejectedValue(new Error("system note error"));

      await expect(
        createSystemBookingNote({
          bookingId: "booking-1",
          content: "System note",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });
  });

  describe("getBookingNotes", () => {
    it("returns booking notes ordered by creation date", async () => {
      const findManyMock = vi.mocked(db.bookingNote.findMany);
      const mockNotes = [
        {
          id: "note-1",
          content: "Manual",
          type: "COMMENT",
          createdAt: new Date(),
          updatedAt: new Date(),
          bookingId: "booking-1",
          userId: "user-1",
        },
      ];
      findManyMock.mockResolvedValue(mockNotes as never);

      const result = await getBookingNotes({ bookingId: "booking-1" });

      expect(result).toBe(mockNotes);
      expect(db.bookingNote.findMany).toHaveBeenCalledWith({
        where: { bookingId: "booking-1" },
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
        },
      });
    });

    it("wraps retrieval errors in a ShelfError", async () => {
      const findManyMock = vi.mocked(db.bookingNote.findMany);
      findManyMock.mockRejectedValue(new Error("find error"));

      await expect(
        getBookingNotes({ bookingId: "booking-1" })
      ).rejects.toBeInstanceOf(ShelfError);
    });
  });
});
