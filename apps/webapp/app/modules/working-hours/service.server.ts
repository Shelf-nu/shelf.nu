import { db } from "~/database/db.server";
import {
  create,
  findFirst,
  findMany,
  findUnique,
  remove,
  update,
} from "~/database/query-helpers.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import type { WeeklyScheduleForUpdate } from "./types";

const label = "Working hours";

export async function createDefaultWorkingHours(organizationId: string) {
  const defaultSchedule = getDefaultWeeklySchedule();

  const workingHours = await create(db, "WorkingHours", {
    organizationId,
    enabled: false,
    weeklySchedule: defaultSchedule,
  });

  // Fetch overrides (will be empty for newly created)
  const overrides = await findMany(db, "WorkingHoursOverride", {
    where: { workingHoursId: workingHours.id },
    orderBy: { date: "asc" },
  });

  return { ...workingHours, overrides };
}

export async function getWorkingHoursForOrganization(organizationId: string) {
  try {
    // First try to find existing working hours
    const existingWorkingHours = await findUnique(db, "WorkingHours", {
      where: { organizationId },
    });

    if (existingWorkingHours) {
      // Fetch overrides separately
      const overrides = await findMany(db, "WorkingHoursOverride", {
        where: { workingHoursId: existingWorkingHours.id },
        orderBy: { date: "asc" },
      });

      return { ...existingWorkingHours, overrides };
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
    const updatedWorkingHours = await update(db, "WorkingHours", {
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
    await update(db, "WorkingHours", {
      where: { organizationId },
      data: {
        weeklySchedule,
        updatedAt: new Date().toISOString(),
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
    const workingHours = await findUnique(db, "WorkingHours", {
      where: { organizationId },
      select: "id",
    });
    if (!workingHours) {
      const newWorkingHours = await createDefaultWorkingHours(organizationId);
      workingHoursId = newWorkingHours.id;
    } else {
      workingHoursId = workingHours.id;
    }

    // Check if an override already exists for this date
    const existingOverride = await findFirst(db, "WorkingHoursOverride", {
      where: {
        workingHoursId,
        date: new Date(date).toISOString(),
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
    const override = await create(db, "WorkingHoursOverride", {
      workingHoursId,
      date: new Date(date).toISOString(),
      isOpen,
      openTime: isOpen ? openTime : null,
      closeTime: isOpen ? closeTime : null,
      reason,
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
    const updateData: Record<string, unknown> = {
      isOpen,
      openTime: isOpen ? openTime : null,
      closeTime: isOpen ? closeTime : null,
      updatedAt: new Date().toISOString(),
    };

    if (date) {
      updateData.date = new Date(date).toISOString();
    }

    if (reason !== undefined) {
      updateData.reason = reason;
    }

    const updatedOverride = await update(db, "WorkingHoursOverride", {
      where: { id: overrideId },
      data: updateData as any,
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
    await remove(db, "WorkingHoursOverride", { id: overrideId });
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
    const workingHours = await findUnique(db, "WorkingHours", {
      where: { organizationId },
      select: "id",
    });

    if (!workingHours) {
      return [];
    }

    const overrides = await findMany(db, "WorkingHoursOverride", {
      where: {
        workingHoursId: workingHours.id,
        date: {
          gte: new Date().toISOString(), // Only get future and today's overrides
        },
      },
      orderBy: { date: "asc" },
    });

    return overrides;
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
