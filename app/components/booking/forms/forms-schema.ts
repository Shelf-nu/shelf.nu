import type { BookingSettings } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { format, addHours, differenceInHours } from "date-fns";
import { z } from "zod";
import type { WorkingHoursData } from "~/modules/working-hours/types";
import {
  calculateBusinessHoursDuration,
  normalizeWorkingHoursForValidation,
} from "~/modules/working-hours/utils";
import type { getHints } from "~/utils/client-hints";

type ValidationResult = { isValid: true } | { isValid: false; message: string };

/**
 * Validates if a datetime falls within working hours
 */
function validateWorkingHours(
  dateTime: Date,
  workingHours: WorkingHoursData
): ValidationResult {
  // If working hours are disabled, all times are valid
  if (!workingHours.enabled) {
    return { isValid: true };
  }

  // Extract day and time directly - no timezone conversion needed
  // dateTime is already correctly parsed from user input
  const dayOfWeek = dateTime.getDay().toString(); // 0 = Sunday, 1 = Monday, etc.
  const timeString = format(dateTime, "HH:mm");
  const dateString = format(dateTime, "yyyy-MM-dd");

  // Check for date-specific overrides first
  const override = workingHours.overrides.find((override) => {
    const overrideDate = format(override.date, "yyyy-MM-dd");
    return overrideDate === dateString;
  });

  if (override) {
    if (!override.isOpen) {
      return {
        isValid: false,
        message: `This date is closed${
          override.reason ? ` (${override.reason})` : ""
        }`,
      };
    }

    // Validate time against override hours (absolute comparison)
    if (override.openTime && override.closeTime) {
      if (timeString < override.openTime || timeString > override.closeTime) {
        return {
          isValid: false,
          message: `Time must be between ${override.openTime} and ${override.closeTime}`,
        };
      }
    }

    return { isValid: true };
  }

  // Check regular weekly schedule
  const daySchedule = workingHours.weeklySchedule[dayOfWeek];

  if (!daySchedule || !daySchedule.isOpen) {
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ] as const;
    return {
      isValid: false,
      message: `${dayNames[parseInt(dayOfWeek)]} is not a working day`,
    };
  }

  // Validate time against regular working hours (absolute comparison)
  if (daySchedule.openTime && daySchedule.closeTime) {
    if (
      timeString < daySchedule.openTime ||
      timeString > daySchedule.closeTime
    ) {
      return {
        isValid: false,
        message: `Time must be between ${daySchedule.openTime} and ${daySchedule.closeTime}`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Validates if a date is in the future with buffer time
 */
function validateFutureDate(
  date: Date,
  bufferStartTime: number,
  timeZone?: string
): ValidationResult {
  let now: Date;
  if (timeZone) {
    now = new Date(
      new Date().toLocaleString("en-US", {
        timeZone,
      })
    );
  } else {
    now = new Date();
  }

  // Only apply buffer if bufferStartTime is greater than 0
  const hasBuffer = bufferStartTime > 0;
  const minimumTime = hasBuffer ? addHours(now, bufferStartTime) : now;

  if (date <= minimumTime) {
    if (hasBuffer) {
      return {
        isValid: false,
        message: `Start date must be at least ${bufferStartTime} hour${
          bufferStartTime !== 1 ? "s" : ""
        } from now`,
      };
    } else {
      return { isValid: false, message: "Start date must be in the future" };
    }
  }

  return { isValid: true };
}

interface BookingFormSchemaParams {
  hints?: ReturnType<typeof getHints>;
  action: "new" | "save" | "reserve";
  status?: BookingStatus;
  workingHours: any; // Accept any type, normalize internally
  bookingSettings: {
    bufferStartTime: number; // Required buffer parameter
    tagsRequired: boolean; // Whether tags are required for bookings
    maxBookingLength: number | null; // Maximum booking length in hours
    maxBookingLengthSkipClosedDays: boolean; // Whether to skip closed days in max booking length calculation
  };
}

/**
 * Returns a Zod validation schema for the booking form based on the action and booking status.
 *
 * Validation logic depends on two factors: the booking `status` and the `action` being performed.
 *
 * - Action: "new"
 *   - All fields are updated.
 *
 * - Action: "save"
 *   - If status is "DRAFT":
 *     - All fields are updated.
 *   - If status is "RESERVED", "ONGOING", or "OVERDUE":
 *     - Only `name` and `description` are updated.
 *
 * - Action: "reserve"
 *   - All fields are updated.
 *
 * - Other actions:
 *   - No relevant fields are updated.
 *   - Only base-level validation applies.
 */
export function BookingFormSchema({
  hints,
  action,
  status,
  workingHours: rawWorkingHours,
  bookingSettings,
}: BookingFormSchemaParams) {
  const {
    bufferStartTime,
    tagsRequired,
    maxBookingLength,
    maxBookingLengthSkipClosedDays,
  } = bookingSettings;
  // Transform and validate working hours data
  const workingHours = normalizeWorkingHoursForValidation(rawWorkingHours);

  // Base schema - let TypeScript infer the complex Zod types
  const baseSchema = z.object({
    name: z.string().min(2, "Name is required"),
    assetIds: z.array(z.string()).optional(),
    description: z.string().optional(),
    custodian: z
      .string()
      .transform((val, ctx) => {
        if (!val && val === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Please select a custodian",
          });
          return z.NEVER;
        }
        return JSON.parse(val);
      })
      .pipe(
        z.object({
          id: z.string(),
          name: z.string(),
          userId: z.string().optional().nullable(),
        })
      ),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    tags: tagsRequired
      ? z.string().min(1, "At least one tag is required")
      : z.string().optional(),
  });

  // Create enhanced date schemas with working hours and buffer validation
  const createValidatedStartDateSchema = () =>
    z.coerce.date().superRefine((data, ctx) => {
      // 1. Validate future date with buffer
      const futureValidation = validateFutureDate(
        data,
        bufferStartTime,
        hints?.timeZone
      );
      if (!futureValidation.isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: futureValidation.message,
        });
        return;
      }

      // 2. Validate working hours if available
      if (workingHours && hints?.timeZone) {
        const workingHoursValidation = validateWorkingHours(data, workingHours);
        if (!workingHoursValidation.isValid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: workingHoursValidation.message,
          });
        }
      }
    });

  const createValidatedEndDateSchema = () =>
    z.coerce.date().superRefine((data, ctx) => {
      // Only validate working hours for end date (no future date requirement)
      if (workingHours && hints?.timeZone) {
        const validation = validateWorkingHours(data, workingHours);
        if (!validation.isValid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: validation.message,
          });
        }
      }
    });

  const crossFieldDateValidation = (data: any, ctx: z.RefinementCtx) => {
    if (data.endDate && data.startDate && data.endDate <= data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date cannot be earlier than start date",
        path: ["endDate"],
      });
    }

    // Validate maximum booking length if configured
    if (maxBookingLength && data.endDate && data.startDate) {
      const startDate = new Date(data.startDate);
      const endDate = new Date(data.endDate);

      let durationInHours: number;

      if (maxBookingLengthSkipClosedDays && workingHours?.enabled) {
        // When skipping closed days, calculate only the business hours duration
        durationInHours = calculateBusinessHoursDuration(
          startDate,
          endDate,
          workingHours
        );
      } else {
        // Standard calendar hours calculation
        durationInHours = differenceInHours(endDate, startDate);
      }

      if (durationInHours > maxBookingLength) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Booking duration cannot exceed ${maxBookingLength} hours`,
          path: ["endDate"],
        });
      }
    }
  };

  // Enhanced schema with date validation
  const fullSchema = baseSchema.extend({
    startDate: createValidatedStartDateSchema(),
    endDate: createValidatedEndDateSchema(),
  });

  // Schema with ID field for existing bookings
  const fullSchemaWithId = fullSchema.extend({ id: z.string() });

  // Return appropriate schema based on action
  switch (action) {
    case "new": {
      return fullSchema.superRefine(crossFieldDateValidation);
    }

    case "reserve": {
      return fullSchemaWithId.superRefine(crossFieldDateValidation);
    }

    case "save": {
      if (!status) {
        throw new Error("Status is required for save action.");
      }

      switch (status) {
        case BookingStatus.DRAFT: {
          return fullSchemaWithId.superRefine(crossFieldDateValidation);
        }

        case BookingStatus.RESERVED:
        case BookingStatus.ONGOING:
        case BookingStatus.OVERDUE: {
          // Only basic fields can be updated for active bookings
          return baseSchema;
        }
      }
    }

    default: {
      return baseSchema;
    }
  }
}

export type BookingFormSchemaType = ReturnType<typeof BookingFormSchema>;

interface ExtendBookingSchemaParams {
  workingHours?: any;
  timeZone?: string;
  bookingSettings: Pick<
    BookingSettings,
    "bufferStartTime" | "maxBookingLength" | "maxBookingLengthSkipClosedDays"
  >;
}

export function ExtendBookingSchema({
  workingHours: rawWorkingHours,
  timeZone,
  bookingSettings,
}: ExtendBookingSchemaParams) {
  const { bufferStartTime, maxBookingLength, maxBookingLengthSkipClosedDays } =
    bookingSettings;
  // Transform and validate working hours data (same as BookingFormSchema)
  const workingHours = normalizeWorkingHoursForValidation(rawWorkingHours);

  return z
    .object({
      startDate: z.string(), // Hidden field with booking start date
      endDate: z.string().superRefine((dateString, ctx) => {
        // Convert string to Date for validation purposes
        const dateTime = new Date(dateString);

        if (isNaN(dateTime.getTime())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid date format",
          });
          return;
        }

        // 1. Validate future date with buffer using existing function
        const futureValidation = validateFutureDate(
          dateTime,
          bufferStartTime,
          timeZone
        );
        if (!futureValidation.isValid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: futureValidation.message,
          });
          return;
        }

        // 2. Validate working hours using existing function
        if (workingHours) {
          const workingHoursValidation = validateWorkingHours(
            dateTime,
            workingHours
          );
          if (!workingHoursValidation.isValid) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: workingHoursValidation.message,
            });
          }
        }
      }),
    })
    .superRefine((data, ctx) => {
      // Cross-field validation for maximum booking length
      if (maxBookingLength && data.startDate && data.endDate) {
        const startDate = new Date(data.startDate);
        const endDate = new Date(data.endDate);

        let durationInHours: number;

        if (maxBookingLengthSkipClosedDays && workingHours?.enabled) {
          // When skipping closed days, calculate only the business hours duration
          durationInHours = calculateBusinessHoursDuration(
            startDate,
            endDate,
            workingHours
          );
        } else {
          // Standard calendar hours calculation
          durationInHours = differenceInHours(endDate, startDate);
        }

        if (durationInHours > maxBookingLength) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Booking duration cannot exceed ${maxBookingLength} hours`,
            path: ["endDate"],
          });
        }
      }
    });
}

export type ExtendBookingSchemaType = ReturnType<typeof ExtendBookingSchema>;
