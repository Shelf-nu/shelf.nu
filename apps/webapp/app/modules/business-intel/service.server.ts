import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import type {
  CreateBusinessIntelPayload,
  UpdateBusinessIntelPayload,
  UserBusinessIntel,
} from "./types";

const label: ErrorLabel = "User onboarding";

/**
 * Create business intelligence record for a user
 */
export async function createBusinessIntel(
  payload: CreateBusinessIntelPayload
): Promise<UserBusinessIntel> {
  try {
    const { data, error } = await sbDb
      .from("UserBusinessIntel")
      .insert({
        userId: payload.userId,
        howDidYouHearAboutUs: payload.howDidYouHearAboutUs ?? null,
        jobTitle: payload.jobTitle ?? null,
        teamSize: payload.teamSize ?? null,
        companyName: payload.companyName ?? null,
        primaryUseCase: payload.primaryUseCase ?? null,
        currentSolution: payload.currentSolution ?? null,
        timeline: payload.timeline ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to create business intelligence record",
      message:
        "Unable to save your onboarding information. Please try again later.",
      additionalData: { userId: payload.userId },
      label,
    });
  }
}

/**
 * Update business intelligence record for a user
 */
export async function updateBusinessIntel(
  userId: string,
  payload: UpdateBusinessIntelPayload
): Promise<UserBusinessIntel> {
  try {
    const updateData: Record<string, unknown> = {};
    if (payload.howDidYouHearAboutUs !== undefined)
      updateData.howDidYouHearAboutUs = payload.howDidYouHearAboutUs;
    if (payload.jobTitle !== undefined) updateData.jobTitle = payload.jobTitle;
    if (payload.teamSize !== undefined) updateData.teamSize = payload.teamSize;
    if (payload.companyName !== undefined)
      updateData.companyName = payload.companyName;
    if (payload.primaryUseCase !== undefined)
      updateData.primaryUseCase = payload.primaryUseCase;
    if (payload.currentSolution !== undefined)
      updateData.currentSolution = payload.currentSolution;
    if (payload.timeline !== undefined) updateData.timeline = payload.timeline;

    const { data, error } = await sbDb
      .from("UserBusinessIntel")
      .update(updateData as Sb.UserBusinessIntelUpdate)
      .eq("userId", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to update business intelligence record",
      message:
        "Unable to update your onboarding information. Please try again later.",
      additionalData: { userId },
      label,
    });
  }
}

/**
 * Upsert business intelligence record for a user
 * Creates if doesn't exist, updates if exists
 */
export async function upsertBusinessIntel(
  payload: CreateBusinessIntelPayload
): Promise<UserBusinessIntel> {
  try {
    const { data, error } = await sbDb
      .from("UserBusinessIntel")
      .upsert(
        {
          userId: payload.userId,
          howDidYouHearAboutUs: payload.howDidYouHearAboutUs ?? null,
          jobTitle: payload.jobTitle ?? null,
          teamSize: payload.teamSize ?? null,
          companyName: payload.companyName ?? null,
          primaryUseCase: payload.primaryUseCase ?? null,
          currentSolution: payload.currentSolution ?? null,
          timeline: payload.timeline ?? null,
        },
        { onConflict: "userId" }
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to save business intelligence record",
      message:
        "Unable to save your onboarding information. Please try again later.",
      additionalData: { userId: payload.userId },
      label,
    });
  }
}

/**
 * Get business intelligence record by user ID
 */
export async function getBusinessIntelByUserId(
  userId: string
): Promise<UserBusinessIntel | null> {
  try {
    const { data, error } = await sbDb
      .from("UserBusinessIntel")
      .select("*")
      .eq("userId", userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to fetch business intelligence record",
      message: "Unable to retrieve your onboarding information.",
      additionalData: { userId },
      label,
    });
  }
}

/**
 * Delete business intelligence record for a user
 */
export async function deleteBusinessIntel(
  userId: string
): Promise<UserBusinessIntel> {
  try {
    const { data, error } = await sbDb
      .from("UserBusinessIntel")
      .delete()
      .eq("userId", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to delete business intelligence record",
      message: "Unable to delete your onboarding information.",
      additionalData: { userId },
      label,
    });
  }
}
