import { randomBytes } from "crypto";
import type { CalendarFeed, Organization, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "Booking";

/** Generates a cryptographically secure 32-byte hex token */
function generateFeedToken(): string {
  return randomBytes(32).toString("hex");
}

export async function getCalendarFeedForOrganization({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<CalendarFeed | null> {
  try {
    return await db.calendarFeed.findUnique({
      where: {
        userId_organizationId: { userId, organizationId },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve calendar feed",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

export async function createCalendarFeed({
  userId,
  organizationId,
  name,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
  name?: string;
}): Promise<CalendarFeed> {
  try {
    const token = generateFeedToken();

    return await db.calendarFeed.upsert({
      where: {
        userId_organizationId: { userId, organizationId },
      },
      create: {
        token,
        userId,
        organizationId,
        ...(name && { name }),
      },
      update: {
        token,
        active: true,
        ...(name && { name }),
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to create calendar feed",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

export async function revokeCalendarFeed({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<void> {
  try {
    await db.calendarFeed.updateMany({
      where: { userId, organizationId },
      data: { active: false },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to revoke calendar feed",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

export async function regenerateCalendarFeed({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<CalendarFeed> {
  try {
    const token = generateFeedToken();

    return await db.calendarFeed.update({
      where: {
        userId_organizationId: { userId, organizationId },
      },
      data: { token, active: true },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to regenerate calendar feed token",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

/** Looks up a calendar feed by its public token. Returns null if not found or inactive. */
export async function getCalendarFeedByToken(token: string): Promise<
  | (CalendarFeed & {
      user: Pick<User, "id" | "firstName" | "lastName">;
      organization: Pick<Organization, "id" | "name">;
    })
  | null
> {
  try {
    return await db.calendarFeed.findFirst({
      where: { token, active: true },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
        organization: {
          select: { id: true, name: true },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to look up calendar feed",
      label,
    });
  }
}
