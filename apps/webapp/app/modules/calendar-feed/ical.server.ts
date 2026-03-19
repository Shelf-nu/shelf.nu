import type { Booking, Organization, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { formatDateForICal } from "~/utils/date-fns";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { escapeICalText, foldLine } from "~/utils/ics";

const label = "Booking";

type BookingWithRelations = Booking & {
  custodianUser: Pick<User, "firstName" | "lastName"> | null;
  custodianTeamMember: { name: string } | null;
  assets: { title: string }[];
};

/**
 * Generates a full iCalendar feed for a user's bookings in an organization.
 * Includes RESERVED, ONGOING, OVERDUE, and COMPLETE bookings.
 * DRAFT, ARCHIVED, and CANCELLED are excluded.
 */
export async function generateICalFeed({
  userId,
  organizationId,
  organizationName,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
  organizationName: string;
}): Promise<string> {
  try {
    const bookings = (await db.booking.findMany({
      where: {
        organizationId,
        OR: [
          // Bookings where the user is the custodian
          { custodianUserId: userId },
          // Bookings where the user is the creator
          { creatorId: userId },
        ],
        status: {
          in: ["RESERVED", "ONGOING", "OVERDUE", "COMPLETE"],
        },
      },
      include: {
        custodianUser: {
          select: { firstName: true, lastName: true },
        },
        custodianTeamMember: {
          select: { name: true },
        },
        assets: {
          select: { title: true },
        },
      },
      orderBy: { from: "asc" },
    })) as BookingWithRelations[];

    const calName = escapeICalText(`Shelf - ${organizationName} Bookings`);

    const headerLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Shelf.nu//Shelf Calendar Feed 1.0//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${calName}`,
      // Suggest 12-hour refresh interval
      "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
      "X-PUBLISHED-TTL:PT12H",
    ];

    const eventBlocks = bookings.map((booking) => buildVEvent(booking));

    const footerLines = ["END:VCALENDAR"];

    const allLines = [...headerLines, ...eventBlocks.flat(), ...footerLines];

    return allLines.map(foldLine).join("\r\n");
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to generate iCal feed",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

function buildVEvent(booking: BookingWithRelations): string[] {
  const custodianName =
    (booking.custodianUser
      ? `${booking.custodianUser.firstName ?? ""} ${
          booking.custodianUser.lastName ?? ""
        }`.trim()
      : null) ||
    booking.custodianTeamMember?.name ||
    "Unassigned";

  const assetCount = booking.assets.length;
  const assetLabel = assetCount === 1 ? "asset" : "assets";
  const assetList =
    assetCount > 0
      ? booking.assets.map((a) => a.title).join(", ")
      : "No assets assigned";

  const summary = escapeICalText(
    assetCount > 0
      ? `${booking.name} (${assetCount} ${assetLabel})`
      : booking.name
  );

  const bookingUrl = `${SERVER_URL}/bookings/${booking.id}`;

  const description = escapeICalText(
    `Custodian: ${custodianName}\n` +
      `Assets (${assetCount}): ${assetList}\n` +
      `Status: ${booking.status}\n\n` +
      `View booking: ${bookingUrl}`
  );

  const from = booking.from as Date;
  const to = booking.to as Date;

  return [
    "BEGIN:VEVENT",
    `UID:${booking.id}@shelf.nu`,
    `DTSTAMP:${formatDateForICal(new Date())}`,
    `DTSTART:${formatDateForICal(from)}`,
    `DTEND:${formatDateForICal(to)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `URL:${bookingUrl}`,
    `STATUS:${mapBookingStatusToIcal(booking.status)}`,
    "TRANSP:TRANSPARENT",
    "CATEGORIES:Shelf.nu booking",
    // Reminder: 1 day before checkout
    "BEGIN:VALARM",
    "TRIGGER;RELATED=END:-P1D",
    "ACTION:DISPLAY",
    "DESCRIPTION:Equipment due back tomorrow",
    "END:VALARM",
    "END:VEVENT",
  ];
}

function mapBookingStatusToIcal(
  status: string
): "CONFIRMED" | "TENTATIVE" | "CANCELLED" {
  switch (status) {
    case "RESERVED":
      return "CONFIRMED";
    case "ONGOING":
      return "CONFIRMED";
    case "OVERDUE":
      return "CONFIRMED";
    case "COMPLETE":
      return "CONFIRMED";
    case "CANCELLED":
      return "CANCELLED";
    case "DRAFT":
      return "TENTATIVE";
    default:
      return "CONFIRMED";
  }
}
