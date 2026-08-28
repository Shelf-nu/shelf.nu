/**
 * iCalendar (RFC 5545) helpers.
 *
 * Pure, isomorphic functions for building `.ics` output. Shared by:
 * - the per-booking "Add to calendar" download
 *   (`routes/_layout+/bookings.$bookingId.overview.cal[.ics].ts`)
 * - the subscribable workspace calendar feed
 *   (`routes/api+/calendar.feed.$token[.ics].ts`)
 *
 * @see {@link https://datatracker.ietf.org/doc/html/rfc5545}
 */
import { formatDateForICal } from "~/utils/date-fns";

/** Escapes text for ICS property values per RFC 5545 §3.3.11 */
export function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Folds a content line to 75 **octets** per RFC 5545 §3.1.
 * Continuation lines start with a single SPACE (which itself counts as
 * 1 octet of the next 75-octet chunk).
 *
 * Uses TextEncoder to measure UTF-8 byte length so multi-byte characters
 * (Thai, Chinese, emoji) are handled correctly and never split mid-sequence.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let offset = 0;
  let isFirst = true;

  while (offset < bytes.length) {
    // First line: 75 octets; continuation lines: 74 octets + 1 SPACE prefix
    const chunkSize = isFirst ? 75 : 74;
    let end = Math.min(offset + chunkSize, bytes.length);

    // Don't split in the middle of a multi-byte UTF-8 sequence.
    // UTF-8 continuation bytes have the pattern 10xxxxxx (0x80..0xBF).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }

    const chunk = new TextDecoder().decode(bytes.slice(offset, end));
    parts.push(isFirst ? chunk : " " + chunk);
    offset = end;
    isFirst = false;
  }

  return parts.join("\r\n");
}

/** Minimal booking shape needed to render a single calendar event (VEVENT). */
export type ICalBookingInput = {
  /** Booking id — used as the stable VEVENT `UID`. */
  id: string;
  /** Booking name — used as the event summary. */
  name: string;
  /** Booking start (maps to `DTSTART`). */
  from: Date;
  /** Booking end (maps to `DTEND`). */
  to: Date;
  /** Resolved custodian display name (caller falls back to e.g. "Unassigned"). */
  custodianName: string;
  /** Titles of the assets on the booking (may be empty). */
  assetTitles: string[];
  /** Absolute URL to the booking, embedded in the event body. */
  bookingUrl: string;
  /**
   * Booking's last-modified time. Used as a STABLE `DTSTAMP` so a subscribed
   * feed serializes an unchanged booking identically on every poll (using
   * `new Date()` would make every event look modified on each refresh).
   */
  updatedAt: Date;
};

/**
 * Builds the `VEVENT` lines (unfolded) for a single booking, including a
 * 1-day-before reminder alarm. Caller is responsible for folding + wrapping
 * the result in a `VCALENDAR` via {@link buildBookingICalendar}.
 *
 * @param booking - The booking event data
 * @returns Array of unfolded iCal content lines for one VEVENT
 */
export function buildBookingVEvent(booking: ICalBookingInput): string[] {
  const assetCount = booking.assetTitles.length;
  const assetLabel = assetCount === 1 ? "asset" : "assets";
  const assetList =
    assetCount > 0 ? booking.assetTitles.join(", ") : "No assets assigned";

  // Summary includes the asset count so it reads well in a calendar grid.
  const summary = escapeICalText(
    assetCount > 0
      ? `${booking.name} (${assetCount} ${assetLabel})`
      : booking.name
  );

  // The custodian line is omitted when `custodianName` is empty (the feed passes
  // "" when the subscriber isn't entitled to see custody), so we never leak
  // custody info. A single-booking download always supplies a name.
  const detailLines: string[] = [];
  if (booking.custodianName) {
    detailLines.push(`Custodian: ${booking.custodianName}`);
  }
  detailLines.push(`Assets (${assetCount}): ${assetList}`);

  const description = escapeICalText(
    `${detailLines.join("\n")}\n\nView booking: ${booking.bookingUrl}`
  );

  return [
    "BEGIN:VEVENT",
    `SUMMARY:${summary}`,
    `UID:${booking.id}`,
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    `DTSTART:${formatDateForICal(booking.from)}`,
    `DTEND:${formatDateForICal(booking.to)}`,
    // Booking-derived (not fetch time) so a subscribed feed is stable per poll.
    `DTSTAMP:${formatDateForICal(booking.updatedAt)}`,
    "CATEGORIES:Shelf.nu booking",
    `DESCRIPTION:${description}`,
    `URL:${booking.bookingUrl}`,
    "BEGIN:VALARM",
    "TRIGGER;RELATED=END:-P1D",
    "ACTION:DISPLAY",
    "DESCRIPTION:Equipment due back tomorrow",
    "END:VALARM",
    "END:VEVENT",
  ];
}

/**
 * Wraps one or more `VEVENT` blocks into a complete, folded `VCALENDAR`
 * document (CRLF-joined, lines folded to 75 octets).
 *
 * @param events - Array of VEVENT line-arrays (e.g. from {@link buildBookingVEvent})
 * @param options.calendarName - Optional display name for the calendar
 *   (`X-WR-CALNAME`), shown by Google/Apple for a subscribed feed. Omit for a
 *   single-event download so the output stays a bare booking event.
 * @returns The full `.ics` document as a string
 */
export function buildBookingICalendar(
  events: string[][],
  options?: { calendarName?: string }
): string {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Shelf.nu//Shelf Calendar 1.0//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  if (options?.calendarName) {
    header.push(`X-WR-CALNAME:${escapeICalText(options.calendarName)}`);
  }

  const lines = [...header, ...events.flat(), "END:VCALENDAR"];
  return lines.map(foldLine).join("\r\n");
}
