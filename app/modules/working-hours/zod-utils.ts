import { z } from "zod";

// Time format validation regex
const TIME_FORMAT_REGEX = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

export const WorkingHoursToggleSchema = z.object({
  enableWorkingHours: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

// Base time string schema with proper validation
const TimeStringSchema = z
  .string()
  .regex(TIME_FORMAT_REGEX, "Time must be in HH:MM format (24-hour)")
  .refine((time) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
  }, "Invalid time value");

// Individual day schedule with conditional validation
const DayScheduleSchema = z
  .object({
    isOpen: z.boolean(),
    openTime: TimeStringSchema.optional(),
    closeTime: TimeStringSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isOpen) {
      // When day is open, both times are required
      if (!data.openTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Open time is required when day is marked as open",
          path: ["openTime"],
        });
      }
      if (!data.closeTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Close time is required when day is marked as open",
          path: ["closeTime"],
        });
      }

      // Validate time logic when both times are present
      if (data.openTime && data.closeTime) {
        const [openHours, openMinutes] = data.openTime.split(":").map(Number);
        const [closeHours, closeMinutes] = data.closeTime
          .split(":")
          .map(Number);

        const openTotalMinutes = openHours * 60 + openMinutes;
        const closeTotalMinutes = closeHours * 60 + closeMinutes;

        if (openTotalMinutes >= closeTotalMinutes) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Close time must be after open time",
            path: ["closeTime"],
          });
        }
      }
    } else {
      // When day is closed, times should not be provided (or will be ignored)
      // This is more of a data cleanup - we could optionally warn or strip these values
    }
  });

// Weekly schedule schema using dynamic approach
export const WeeklyScheduleSchema = z
  .object({
    "0": DayScheduleSchema, // Sunday
    "1": DayScheduleSchema, // Monday
    "2": DayScheduleSchema, // Tuesday
    "3": DayScheduleSchema, // Wednesday
    "4": DayScheduleSchema, // Thursday
    "5": DayScheduleSchema, // Friday
    "6": DayScheduleSchema, // Saturday
  })
  .superRefine((data, ctx) => {
    // Additional weekly validation - ensure at least one day is open
    const hasOpenDay = Object.values(data).some((day) => day.isOpen);
    if (!hasOpenDay) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one day must be marked as open",
      });
    }
  });

// Override schema for specific dates
export const WorkingHoursOverrideSchema = z
  .object({
    workingHoursId: z.string().cuid(),
    date: z.string().datetime().or(z.date()),
    isOpen: z.boolean(),
    openTime: TimeStringSchema.optional(),
    closeTime: TimeStringSchema.optional(),
    reason: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isOpen) {
      if (!data.openTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Open time is required when override day is marked as open",
          path: ["openTime"],
        });
      }
      if (!data.closeTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Close time is required when override day is marked as open",
          path: ["closeTime"],
        });
      }

      // Validate time logic for overrides too
      if (data.openTime && data.closeTime) {
        const [openHours, openMinutes] = data.openTime.split(":").map(Number);
        const [closeHours, closeMinutes] = data.closeTime
          .split(":")
          .map(Number);

        const openTotalMinutes = openHours * 60 + openMinutes;
        const closeTotalMinutes = closeHours * 60 + closeMinutes;

        if (openTotalMinutes >= closeTotalMinutes) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Close time must be after open time",
            path: ["closeTime"],
          });
        }
      }
    }
  });

// Complete working hours configuration schema
export const CreateWorkingHoursSchema = z.object({
  organizationId: z.string().cuid(),
  enabled: z.boolean(),
  weeklySchedule: WeeklyScheduleSchema,
});

export const UpdateWorkingHoursSchema = z.object({
  enabled: z.boolean().optional(),
  weeklySchedule: WeeklyScheduleSchema.optional(),
});

// Type exports for use in your application
export type WeeklyScheduleInput = z.infer<typeof WeeklyScheduleSchema>;
export type DayScheduleInput = z.infer<typeof DayScheduleSchema>;
export type WorkingHoursOverrideInput = z.infer<
  typeof WorkingHoursOverrideSchema
>;
export type CreateWorkingHoursInput = z.infer<typeof CreateWorkingHoursSchema>;
export type UpdateWorkingHoursInput = z.infer<typeof UpdateWorkingHoursSchema>;
