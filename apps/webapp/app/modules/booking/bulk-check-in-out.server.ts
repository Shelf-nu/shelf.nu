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
 * 2. The whole batch is refused when it holds more than
 *    `MAX_BULK_CHECK_IN_OUT_BOOKINGS` bookings, or, naming the bookings, when
 *    any booking has the wrong status, still has reserved model units with no
 *    asset assigned (check-out only), or needs a "From location" choice the
 *    list cannot ask (check-out only). Nothing is changed.
 * 3. Each booking then runs through the same `checkoutBooking` /
 *    `checkinBooking` the booking page's one-click buttons use, one at a time.
 *    Each call takes its own locked transaction, re-runs its own guards and
 *    writes the asset notes, so this module writes none of its own. A booking
 *    that fails stops the batch with its own error; the bookings before it
 *    stay checked out or in, and the error says how many.
 *
 * Dates are kept: no early-date prompt exists in bulk, so every call passes
 * `without-adjusted-date`.
 *
 * @see {@link file://./../../routes/api+/bookings.bulk-actions.ts} the route
 * @see {@link file://./../../components/booking/bulk-checkout-dialog.tsx}
 * @see {@link file://./../../components/booking/bulk-checkin-dialog.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the one-click twins
 */
import { BookingStatus } from "@prisma/client";
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
import { countUnassignedModelUnits } from "~/utils/booking-model-requests";
import type { ClientHint } from "~/utils/client-hints";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import type { RoleAccess } from "~/utils/permissions/role-access";
import type { BookingMethodProvenance } from "./checkout-method";
import { getCheckoutSourceQuestions } from "./checkout-source-location.server";
import { MAX_BULK_CHECK_IN_OUT_BOOKINGS } from "./constants";
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

  // Every booking runs in this one request, so the batch size bounds how long
  // it takes. Refused before the first write, like every other batch rule.
  if (bookings.length > MAX_BULK_CHECK_IN_OUT_BOOKINGS) {
    throw new ShelfError({
      cause: null,
      title: "Nothing was changed",
      message: `You can ${action} at most ${MAX_BULK_CHECK_IN_OUT_BOOKINGS} bookings at once, and ${bookings.length} are selected. Narrow the selection and try again. Nothing was changed.`,
      additionalData: { organizationId, selectedCount: bookings.length },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

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
 * Whether a booking whose step threw already reached `landedStatuses`.
 *
 * `checkoutBooking` and `checkinBooking` commit the status change first and
 * then run follow-up work (status note, reminder scheduling, hydration) that
 * can still throw, so a failed step does not mean an unchanged booking. A
 * failed re-read answers "no", which keeps the cautious wording.
 */
async function bookingLanded({
  bookingId,
  organizationId,
  landedStatuses,
}: {
  bookingId: Booking["id"];
  organizationId: Organization["id"];
  landedStatuses: BookingStatus[];
}): Promise<boolean> {
  const current = await db.booking
    .findFirst({
      where: { id: bookingId, organizationId },
      select: { status: true },
    })
    .catch(() => null);
  return current ? landedStatuses.includes(current.status) : false;
}

/** "1 booking" / "2 bookings", for a message. */
function countBookings(count: number): string {
  return `${count} booking${count === 1 ? "" : "s"}`;
}

/** The verb that agrees with {@link countBookings}. */
function wasOrWere(count: number): string {
  return count === 1 ? "was" : "were";
}

/**
 * Runs `step` for each booking in order and stops at the first failure.
 *
 * Each step is its own locked transaction, so the bookings before a failing
 * one stay done; the error says so, with the failing booking's own message.
 * A failing booking that already reached `landedStatuses` is counted as done,
 * since only the work after its commit failed.
 *
 * @param args.bookings - The validated selection, in processing order
 * @param args.verb - Past participle for the message ("checked out", "checked in")
 * @param args.organizationId - Scopes the status re-read after a failure
 * @param args.landedStatuses - The statuses a successful step leaves a booking in
 * @param args.step - The per-booking work
 * @throws {ShelfError} The failing booking's error, prefixed with its name and
 *   how many bookings were processed
 */
async function processOneByOne({
  bookings,
  verb,
  organizationId,
  landedStatuses,
  step,
}: {
  bookings: SelectedBooking[];
  verb: string;
  organizationId: Organization["id"];
  landedStatuses: BookingStatus[];
  /** Resolves when the booking is done; its value is unused. */
  step: (booking: SelectedBooking) => Promise<unknown>;
}): Promise<void> {
  for (const [index, booking] of bookings.entries()) {
    try {
      await step(booking);
    } catch (cause) {
      const landed = await bookingLanded({
        bookingId: booking.id,
        organizationId,
        landedStatuses,
      });
      const reason = isLikeShelfError(cause)
        ? cause.message
        : landed
        ? `Something went wrong after it was ${verb}.`
        : `Something went wrong while it was being ${verb}.`;
      const done = landed ? index + 1 : index;
      const left = bookings.length - index - 1;
      const doneWas = `${wasOrWere(done)} ${verb}`;
      const summary = landed
        ? `"${
            booking.name
          }" was ${verb}, but a step after it failed: ${reason} The ${countBookings(
            done
          )} up to and including it ${doneWas}.`
        : `"${booking.name}": ${reason} ${
            done === 0
              ? "No booking was changed."
              : `The ${countBookings(done)} before it ${doneWas}.`
          }`;
      const after =
        left === 0
          ? ""
          : ` The ${countBookings(left)} after it ${wasOrWere(
              left
            )} not touched.`;
      throw new ShelfError({
        cause,
        title: landed
          ? `"${booking.name}" was ${verb} with an error`
          : `"${booking.name}" could not be ${verb}`,
        message: `${summary}${after}`,
        additionalData: {
          bookingId: booking.id,
          processedCount: done,
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

/**
 * Checks out a selection of RESERVED bookings in one request, keeping their
 * start dates.
 *
 * Refused as a whole, before any write, when the caller is held to the
 * explicit check-out flow, when the selection is over
 * `MAX_BULK_CHECK_IN_OUT_BOOKINGS`, or when any selected booking is not
 * RESERVED, still has unassigned reserved model units, or needs a "From
 * location" choice (a pool at two or more placements), which only the booking
 * page can ask. Then each booking goes through {@link checkoutBooking} in
 * turn, which writes the same asset notes it writes for the booking page.
 *
 * @param args - See {@link BulkCheckInOutArgs}
 * @throws {ShelfError} 403 when the explicit flow is required or the selection reaches foreign bookings
 * @throws {ShelfError} 400 when the selection is too large or a selected booking cannot be checked out from the list
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

    await processOneByOne({
      bookings,
      verb: "checked out",
      organizationId,
      landedStatuses: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
      step: (selected) =>
        checkoutBooking({
          id: selected.id,
          organizationId,
          hints,
          // Bulk never asks the early-date question: the start date is kept.
          intentChoice: CheckoutIntentEnum["without-adjusted-date"],
          from: selected.from,
          to: selected.to,
          userId,
          // A refusal names other members' conflicting bookings only to a
          // caller who may see them, the same as on the booking page.
          seesAllBookings: access.bookings.seeAll,
          provenance: QUICK_WEB_PROVENANCE,
        }),
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
 * explicit check-in flow, when the selection is over
 * `MAX_BULK_CHECK_IN_OUT_BOOKINGS`, or when any selected booking is neither
 * ONGOING nor OVERDUE. Then each booking goes through {@link checkinBooking}
 * in turn, which writes the asset notes for the slices that were out.
 *
 * @param args - See {@link BulkCheckInOutArgs}
 * @throws {ShelfError} 403 when the explicit flow is required or the selection reaches foreign bookings
 * @throws {ShelfError} 400 when the selection is too large or a selected booking is not in progress
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

    await processOneByOne({
      bookings,
      verb: "checked in",
      organizationId,
      landedStatuses: [BookingStatus.COMPLETE],
      step: (selected) =>
        checkinBooking({
          id: selected.id,
          organizationId,
          hints,
          // Bulk never asks the early-date question: the end date is kept.
          intentChoice: CheckinIntentEnum["without-adjusted-date"],
          userId,
          provenance: QUICK_WEB_PROVENANCE,
        }),
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
