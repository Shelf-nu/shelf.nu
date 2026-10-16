import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { USER_CONTACT_SELECT } from "./constants";

const label = "User Contact";

export async function getUserContactById(userId: string) {
  try {
    // Use upsert to ensure that we always have a user contact entry
    const userContact = await db.userContact.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
      },
      select: USER_CONTACT_SELECT,
    });
    return userContact;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve user contact information",
      additionalData: { userId },
      label,
    });
  }
}

/** A user's contact details as the team profile renders them; empty when none are stored. */
export type UserContactForDisplay = {
  phone: string | null;
  street: string | null;
  city: string | null;
  stateProvince: string | null;
  zipPostalCode: string | null;
  countryRegion: string | null;
};

/**
 * Reads a user's contact details for display. Never writes: a user with no
 * stored contact gets empty fields.
 *
 * @param userId - The user whose contact to read
 * @returns The contact fields, `null` where unset
 * @throws {ShelfError} When the read fails
 */
export async function getUserContactForDisplay(
  userId: string
): Promise<UserContactForDisplay> {
  try {
    const contact = await db.userContact.findUnique({
      where: { userId },
      select: {
        phone: true,
        street: true,
        city: true,
        stateProvince: true,
        zipPostalCode: true,
        countryRegion: true,
      },
    });
    return (
      contact ?? {
        phone: null,
        street: null,
        city: null,
        stateProvince: null,
        zipPostalCode: null,
        countryRegion: null,
      }
    );
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
    const userContact = await db.userContact.upsert({
      where: { userId },
      update: contactData,
      create: {
        userId,
        ...contactData,
      },
    });

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
