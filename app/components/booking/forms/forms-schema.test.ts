import { addHours, addDays, subDays, addMinutes } from "date-fns";
import { describe, it, expect } from "vitest";
import { BookingFormSchema, ExtendBookingSchema } from "./forms-schema";

/**
 * These tests verify that booking time restrictions (bufferStartTime and maxBookingLength)
 * are correctly bypassed for ADMIN/OWNER users while still being enforced for BASE/SELF_SERVICE users.
 *
 * See issue: Bug: Booking time restrictions affect OWNER and ADMIN users and they shouldn't
 */

describe("BookingFormSchema - time restrictions", () => {
  const baseBookingSettings = {
    bufferStartTime: 24, // 24 hours minimum advance notice
    tagsRequired: false,
    maxBookingLength: 48, // Maximum 48 hours
    maxBookingLengthSkipClosedDays: false,
  };

  const disabledWorkingHours = {
    enabled: false,
    weeklySchedule: {},
    overrides: [],
  };

  describe("bufferStartTime restriction", () => {
    it("should enforce buffer time for BASE/SELF_SERVICE users", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: false, // BASE/SELF_SERVICE user
      });

      // Try to book starting in 1 hour (less than 24 hour buffer)
      const startDate = addHours(new Date(), 1);
      const endDate = addHours(startDate, 4);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e) => e.message);
        expect(
          errorMessages.some((msg) => msg.includes("at least 24 hour"))
        ).toBe(true);
      }
    });

    it("should bypass buffer time for ADMIN/OWNER users", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: true, // ADMIN/OWNER user
      });

      // Try to book starting in 1 hour (less than 24 hour buffer) - should be allowed for admin
      const startDate = addMinutes(new Date(), 30); // 30 minutes from now
      const endDate = addHours(startDate, 4);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(true);
    });
  });

  describe("maxBookingLength restriction", () => {
    it("should enforce max booking length for BASE/SELF_SERVICE users", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: false, // BASE/SELF_SERVICE user
      });

      // Try to create a 72-hour booking (exceeds 48 hour max)
      const startDate = addDays(new Date(), 2); // Start in 2 days to pass buffer check
      const endDate = addHours(startDate, 72);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e) => e.message);
        expect(
          errorMessages.some((msg) =>
            msg.includes("Booking duration cannot exceed 48 hours")
          )
        ).toBe(true);
      }
    });

    it("should bypass max booking length for ADMIN/OWNER users", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: true, // ADMIN/OWNER user
      });

      // Try to create a 72-hour booking (exceeds 48 hour max) - should be allowed for admin
      const startDate = addHours(new Date(), 1);
      const endDate = addHours(startDate, 72);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(true);
    });
  });

  describe("end date before start date validation", () => {
    it("should still enforce end date after start date for all users", () => {
      // This validation should apply to everyone
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: true, // Even admins should respect this
      });

      const startDate = addDays(new Date(), 1);
      const endDate = subDays(startDate, 1); // End before start

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e) => e.message);
        expect(
          errorMessages.some((msg) =>
            msg.includes("End date cannot be earlier than start date")
          )
        ).toBe(true);
      }
    });
  });

  describe("default isAdminOrOwner behavior", () => {
    it("should default to false (enforce restrictions) when isAdminOrOwner is not provided", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        // isAdminOrOwner not provided - should default to false
      });

      // Try to book starting in 1 hour (less than 24 hour buffer)
      const startDate = addHours(new Date(), 1);
      const endDate = addHours(startDate, 4);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      // Should fail because restrictions should be enforced by default
      expect(result.success).toBe(false);
    });
  });
});

describe("ExtendBookingSchema - time restrictions", () => {
  const baseBookingSettings = {
    bufferStartTime: 24, // 24 hours minimum advance notice
    maxBookingLength: 48, // Maximum 48 hours
    maxBookingLengthSkipClosedDays: false,
  };

  const disabledWorkingHours = {
    enabled: false,
    weeklySchedule: {},
    overrides: [],
  };

  describe("maxBookingLength restriction", () => {
    it("should enforce max booking length for BASE/SELF_SERVICE users", () => {
      const schema = ExtendBookingSchema({
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: false, // BASE/SELF_SERVICE user
      });

      // Original booking start date
      const startDate = new Date().toISOString();
      // Try to extend to 72 hours total (exceeds 48 hour max)
      const endDate = addHours(new Date(startDate), 72).toISOString();

      const result = schema.safeParse({
        startDate,
        endDate,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e) => e.message);
        expect(
          errorMessages.some((msg) =>
            msg.includes("Booking duration cannot exceed 48 hours")
          )
        ).toBe(true);
      }
    });

    it("should bypass max booking length for ADMIN/OWNER users", () => {
      const schema = ExtendBookingSchema({
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: true, // ADMIN/OWNER user
      });

      // Original booking start date
      const startDate = new Date().toISOString();
      // Try to extend to 72 hours total (exceeds 48 hour max) - should be allowed for admin
      const endDate = addHours(new Date(startDate), 72).toISOString();

      const result = schema.safeParse({
        startDate,
        endDate,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("default isAdminOrOwner behavior", () => {
    it("should default to false (enforce restrictions) when isAdminOrOwner is not provided", () => {
      const schema = ExtendBookingSchema({
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        // isAdminOrOwner not provided - should default to false
      });

      // Original booking start date
      const startDate = new Date().toISOString();
      // Try to extend to 72 hours total (exceeds 48 hour max)
      const endDate = addHours(new Date(startDate), 72).toISOString();

      const result = schema.safeParse({
        startDate,
        endDate,
      });

      // Should fail because restrictions should be enforced by default
      expect(result.success).toBe(false);
    });
  });
});
