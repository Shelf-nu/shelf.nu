import { describe, it, expect, beforeEach, vi } from "vitest";

import { db } from "~/database/db.server";
import { create, findFirst, findMany } from "~/database/query-helpers.server";

import {
  createBookingNote,
  createSystemBookingNote,
  getBookingNotes,
} from "./service.server";

// why: testing booking note service logic without executing actual database operations
vi.mock("~/database/db.server", () => ({
  db: {},
}));

// why: We need to mock database query helpers to avoid hitting the real database during tests
vi.mock("~/database/query-helpers.server");

// why: testing error handling behavior without actual ShelfError implementation
vi.mock("~/utils/error", () => ({
  ShelfError: class ShelfError extends Error {
    constructor(config: any) {
      super(config.message);
      Object.assign(this, config);
    }
  },
}));

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

      vi.mocked(create).mockResolvedValue(mockNote);

      const result = await createBookingNote({
        content: "Test note",
        type: "COMMENT",
        userId: "user-1",
        bookingId: "booking-1",
      });

      expect(create).toHaveBeenCalledWith(db, "BookingNote", {
        content: "Test note",
        type: "COMMENT",
        bookingId: "booking-1",
        userId: "user-1",
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

      vi.mocked(create).mockResolvedValue(mockNote);

      const result = await createBookingNote({
        content: "System note",
        type: "UPDATE",
        bookingId: "booking-1",
      });

      expect(create).toHaveBeenCalledWith(db, "BookingNote", {
        content: "System note",
        type: "UPDATE",
        bookingId: "booking-1",
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

      vi.mocked(create).mockResolvedValue(mockNote);

      const result = await createSystemBookingNote({
        content: "System generated note",
        bookingId: "booking-1",
      });

      expect(create).toHaveBeenCalledWith(db, "BookingNote", {
        content: "System generated note",
        type: "UPDATE",
        bookingId: "booking-1",
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

      vi.mocked(findFirst).mockResolvedValue(mockBooking);
      vi.mocked(findMany).mockResolvedValue(mockNotes);

      const result = await getBookingNotes({
        bookingId: "booking-1",
        organizationId: "org-1",
      });

      expect(findFirst).toHaveBeenCalledWith(db, "Booking", {
        where: {
          id: "booking-1",
          organizationId: "org-1",
        },
        select: "id",
      });

      expect(findMany).toHaveBeenCalledWith(db, "BookingNote", {
        where: {
          bookingId: "booking-1",
        },
        orderBy: {
          createdAt: "desc",
        },
        select: "*, user:User(id, firstName, lastName)",
      });

      expect(result).toEqual(mockNotes);
    });

    it("should throw error when booking does not exist", async () => {
      vi.mocked(findFirst).mockResolvedValue(null);

      await expect(
        getBookingNotes({
          bookingId: "booking-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow("Booking not found or access denied");
    });
  });
});
