import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import type { WeeklyScheduleForUpdate } from "./types";

const label = "Working hours";

/**
 * Ensures a default `WorkingHours` row exists for an organization and returns
 * it (with overrides).
 *
 * Idempotent and race-safe. Every caller reaches this through a check-then-create
 * ("find, create if absent") path — the authenticated layout loader cold path
 * ({@link getWorkingHoursForOrganization}), the override creator, and the admin
 * dashboard — so two concurrent first requests for the same organization can
 * otherwise race a unique-constraint violation on `WorkingHours.organizationId`
 * (the same loader-path write race hardened for booking settings).
 *
 * We `upsert` (not a bare `create`), but returning a nested relation
 * (`include`) makes Prisma **emulate** the upsert with a separate read + write
 * instead of a native atomic `INSERT … ON CONFLICT`, so a concurrent first-hit
 * can still surface `P2002`. We therefore also catch `P2002` and re-read the
 * row the winning request created — closing the race regardless of which path
 * Prisma takes.
 *
 * @param organizationId - The organization to create/fetch default hours for
 * @returns The organization's `WorkingHours` row, including its overrides
 * @throws {Error} Re-throws any non-`P2002` database error.
 */
export async function createDefaultWorkingHours(organizationId: string) {
  const defaultSchedule = getDefaultWeeklySchedule();
  const include = { overrides: { orderBy: { date: "asc" as const } } };

  try {
    return await db.workingHours.upsert({
      where: { organizationId },
      update: {},
      create: {
        organizationId,
        enabled: false,
        weeklySchedule: defaultSchedule,
      },
      include,
    });
  } catch (cause) {
    // Emulated upsert lost the create race: a concurrent request already
    // inserted the row between this call's read and its insert. The row exists
    // now, so re-read it instead of surfacing the unique-constraint error.
    if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
      return db.workingHours.findUniqueOrThrow({
        where: { organizationId },
        include,
      });
    }
    throw cause;
  }
}

export async function getWorkingHoursForOrganization(organizationId: string) {
  try {
    // First try to find existing working hours
    const existingWorkingHours = await db.workingHours.findUnique({
      where: { organizationId },
      include: {
        overrides: {
          orderBy: { date: "asc" },
        },
      },
    });

    if (existingWorkingHours) {
      return existingWorkingHours;
    }

    const newWorkingHours = await createDefaultWorkingHours(organizationId);

    return newWorkingHours;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve or create working hours configuration",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function toggleWorkingHours({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  try {
    const updatedWorkingHours = await db.workingHours.update({
      where: { organizationId },
      data: { enabled },
    });

    return updatedWorkingHours;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to toggle working hours",
      additionalData: { organizationId, enabled },
      label,
    });
  }
}

export async function updateWorkingHoursSchedule({
  organizationId,
  weeklySchedule,
}: {
  organizationId: string;
  weeklySchedule: WeeklyScheduleForUpdate;
}) {
  try {
    // Update the weekly schedule - cast to any for Prisma Json type
    await db.workingHours.update({
      where: { organizationId },
      data: {
        weeklySchedule, // Prisma Json type requires any
        updatedAt: new Date(),
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update weekly schedule",
      additionalData: { organizationId, weeklySchedule },
      label,
    });
  }
}

export async function createWorkingHoursOverride({
  organizationId,
  date,
  isOpen,
  openTime,
  closeTime,
  reason,
}: {
  organizationId: string;
  date: string; // YYYY-MM-DD format
  isOpen: boolean;
  openTime?: string; // HH:MM format
  closeTime?: string; // HH:MM format
  reason?: string;
}) {
  try {
    let workingHoursId: string;
    // First ensure working hours exist for this organization
    const workingHours = await db.workingHours.findUnique({
      where: { organizationId },
      select: { id: true },
    });
    if (!workingHours) {
      const workingHours = await createDefaultWorkingHours(organizationId);
      workingHoursId = workingHours.id;
    } else {
      workingHoursId = workingHours.id;
    }

    // Check if an override already exists for this date
    const existingOverride = await db.workingHoursOverride.findFirst({
      where: {
        workingHoursId,
        date: new Date(date),
      },
    });

    if (existingOverride) {
      throw new ShelfError({
        cause: null,
        title: "Invalid date",
        message: "An override already exists for this date",
        additionalData: { organizationId, date },
        shouldBeCaptured: false,
        label,
      });
    }

    // Create the override
    const override = await db.workingHoursOverride.create({
      data: {
        workingHoursId,
        date: new Date(date),
        isOpen,
        openTime: isOpen ? openTime : null,
        closeTime: isOpen ? closeTime : null,
        reason,
      },
    });

    return override;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Failed to create working hours override",
      additionalData: {
        organizationId,
        date,
        isOpen,
        openTime,
        closeTime,
        reason,
      },
      label,
    });
  }
}

export async function updateWorkingHoursOverride({
  overrideId,
  date,
  isOpen,
  openTime,
  closeTime,
  reason,
}: {
  overrideId: string;
  date?: string; // YYYY-MM-DD format
  isOpen: boolean;
  openTime?: string; // HH:MM format
  closeTime?: string; // HH:MM format
  reason?: string;
}) {
  try {
    const updateData: any = {
      isOpen,
      openTime: isOpen ? openTime : null,
      closeTime: isOpen ? closeTime : null,
      updatedAt: new Date(),
    };

    if (date) {
      updateData.date = new Date(date);
    }

    if (reason !== undefined) {
      updateData.reason = reason;
    }

    const updatedOverride = await db.workingHoursOverride.update({
      where: { id: overrideId },
      data: updateData,
    });

    return updatedOverride;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update working hours override",
      additionalData: { overrideId, date, isOpen, openTime, closeTime, reason },
      label,
    });
  }
}

export async function deleteWorkingHoursOverride(overrideId: string) {
  try {
    await db.workingHoursOverride.delete({
      where: { id: overrideId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to delete working hours override",
      additionalData: { overrideId },
      label,
    });
  }
}

export async function getWorkingHoursOverridesForOrganization(
  organizationId: string
) {
  try {
    const workingHours = await db.workingHours.findUnique({
      where: { organizationId },
      include: {
        overrides: {
          orderBy: { date: "asc" },
          where: {
            date: {
              gte: new Date(), // Only get future and today's overrides
            },
          },
        },
      },
    });

    return workingHours?.overrides || [];
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve working hours overrides",
      additionalData: { organizationId },
      label,
    });
  }
}

export function getDefaultWeeklySchedule(): Record<string, any> {
  return {
    "0": { isOpen: false }, // Sunday
    "1": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Monday
    "2": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Tuesday
    "3": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Wednesday
    "4": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Thursday
    "5": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Friday
    "6": { isOpen: false }, // Saturday
  };
}
