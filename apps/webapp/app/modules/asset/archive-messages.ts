/**
 * Archive Messages
 *
 * The success messages for archiving and reinstating assets, single and bulk.
 * Pure, so both routes word the same outcome the same way and the wording is
 * tested without a request.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.tsx} single archive
 * @see {@link file://./../../routes/api+/assets.bulk-archive.ts} bulk archive
 */

/** A draft booking that still holds an archived asset. */
type DraftBooking = { id: string; name: string };

/** How many draft bookings a message names before summarising the rest. */
const NAMED_DRAFTS = 2;

/**
 * The sentence that tells the archiver a draft still holds what they archived.
 * The draft can't be reserved until the asset is removed or reinstated, and
 * its owner would otherwise find out only at Reserve.
 *
 * @param drafts - Draft bookings holding the archived assets
 * @param count - How many assets were archived, for "it" or "they"
 * @returns A leading-space sentence, or "" when no draft holds them
 */
export function draftBookingsNote(drafts: DraftBooking[], count = 1): string {
  if (drafts.length === 0) return "";

  const subject = count === 1 ? "It is" : "Some are";
  const them = count === 1 ? "it is" : "they are";
  const named = drafts.slice(0, NAMED_DRAFTS).map((d) => `"${d.name}"`);
  const rest = drafts.length - named.length;
  const list =
    rest > 0 ? `${named.join(", ")} and ${rest} more` : named.join(" and ");

  return drafts.length === 1
    ? ` ${subject} still in the draft booking ${list}, which can't be reserved until ${them} removed.`
    : ` ${subject} still in ${drafts.length} draft bookings (${list}), which can't be reserved until ${them} removed.`;
}

/**
 * Title, message and tone for a bulk archive or reinstate.
 *
 * A run that changed nothing is not a success, so it does not get the green
 * "archived" toast: it says nothing changed and why rows are skipped.
 *
 * @param args.action - "archive" or "reinstate"
 * @param args.changed - Assets archived or reinstated by this run
 * @param args.skipped - Selected assets left as they were
 * @param args.draftBookings - Drafts holding the archived assets (archive only)
 */
export function bulkArchiveResultMessage({
  action,
  changed,
  skipped,
  draftBookings = [],
}: {
  action: "archive" | "reinstate";
  changed: number;
  skipped: number;
  draftBookings?: DraftBooking[];
}): { title: string; message: string; success: boolean } {
  const verb = action === "archive" ? "archived" : "reinstated";
  const skipReason =
    action === "archive"
      ? "checked out, in custody, in a reserved or checked-out booking, quantity-tracked, or already archived"
      : "not archived, or in a kit that is in custody or checked out";

  if (changed === 0) {
    return {
      title: `Nothing ${verb}`,
      message: `None of the ${skipped} selected ${
        skipped === 1 ? "asset" : "assets"
      } could be ${verb} (${skipReason}).`,
      success: false,
    };
  }

  const counts =
    skipped > 0
      ? `${changed} ${verb}, ${skipped} skipped (${skipReason}).`
      : `${changed} ${changed === 1 ? "asset" : "assets"} ${verb}.`;

  return {
    title: action === "archive" ? "Assets archived" : "Assets reinstated",
    message: `${counts}${
      action === "archive" ? draftBookingsNote(draftBookings, changed) : ""
    }`,
    success: true,
  };
}
