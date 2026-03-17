import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import { ShelfError } from "~/utils/error";

const label = "Booking";

/**
 * BOOKING ACTIVITY LOG SERVICE
 *
 * This service manages booking activity logs similar to the asset notes system.
 *
 * ARCHITECTURE:
 * - BookingNote model mirrors the existing Note model structure
 * - Supports two note types: COMMENT (manual user notes) and UPDATE (system-generated activity)
 * - Organization isolation via booking relationship
 * - Indexed on bookingId and userId for efficient queries
 *
 * SECURITY:
 * - Notes are scoped to organization via booking relationship
 * - Only note creators can delete their manual notes
 * - System-generated notes cannot be deleted (userId is null)
 * - All operations require proper permissions (bookingNote.read/create)
 *
 * ACTIVITY TRACKING:
 * - Status changes (DRAFT→RESERVED, cancellation, archival)
 * - Detail updates (name, description, dates, custodian changes)
 * - Asset management (additions, removals)
 * - Check-in/check-out operations (full and partial)
 *
 * MESSAGE FORMAT:
 * - System messages use markdown formatting for consistency
 * - Links to related entities: **[Booking Name](/bookings/id)**
 * - Bold text for emphasis: **User Name**, **Asset Count**
 */

/**
 * Creates a singular booking note (manual or system-generated)
 *
 * @param content - The note content (supports markdown)
 * @param type - "COMMENT" for manual notes, "UPDATE" for system activity
 * @param userId - User ID for manual notes, undefined for system notes
 * @param bookingId - Booking ID to associate the note with
 */
export async function createBookingNote({
  content,
  type,
  userId,
  bookingId,
}: {
  content: string;
  type?: Sb.NoteType;
  userId?: string;
  bookingId: string;
}) {
  try {
    const insertData: Record<string, unknown> = {
      content,
      type: type || "COMMENT",
      bookingId,
    };

    if (userId) {
      insertData.userId = userId;
    }

    const { data, error } = await sbDb
      .from("BookingNote")
      .insert(insertData as Sb.BookingNoteInsert)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a booking note",
      additionalData: { type, userId, bookingId },
      label,
    });
  }
}

/**
 * Creates a system-generated booking note for automatic activity tracking
 *
 * This is a convenience wrapper around createBookingNote that:
 * - Sets type to "UPDATE" for system activities
 * - Omits userId (system notes are not attributed to users)
 * - Used by booking service functions to log automatic activities
 *
 * @param content - Activity description with markdown formatting
 * @param bookingId - Booking ID to log activity for
 */
export function createSystemBookingNote({
  content,
  bookingId,
}: {
  content: string;
  bookingId: string;
}) {
  return createBookingNote({
    content,
    type: "UPDATE",
    bookingId,
  });
}

/**
 * Gets booking notes for a specific booking with security validation
 *
 * SECURITY CHECKS:
 * - Validates booking exists in the specified organization
 * - Returns notes ordered by creation date (desc) for recent-first display
 * - Includes user information for manual notes (excludes system notes)
 *
 * PERFORMANCE:
 * - Uses indexed query on bookingId for efficiency
 * - Selective loading (called only when activity tab is accessed)
 *
 * @param bookingId - Booking ID to get notes for
 * @param organizationId - Organization ID for security validation
 * @returns Array of booking notes with user information
 */
export async function getBookingNotes({
  bookingId,
  organizationId,
}: {
  bookingId: string;
  organizationId: string;
}) {
  try {
    // First verify the booking belongs to the organization
    const { data: booking, error: bookingError } = await sbDb
      .from("Booking")
      .select("id")
      .eq("id", bookingId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (bookingError) throw bookingError;

    if (!booking) {
      throw new ShelfError({
        cause: null,
        message: "Booking not found or access denied",
        additionalData: { bookingId, organizationId },
        label,
        shouldBeCaptured: false,
      });
    }

    const { data: notes, error: notesError } = await sbDb
      .from("BookingNote")
      .select("*, user:User(id, firstName, lastName)")
      .eq("bookingId", bookingId)
      .order("createdAt", { ascending: false });

    if (notesError) throw notesError;
    return notes ?? [];
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching booking notes",
      additionalData: { bookingId, organizationId },
      label,
    });
  }
}

/**
 * Deletes a booking note with user authorization
 *
 * SECURITY:
 * - Users can only delete their own manual notes
 * - System-generated notes cannot be deleted (userId is null)
 * - Uses delete with userId filter for additional security
 *
 * @param id - Note ID to delete
 * @param userId - User ID (must match note creator)
 * @returns Delete operation result
 */
export async function deleteBookingNote({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    const { error, count } = await sbDb
      .from("BookingNote")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("userId", userId);

    if (error) throw error;
    return { count: count ?? 0 };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the booking note",
      additionalData: { id, userId },
      label,
    });
  }
}
