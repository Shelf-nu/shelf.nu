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
