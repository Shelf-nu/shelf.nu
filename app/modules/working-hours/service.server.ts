import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import type { WorkingHoursWithOverrides } from "./types";

const label = "Working hours";

export async function getWorkingHoursForOrganization(
  organizationId: string
): WorkingHoursWithOverrides {
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
}): Promise<WorkingHoursWithOverrides> {
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
