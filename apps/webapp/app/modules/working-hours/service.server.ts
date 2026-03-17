import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import type {
  WeeklyScheduleForUpdate,
  WorkingHoursWithOverrides,
} from "./types";

const label = "Working hours";

export async function createDefaultWorkingHours(organizationId: string) {
  const defaultSchedule = getDefaultWeeklySchedule();

  const { data: workingHours, error: whError } = await sbDb
    .from("WorkingHours")
    .insert({
      organizationId,
      enabled: false,
      weeklySchedule: defaultSchedule,
    })
    .select()
    .single();

  if (whError) throw whError;

  // Fetch overrides (will be empty for new entry)
  const { data: overrides } = await sbDb
    .from("WorkingHoursOverride")
    .select("*")
    .eq("workingHoursId", workingHours.id)
    .order("date", { ascending: true });

  return { ...workingHours, overrides: overrides ?? [] };
}

export async function getWorkingHoursForOrganization(organizationId: string) {
  try {
    // Try to find existing working hours with overrides
    const { data: existingWorkingHours, error: fetchError } = await sbDb
      .from("WorkingHours")
      .select("*, overrides:WorkingHoursOverride(*)")
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (existingWorkingHours) {
      // Cast to proper type — Supabase generated types can't resolve the
      // WorkingHours → WorkingHoursOverride relation automatically.
      const typedResult =
        existingWorkingHours as unknown as WorkingHoursWithOverrides;

      // Sort overrides by date ascending
      if (typedResult.overrides) {
        typedResult.overrides.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
      }
      return typedResult;
    }

    return await createDefaultWorkingHours(organizationId);
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
    const { data: updatedWorkingHours, error } = await sbDb
      .from("WorkingHours")
      .update({ enabled })
      .eq("organizationId", organizationId)
      .select()
      .single();

    if (error) throw error;
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
    const { error } = await sbDb
      .from("WorkingHours")
      .update({
        weeklySchedule:
          weeklySchedule as unknown as Sb.WorkingHoursUpdate["weeklySchedule"],
        updatedAt: new Date().toISOString(),
      })
      .eq("organizationId", organizationId);

    if (error) throw error;
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
    const { data: workingHours, error: whError } = await sbDb
      .from("WorkingHours")
      .select("id")
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (whError) throw whError;

    if (!workingHours) {
      const created = await createDefaultWorkingHours(organizationId);
      workingHoursId = created.id;
    } else {
      workingHoursId = workingHours.id;
    }

    // Check if an override already exists for this date
    const { data: existingOverride, error: checkError } = await sbDb
      .from("WorkingHoursOverride")
      .select("id")
      .eq("workingHoursId", workingHoursId)
      .eq("date", new Date(date).toISOString())
      .maybeSingle();

    if (checkError) throw checkError;

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
    const { data: override, error: createError } = await sbDb
      .from("WorkingHoursOverride")
      .insert({
        workingHoursId,
        date: new Date(date).toISOString(),
        isOpen,
        openTime: isOpen ? openTime ?? null : null,
        closeTime: isOpen ? closeTime ?? null : null,
        reason: reason ?? null,
      })
      .select()
      .single();

    if (createError) throw createError;
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
      openTime: isOpen ? openTime ?? null : null,
      closeTime: isOpen ? closeTime ?? null : null,
      updatedAt: new Date().toISOString(),
    };

    if (date) {
      updateData.date = new Date(date).toISOString();
    }

    if (reason !== undefined) {
      updateData.reason = reason;
    }

    const { data: updatedOverride, error } = await sbDb
      .from("WorkingHoursOverride")
      .update(updateData as Sb.WorkingHoursOverrideUpdate)
      .eq("id", overrideId)
      .select()
      .single();

    if (error) throw error;
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
    const { error } = await sbDb
      .from("WorkingHoursOverride")
      .delete()
      .eq("id", overrideId);

    if (error) throw error;
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
    const { data: workingHours, error: whError } = await sbDb
      .from("WorkingHours")
      .select("id")
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (whError) throw whError;

    if (!workingHours) return [];

    const { data: overrides, error: overridesError } = await sbDb
      .from("WorkingHoursOverride")
      .select("*")
      .eq("workingHoursId", workingHours.id)
      .gte("date", new Date().toISOString())
      .order("date", { ascending: true });

    if (overridesError) throw overridesError;
    return overrides ?? [];
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
