import { db } from "~/database/db.server";
import {
  create,
  findUnique,
  remove,
  update,
  upsert,
} from "~/database/query-helpers.server";
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
    const businessIntel = await create(db, "UserBusinessIntel", {
      userId: payload.userId,
      howDidYouHearAboutUs: payload.howDidYouHearAboutUs,
      jobTitle: payload.jobTitle,
      teamSize: payload.teamSize,
      companyName: payload.companyName,
      primaryUseCase: payload.primaryUseCase,
      currentSolution: payload.currentSolution,
      timeline: payload.timeline,
    });

    return businessIntel as unknown as UserBusinessIntel;
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
    const businessIntel = await update(db, "UserBusinessIntel", {
      where: { userId },
      data: {
        howDidYouHearAboutUs: payload.howDidYouHearAboutUs,
        jobTitle: payload.jobTitle,
        teamSize: payload.teamSize,
        companyName: payload.companyName,
        primaryUseCase: payload.primaryUseCase,
        currentSolution: payload.currentSolution,
        timeline: payload.timeline,
      },
    });

    return businessIntel as unknown as UserBusinessIntel;
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
    const businessIntel = await upsert(
      db,
      "UserBusinessIntel",
      {
        userId: payload.userId,
        howDidYouHearAboutUs: payload.howDidYouHearAboutUs,
        jobTitle: payload.jobTitle,
        teamSize: payload.teamSize,
        companyName: payload.companyName,
        primaryUseCase: payload.primaryUseCase,
        currentSolution: payload.currentSolution,
        timeline: payload.timeline,
      },
      { onConflict: "userId" }
    );

    return businessIntel as unknown as UserBusinessIntel;
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
    const businessIntel = await findUnique(db, "UserBusinessIntel", {
      where: { userId },
    });

    return businessIntel as unknown as UserBusinessIntel | null;
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
    const results = await remove(db, "UserBusinessIntel", { userId });

    if (!results || results.length === 0) {
      throw new Error("No record found to delete");
    }

    return results[0] as unknown as UserBusinessIntel;
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
