import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import type { WeeklyScheduleJson } from "./types";

const label = "Working hours";

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

    // Create with default schedule if it doesn't exist
    const defaultSchedule = getDefaultWeeklySchedule();

    const newWorkingHours = await db.workingHours.create({
      data: {
        organizationId,
        enabled: false,
        weeklySchedule: defaultSchedule,
      },
      include: {
        overrides: {
          orderBy: { date: "asc" },
        },
      },
    });

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
  weeklySchedule: WeeklyScheduleJson;
}) {
  try {
    // Update the weekly schedule - cast to any for Prisma Json type
    await db.workingHours.update({
      where: { organizationId },
      data: {
        weeklySchedule: weeklySchedule as any, // Prisma Json type requires any
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
    // First ensure working hours exist for this organization
    const workingHours = await getWorkingHoursForOrganization(organizationId);

    // Check if an override already exists for this date
    const existingOverride = await db.workingHoursOverride.findFirst({
      where: {
        workingHoursId: workingHours.id,
        date: new Date(date),
      },
    });

    if (existingOverride) {
      throw new ShelfError({
        cause: null,
        title: "Invalid date",
        message: "An override already exists for this date",
        additionalData: { organizationId, date },
        label,
      });
    }

    // Create the override
    const override = await db.workingHoursOverride.create({
      data: {
        workingHoursId: workingHours.id,
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

function getDefaultWeeklySchedule(): Record<string, any> {
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
