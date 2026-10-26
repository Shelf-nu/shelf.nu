/**
 * Bulk check-out and check-in from the bookings list.
 *
 * The list's Actions menu offers "Check out" for a selection of RESERVED
 * bookings and "Check in" for a selection of ONGOING or OVERDUE bookings. Both
 * are all-or-nothing up front and sequential afterwards:
 *
 * 1. The selection is resolved the way every bulk booking action resolves it
 *    (`getBulkBookingsWhereInput`, both ownership asserts), so a restricted
 *    caller reaches only their own bookings.
 * 2. The whole batch is refused, naming the bookings, when any booking has the
 *    wrong status, still has reserved model units with no asset assigned
 *    (check-out only), or needs a "From location" choice the list cannot ask
 *    (check-out only). Nothing is changed.
 * 3. Each booking then runs through the same `checkoutBooking` /
 *    `checkinBooking` the booking page's one-click buttons use, one at a time.
 *    Each call takes its own locked transaction and re-runs its own guards. A
 *    booking that fails stops the batch with its own error; the bookings
 *    before it stay checked out or in, and the error says how many.
 *
 * Dates are kept: no early-date prompt exists in bulk, so every call passes
 * `without-adjusted-date`.
 *
 * @see {@link file://./../../routes/api+/bookings.bulk-actions.ts} the route
 * @see {@link file://./../../components/booking/bulk-checkout-dialog.tsx}
 * @see {@link file://./../../components/booking/bulk-checkin-dialog.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the one-click twins
 */
import { AssetStatus, BookingStatus } from "@prisma/client";
import type { Booking, Organization, Prisma, User } from "@prisma/client";
import type { BookingsList } from "~/components/booking/bookings-list-fields";
import { CheckinIntentEnum } from "~/components/booking/checkin-dialog";
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import { db } from "~/database/db.server";
import {
  assertQuickCheckinAllowed,
  assertQuickCheckoutAllowed,
} from "~/modules/booking-settings/explicit-checkout";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { countUnassignedModelUnits } from "~/utils/booking-model-requests";
import type { ClientHint } from "~/utils/client-hints";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import type { RoleAccess } from "~/utils/permissions/role-access";
import type { BookingMethodProvenance } from "./checkout-method";
import { getCheckoutSourceQuestions } from "./checkout-source-location.server";
import {
  assertSelectAllWithinOwnership,
  checkinBooking,
  checkoutBooking,
  getBulkBookingsWhereInput,
} from "./service.server";
import { assertBulkSelectionWithinOwnership } from "./utils.server";

const label: ErrorLabel = "Booking";

/** The bulk actions are one click on the web, like the booking header's. */
const QUICK_WEB_PROVENANCE: BookingMethodProvenance = {
  surface: "web",
  method: "quick",
};

/** What both bulk functions take: the same arguments as `bulkCancelBookings`. */
export type BulkCheckInOutArgs = {
  /** Selected booking ids, or `[ALL_SELECTED_KEY]` for select-all */
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  userId: User["id"];
  /** Client hints for the reminder scheduling and notification emails */
  hints: ClientHint;
  /** The list page's URL params, used with select-all */
  currentSearchParams?: string | null;
  /** The list a select-all stands for; `null` when the form named none, which a select-all refuses */
  list?: BookingsList | null;
  /** Caller's access, which decides whether ownership scoping applies */
  access: RoleAccess;
};

/** The columns the up-front validation reads per selected booking. */
const BULK_SELECTION_SELECT = {
  id: true,
  name: true,
  status: true,
  from: true,
  to: true,
  modelRequests: {
    select: { quantity: true, fulfilledQuantity: true, fulfilledAt: true },
  },
} satisfies Prisma.BookingSelect;

type SelectedBooking = Prisma.BookingGetPayload<{
  select: typeof BULK_SELECTION_SELECT;
}>;

/**
 * Resolves and validates the selection the way every bulk booking action does.
 *
 * @param args - The bulk call's arguments
 * @param action - Verb for the ownership refusals ("check out" or "check in")
 * @returns The selected bookings the caller may act on
 * @throws {ShelfError} 403 when the selection reaches outside the caller's own bookings
 */
async function loadBulkSelection(
  args: BulkCheckInOutArgs,
  action: string
): Promise<SelectedBooking[]> {
  const { bookingIds, organizationId, currentSearchParams, list, access } =
    args;
  const userId = args.userId;

  // Scopes to the filters the user had applied AND to the bookings they are
  // allowed to act on, so a restricted caller cannot post a foreign id.
  const where = await getBulkBookingsWhereInput({
    bookingIds,
    organizationId,
    currentSearchParams,
    list,
    access,
    userId,
  });

  const bookings = await db.booking.findMany({
    where,
    select: BULK_SELECTION_SELECT,
    orderBy: { name: "asc" },
  });

  // A foreign id is filtered out by the ownership scope above; refuse the
  // selection instead of acting on the rest and reporting success.
  assertBulkSelectionWithinOwnership({
    bookingIds,
    foundIds: bookings.map((booking) => booking.id),
    access,
    action,
  });
  await assertSelectAllWithinOwnership({
    bookingIds,
    matchedCount: bookings.length,
    organizationId,
    currentSearchParams,
    list,
    access,
    userId,
    action,
  });

  return bookings;
}

/**
 * Names bookings for a refusal: "A, B and C", at most `limit` named and the
 * rest counted, so a large selection still reads as one line.
 *
 * @param names - The booking names, in display order
 * @param limit - Most bookings to name before counting the rest
 * @returns One readable list
 */
export function listBookingNames(names: string[], limit = 5): string {
  const named = names.slice(0, limit).map((name) => `"${name}"`);
  const rest = names.length - named.length;
  const parts =
    rest > 0
      ? [...named, `${rest} more booking${rest === 1 ? "" : "s"}`]
      : named;
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Refuses the whole batch, naming the offending bookings. Nothing has been
 * changed when this throws: every check runs before the first write.
 *
 * @param args.bookings - The bookings that fail the rule
 * @param args.rule - What they fail, as the start of a sentence after the names
 * @param args.organizationId - For the error's additional data
 * @throws {ShelfError} 400, always
 */
function refuseBatch({
  bookings,
  rule,
  organizationId,
}: {
  bookings: Pick<SelectedBooking, "id" | "name">[];
  rule: string;
  organizationId: Organization["id"];
}): never {
  const plural = bookings.length === 1 ? "" : "s";
  throw new ShelfError({
    cause: null,
    title: "Nothing was changed",
    message: `${listBookingNames(
      bookings.map((booking) => booking.name)
    )} ${rule}. Deselect the booking${plural} or open ${
      plural ? "them" : "it"
    } instead. Nothing was changed.`,
    additionalData: {
      organizationId,
      bookingIds: bookings.map((booking) => booking.id),
    },
    label,
    status: 400,
    shouldBeCaptured: false,
  });
}

/**
 * Runs `step` for each booking in order and stops at the first failure.
 *
 * Each step is its own locked transaction, so the bookings before a failing
 * one stay done; the error says so, with the failing booking's own message.
 *
 * @param bookings - The validated selection, in processing order
 * @param verb - Past participle for the message ("checked out", "checked in")
 * @param step - The per-booking work
 * @throws {ShelfError} The failing booking's error, prefixed with its name and
 *   how many bookings before it were processed
 */
async function processOneByOne(
  bookings: SelectedBooking[],
  verb: string,
  step: (booking: SelectedBooking) => Promise<void>
): Promise<void> {
  for (const [index, booking] of bookings.entries()) {
    try {
      await step(booking);
    } catch (cause) {
      const reason = isLikeShelfError(cause)
        ? cause.message
        : `Something went wrong while it was being ${verb}.`;
      const done = index;
      const left = bookings.length - index - 1;
      const before =
        done === 0
          ? "No booking was changed."
          : `The ${done} booking${done === 1 ? "" : "s"} before it ${
              done === 1 ? "was" : "were"
            } ${verb}.`;
      const after =
        left === 0
          ? ""
          : ` The ${left} booking${left === 1 ? "" : "s"} after it ${
              left === 1 ? "was" : "were"
            } not touched.`;
      throw new ShelfError({
        cause,
        title: `"${booking.name}" could not be ${verb}`,
        message: `"${booking.name}": ${reason} ${before}${after}`,
        additionalData: {
          bookingId: booking.id,
          processedCount: index,
          totalCount: bookings.length,
        },
        label,
        status: isLikeShelfError(cause) ? cause.status : 500,
        shouldBeCaptured: isLikeShelfError(cause)
          ? cause.shouldBeCaptured
          : true,
      });
    }
  }
}

/** The actor's name fields, for the asset notes. */
async function loadActor(userId: User["id"]) {
  const user = await getUserByID(userId, {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
    } satisfies Prisma.UserSelect,
  });
  return wrapUserLinkForNote({ ...user, id: userId });
}

/**
 * Checks out a selection of RESERVED bookings in one request, keeping their
 * start dates.
 *
 * Refused as a whole, before any write, when the caller is held to the
 * explicit check-out flow, when any selected booking is not RESERVED, still
 * has unassigned reserved model units, or needs a "From location" choice (a
 * pool at two or more placements), which only the booking page can ask. Then
 * each booking goes through {@link checkoutBooking} in turn, with the same
 * asset note the booking page writes.
 *
 * @param args - See {@link BulkCheckInOutArgs}
 * @throws {ShelfError} 403 when the explicit flow is required or the selection reaches foreign bookings
 * @throws {ShelfError} 400 when a selected booking cannot be checked out from the list
 * @throws {ShelfError} A booking's own check-out error, naming it and how many were done
 */
export async function bulkCheckoutBookings(
  args: BulkCheckInOutArgs
): Promise<void> {
  const { organizationId, userId, hints, access } = args;

  try {
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    assertQuickCheckoutAllowed({ access, bookingSettings });

    const bookings = await loadBulkSelection(args, "check out");

    const notReserved = bookings.filter(
      (booking) => booking.status !== BookingStatus.RESERVED
    );
    if (notReserved.length > 0) {
      refuseBatch({
        bookings: notReserved,
        rule: `${
          notReserved.length === 1 ? "is" : "are"
        } not reserved, and only reserved bookings can be checked out`,
        organizationId,
      });
    }

    const withUnassignedUnits = bookings.filter(
      (booking) => countUnassignedModelUnits(booking.modelRequests) > 0
    );
    if (withUnassignedUnits.length > 0) {
      refuseBatch({
        bookings: withUnassignedUnits,
        rule: `still ${
          withUnassignedUnits.length === 1 ? "has" : "have"
        } reserved units with no asset assigned`,
        organizationId,
      });
    }

    // One booking at a time: each lookup is a handful of queries, and a
    // select-all can name a whole page, which fired at once would flood the
    // connection pool before anything is validated.
    const needingSourceChoice: SelectedBooking[] = [];
    for (const booking of bookings) {
      const questions = await getCheckoutSourceQuestions({
        organizationId,
        bookingId: booking.id,
      });
      if (questions.length > 0) needingSourceChoice.push(booking);
    }
    if (needingSourceChoice.length > 0) {
      refuseBatch({
        bookings: needingSourceChoice,
        rule: `${
          needingSourceChoice.length === 1 ? "needs" : "need"
        } a from-location choice, which only the booking page can ask`,
        organizationId,
      });
    }

    const actor = await loadActor(userId);

    await processOneByOne(bookings, "checked out", async (selected) => {
      const booking = await checkoutBooking({
        id: selected.id,
        organizationId,
        hints,
        // Bulk never asks the early-date question: the start date is kept.
        intentChoice: CheckoutIntentEnum["without-adjusted-date"],
        from: selected.from,
        to: selected.to,
        userId,
        provenance: QUICK_WEB_PROVENANCE,
      });

      const assetIds = [
        ...new Set(booking.bookingAssets.map((ba) => ba.assetId)),
      ];
      if (assetIds.length > 0) {
        await createNotes({
          content: `${actor} checked out asset with ${wrapLinkForNote(
            `/bookings/${booking.id}`,
            booking.name
          )}.`,
          type: "UPDATE",
          userId,
          assetIds,
          organizationId,
        });
      }
    });
  } catch (cause) {
    // A refusal already says what happened, title included; only an unknown
    // failure needs wrapping.
    if (isLikeShelfError(cause)) throw cause;
    throw new ShelfError({
      cause,
      message: "Something went wrong while checking out the bookings.",
      additionalData: { bookingIds: args.bookingIds, organizationId },
      label,
    });
  }
}

/**
 * Checks in a selection of ONGOING or OVERDUE bookings in one request,
 * keeping their end dates.
 *
 * Refused as a whole, before any write, when the caller is held to the
 * explicit check-in flow or when any selected booking is neither ONGOING nor
 * OVERDUE. Then each booking goes through {@link checkinBooking} in turn, with
 * the same asset note the booking page writes for the assets that were out.
 *
 * @param args - See {@link BulkCheckInOutArgs}
 * @throws {ShelfError} 403 when the explicit flow is required or the selection reaches foreign bookings
 * @throws {ShelfError} 400 when a selected booking is not in progress
 * @throws {ShelfError} A booking's own check-in error, naming it and how many were done
 */
export async function bulkCheckinBookings(
  args: BulkCheckInOutArgs
): Promise<void> {
  const { organizationId, userId, hints, access } = args;

  try {
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    assertQuickCheckinAllowed({ access, bookingSettings });

    const bookings = await loadBulkSelection(args, "check in");

    const notInProgress = bookings.filter(
      (booking) =>
        booking.status !== BookingStatus.ONGOING &&
        booking.status !== BookingStatus.OVERDUE
    );
    if (notInProgress.length > 0) {
      refuseBatch({
        bookings: notInProgress,
        rule: `${
          notInProgress.length === 1 ? "is" : "are"
        } not in progress, and only ongoing or overdue bookings can be checked in`,
        organizationId,
      });
    }

    const actor = await loadActor(userId);

    await processOneByOne(bookings, "checked in", async (selected) => {
      // Only assets that were out get a check-in note: a progressive
      // check-out can leave never-checked-out assets on the booking.
      const checkedOutAssetIds = (
        await db.asset.findMany({
          // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: check-in must cover every asset already out on the booking, archived ones included
          where: {
            bookingAssets: { some: { bookingId: selected.id } },
            organizationId,
            status: AssetStatus.CHECKED_OUT,
          },
          select: { id: true },
        })
      ).map((asset) => asset.id);

      const booking = await checkinBooking({
        id: selected.id,
        organizationId,
        hints,
        // Bulk never asks the early-date question: the end date is kept.
        intentChoice: CheckinIntentEnum["without-adjusted-date"],
        userId,
        provenance: QUICK_WEB_PROVENANCE,
      });

      if (checkedOutAssetIds.length > 0) {
        await createNotes({
          content: `${actor} checked in asset with ${wrapLinkForNote(
            `/bookings/${booking.id}`,
            booking.name
          )}.`,
          type: "UPDATE",
          userId,
          assetIds: checkedOutAssetIds,
          organizationId,
        });
      }
    });
  } catch (cause) {
    // A refusal already says what happened, title included; only an unknown
    // failure needs wrapping.
    if (isLikeShelfError(cause)) throw cause;
    throw new ShelfError({
      cause,
      message: "Something went wrong while checking in the bookings.",
      additionalData: { bookingIds: args.bookingIds, organizationId },
      label,
    });
  }
}
