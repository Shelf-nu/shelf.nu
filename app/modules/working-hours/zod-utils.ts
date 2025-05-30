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

// Date string schema for HTML date input (YYYY-MM-DD format)
const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine((dateStr) => {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to start of day for comparison

    // Check if date is valid and not in the past
    return !isNaN(date.getTime()) && date >= today;
  }, "Date must be today or in the future");
// Flexible boolean schema that handles both form data and direct booleans
const FlexibleBooleanSchema = z.union([
  z.boolean(),
  z.string().transform((val) => val === "on" || val === "true"),
]);

// Base object schema without superRefine (so we can use .omit() and .partial())
const BaseOverrideSchema = z.object({
  // Optional for create, required for update operations
  id: z.string().cuid().optional(),
  workingHoursId: z.string().cuid().optional(), // Added by backend

  // Core fields
  isOpen: FlexibleBooleanSchema,
  date: DateStringSchema,
  openTime: z.string().optional(),
  closeTime: z.string().optional(),
  reason: z
    .string()
    .min(1, "Reason is required")
    .max(500, "Reason must be less than 500 characters")
    .trim(),
});

// Function to add validation logic to any schema
const addOverrideValidation = <T extends z.ZodRawShape>(
  schema: z.ZodObject<T>
) =>
  schema.superRefine((data, ctx) => {
    if (data.isOpen) {
      // When override is open, both times are required and must be valid
      if (!data.openTime || data.openTime.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Open time is required when override is marked as open",
          path: ["openTime"],
        });
      } else {
        const openTimeValidation = TimeStringSchema.safeParse(data.openTime);
        if (!openTimeValidation.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              openTimeValidation.error.errors[0]?.message ||
              "Invalid open time format",
            path: ["openTime"],
          });
        }
      }

      if (!data.closeTime || data.closeTime.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Close time is required when override is marked as open",
          path: ["closeTime"],
        });
      } else {
        const closeTimeValidation = TimeStringSchema.safeParse(data.closeTime);
        if (!closeTimeValidation.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              closeTimeValidation.error.errors[0]?.message ||
              "Invalid close time format",
            path: ["closeTime"],
          });
        }
      }

      // Validate time logic when both times are present and valid
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

// Main schema with validation
export const WorkingHoursOverrideSchema =
  addOverrideValidation(BaseOverrideSchema);

// Specific schemas for different use cases (derived from the base schema)
export const CreateOverrideSchema = addOverrideValidation(
  BaseOverrideSchema.omit({ id: true, workingHoursId: true })
);

export const UpdateOverrideSchema = addOverrideValidation(
  BaseOverrideSchema.partial().extend({
    id: z.string().cuid(), // Required for updates
  })
);

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

export type CreateOverrideInput = z.infer<typeof CreateOverrideSchema>;
export type UpdateOverrideInput = z.infer<typeof UpdateOverrideSchema>;
export type CreateWorkingHoursInput = z.infer<typeof CreateWorkingHoursSchema>;
export type UpdateWorkingHoursInput = z.infer<typeof UpdateWorkingHoursSchema>;
