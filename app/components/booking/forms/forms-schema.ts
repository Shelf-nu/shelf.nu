import { BookingStatus } from "@prisma/client";
import { format, parseISO } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { z } from "zod";
import type { WeeklyScheduleJson } from "~/modules/working-hours/types";
import type { getHints } from "~/utils/client-hints";

interface WorkingHoursOverride {
  id: string;
  date: string; // ISO string
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  reason: string | null;
}

interface WorkingHoursData {
  enabled: boolean;
  weeklySchedule: WeeklyScheduleJson;
  overrides: WorkingHoursOverride[];
}

type ValidationResult = { isValid: true } | { isValid: false; message: string };

/**
 * Validates if a datetime falls within working hours
 */
function validateWorkingHours(
  dateTime: Date,
  workingHours: WorkingHoursData,
  timeZone: string
): ValidationResult {
  // If working hours are disabled, all times are valid
  if (!workingHours.enabled) {
    return { isValid: true };
  }

  // Convert to user's timezone for day-of-week calculation
  const zonedDateTime = toZonedTime(dateTime, timeZone);
  const dayOfWeek = zonedDateTime.getDay().toString(); // 0 = Sunday, 1 = Monday, etc.
  const timeString = format(zonedDateTime, "HH:mm");
  const dateString = format(zonedDateTime, "yyyy-MM-dd");

  // Check for date-specific overrides first
  const override = workingHours.overrides.find((override) => {
    const overrideDate = format(parseISO(override.date), "yyyy-MM-dd");
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

    // Validate time against override hours
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

  // Validate time against regular working hours
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
 * Validates if a date is in the future
 */
function validateFutureDate(date: Date, timeZone?: string): ValidationResult {
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

  if (date <= now) {
    return { isValid: false, message: "Start date must be in the future" };
  }

  return { isValid: true };
}

interface BookingFormSchemaParams {
  hints?: ReturnType<typeof getHints>;
  action: "new" | "save" | "reserve";
  status?: BookingStatus;
  workingHours?: WorkingHoursData;
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
  workingHours,
}: BookingFormSchemaParams) {
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
  });

  // Create enhanced date schemas with working hours validation
  const createValidatedStartDateSchema = () =>
    z.coerce.date().superRefine((data, ctx) => {
      // 1. Validate future date
      const futureValidation = validateFutureDate(data, hints?.timeZone);
      if (!futureValidation.isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: futureValidation.message,
        });
        return;
      }

      // 2. Validate working hours if available
      if (workingHours && hints?.timeZone) {
        const workingHoursValidation = validateWorkingHours(
          data,
          workingHours,
          hints.timeZone
        );
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
        const validation = validateWorkingHours(
          data,
          workingHours,
          hints.timeZone
        );
        if (!validation.isValid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: validation.message,
          });
        }
      }
    });

  // Enhanced schema with date validation
  const fullSchema = baseSchema.extend({
    startDate: createValidatedStartDateSchema(),
    endDate: createValidatedEndDateSchema(),
  });

  // Schema with ID field for existing bookings
  const fullSchemaWithId = fullSchema
    .extend({ id: z.string() })
    .superRefine((data, ctx) => {
      // Cross-field validation: end date must be after start date
      if (data.endDate && data.startDate && data.endDate <= data.startDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "End date cannot be earlier than start date",
          path: ["endDate"],
        });
      }
    });

  // Return appropriate schema based on action
  switch (action) {
    case "new": {
      return fullSchema.superRefine((data, ctx) => {
        // Cross-field validation for new bookings
        if (data.endDate && data.startDate && data.endDate <= data.startDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "End date cannot be earlier than start date",
            path: ["endDate"],
          });
        }
      });
    }

    case "reserve": {
      return fullSchemaWithId;
    }

    case "save": {
      if (!status) {
        throw new Error("Status is required for save action.");
      }

      switch (status) {
        case BookingStatus.DRAFT: {
          return fullSchemaWithId;
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
