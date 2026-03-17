import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import { ShelfError } from "~/utils/error";
import { USER_CONTACT_SELECT } from "./constants";

const label = "User Contact";

/** Supabase select string matching USER_CONTACT_SELECT */
const USER_CONTACT_SELECT_STR =
  "id, userId, phone, street, city, stateProvince, zipPostalCode, countryRegion" as const;

export async function getUserContactById(userId: string) {
  try {
    // Try to find existing user contact
    const { data: existing, error: fetchError } = await sbDb
      .from("UserContact")
      .select(USER_CONTACT_SELECT_STR)
      .eq("userId", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (existing) return existing;

    // Create default entry if not found
    const { data: created, error: createError } = await sbDb
      .from("UserContact")
      .insert({ userId })
      .select(USER_CONTACT_SELECT_STR)
      .single();

    if (createError) throw createError;
    return created;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve user contact information",
      additionalData: { userId },
      label,
    });
  }
}

export type UpdateUserContactPayload = {
  userId: string;
  phone?: string;
  street?: string;
  city?: string;
  stateProvince?: string;
  zipPostalCode?: string;
  countryRegion?: string;
};

export async function updateUserContact(payload: UpdateUserContactPayload) {
  try {
    const { userId, ...contactData } = payload;

    // Use upsert to create or update contact information
    const { data: userContact, error } = await sbDb
      .from("UserContact")
      .upsert({ userId, ...contactData } as Sb.UserContactInsert, {
        onConflict: "userId",
      })
      .select()
      .single();

    if (error) throw error;
    return userContact;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update user contact information",
      additionalData: { userId: payload.userId },
      label: "User",
    });
  }
}

/**
 * Updates user contact information, filtering out empty values
 */
export async function updateUserContactInfo(
  userId: string,
  contactInfo: {
    phone?: string;
    street?: string;
    city?: string;
    stateProvince?: string;
    zipPostalCode?: string;
    countryRegion?: string;
  }
) {
  // Filter out empty strings and undefined values
  const filteredContactInfo = Object.fromEntries(
    Object.entries(contactInfo).filter(
      ([_, value]) => value && value.trim() !== ""
    )
  );

  // Only update if we have contact information to set
  if (Object.keys(filteredContactInfo).length > 0) {
    await updateUserContact({
      userId,
      ...filteredContactInfo,
    });
  }
}
