import { BookingStatus } from "@prisma/client";
import { z } from "zod";
import type { getHints } from "~/utils/client-hints";

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
}: {
  hints?: ReturnType<typeof getHints>;
  action: "new" | "save" | "reserve";
  status?: BookingStatus;
}) {
  /* Base schema which is common in every case */
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

  const startDateSchema = z.coerce.date().refine(
    (data) => {
      let now;
      if (hints?.timeZone) {
        now = new Date(
          new Date().toLocaleString("en-US", {
            timeZone: hints.timeZone,
          })
        );
      } else {
        now = new Date();
      }
      return data > now;
    },
    {
      message: "Start date must be in the future",
    }
  );

  /* Complete schema with all fields */
  const fullSchema = baseSchema.extend({
    startDate: startDateSchema,
    endDate: z.coerce.date(),
  });

  /** Complete schema with id field */
  const fullSchemaWithId = fullSchema
    .extend({ id: z.string() })
    .refine(
      (data) => data.endDate && data.startDate && data.endDate > data.startDate,
      {
        message: "End date cannot be earlier than start date",
        path: ["endDate"],
      }
    );

  switch (action) {
    case "new": {
      return fullSchema.refine(
        (data) =>
          data.endDate && data.startDate && data.endDate > data.startDate,
        {
          message: "End date cannot be earlier than start date",
          path: ["endDate"],
        }
      );
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
          return baseSchema;
        }
      }
    }

    default: {
      return baseSchema;
    }
  }
}
