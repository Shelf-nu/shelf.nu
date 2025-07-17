import { z } from "zod";

// Time format validation regex
const TIME_FORMAT_REGEX = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

export const WorkingHoursToggleSchema = z.object({
  enableWorkingHours: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export const TagsRequiredSettingsSchema = z.object({
  tagsRequired: z
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

// Flexible boolean for form data - simplified since action converts null to undefined
const FlexibleBooleanSchema = z
  .string()
  .transform((val) => val === "on")
  .default("false");

// / Clean create override schema - focused on validation only
export const CreateOverrideFormSchema = z
  .object({
    isOpen: FlexibleBooleanSchema,
    date: z
      .string()
      .min(1, "Date is required")
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    openTime: z.string().optional(),
    closeTime: z.string().optional(),
    reason: z
      .string()
      .max(500, "Reason must be less than 500 characters")
      .trim()
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Basic date validation (timezone conversion happens in action)
    const date = new Date(data.date);
    if (isNaN(date.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid date",
        path: ["date"],
      });
    }

    if (data.isOpen) {
      // Validate times when open
      if (!data.openTime || data.openTime.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Open time is required when override is open",
          path: ["openTime"],
        });
      } else {
        const timeValidation = TimeStringSchema.safeParse(data.openTime);
        if (!timeValidation.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid open time format",
            path: ["openTime"],
          });
        }
      }

      if (!data.closeTime || data.closeTime.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Close time is required when override is open",
          path: ["closeTime"],
        });
      } else {
        const timeValidation = TimeStringSchema.safeParse(data.closeTime);
        if (!timeValidation.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid close time format",
            path: ["closeTime"],
          });
        }
      }

      // Validate time logic
      if (data.openTime && data.closeTime) {
        const openTimeValidation = TimeStringSchema.safeParse(data.openTime);
        const closeTimeValidation = TimeStringSchema.safeParse(data.closeTime);

        if (openTimeValidation.success && closeTimeValidation.success) {
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
    }
  });

export type CreateOverrideFormInput = z.infer<typeof CreateOverrideFormSchema>;

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

export type CreateWorkingHoursInput = z.infer<typeof CreateWorkingHoursSchema>;
export type UpdateWorkingHoursInput = z.infer<typeof UpdateWorkingHoursSchema>;
