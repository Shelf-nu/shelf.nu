/**
 * Check-in Receipt API
 *
 * Serves `/api/bookings/:bookingId/generate-checkin-receipt` — everything the
 * printed check-in receipt renders, with every recorded moment already
 * formatted in the acting user's date format. Loaded by the receipt dialog in
 * the booking's Actions menu.
 *
 * Dates are resolved here rather than in the browser so the sheet prints the
 * format the workspace configured, the same way the booking checklist's loader
 * does.
 *
 * @see {@link file://./../../modules/booking/checkin-receipt.server.ts}
 * @see {@link file://./../../components/booking/booking-checkin-receipt-pdf.tsx}
 */

import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import type { CheckinReceiptView } from "~/modules/booking/checkin-receipt";
import { fetchCheckinReceiptData } from "~/modules/booking/checkin-receipt.server";
import { getClientHint } from "~/utils/client-hints";
import { formatDate } from "~/utils/date-format";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError } from "~/utils/error";
import {
  payload,
  error,
  getParams,
  getCurrentSearchParams,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const { userId } = context.getSession();
  const { bookingId } = getParams(
    params,
    z.object({
      bookingId: z.string(),
    }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId, role } = await requirePermission({
      userId: userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    // The booking page's sort, so the receipt lists rows in the order the user
    // was looking at. `getParamsValues` defaults to "createdAt", which is not a
    // booking-asset sort.
    const searchParams = getCurrentSearchParams(request);
    const paramsValues = getParamsValues(searchParams);
    const orderBy =
      paramsValues.orderBy === "createdAt" ? "status" : paramsValues.orderBy;
    const orderDirection = paramsValues.orderDirection;

    const receipt = await fetchCheckinReceiptData(
      bookingId,
      organizationId,
      userId,
      role,
      request,
      { orderBy, orderDirection }
    );

    // Resolve the acting user's format preferences so the receipt's dates
    // render per their settings rather than the request locale.
    const prefs = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );
    const printMoment = (date: Date | null) =>
      date ? formatDate(date, prefs, { includeTime: true }) : null;

    const pdfMeta: CheckinReceiptView = {
      booking: {
        id: receipt.booking.id,
        name: receipt.booking.name,
        description: receipt.booking.description,
        custodianUser: receipt.booking.custodianUser
          ? {
              displayName: receipt.booking.custodianUser.displayName,
              firstName: receipt.booking.custodianUser.firstName,
              lastName: receipt.booking.custodianUser.lastName,
              email: receipt.booking.custodianUser.email,
            }
          : null,
        custodianTeamMember: receipt.booking.custodianTeamMember
          ? { name: receipt.booking.custodianTeamMember.name }
          : null,
        tags: receipt.booking.tags.map((tag) => ({
          id: tag.id,
          name: tag.name,
        })),
      },
      organization: {
        name: receipt.organization.name,
        imageId: receipt.organization.imageId,
        updatedAt: receipt.organization.updatedAt.toISOString(),
      },
      rows: receipt.rows.map(
        ({ checkedInAt, checkedInById: _checkedInById, ...row }) => ({
          ...row,
          checkedInOn: printMoment(checkedInAt),
        })
      ),
      totals: receipt.totals,
      stamp: receipt.stamp,
      plannedFrom: printMoment(receipt.plannedFrom),
      plannedTo: printMoment(receipt.plannedTo),
      checkedOutAt: printMoment(receipt.checkedOutAt),
      checkedOutByName: receipt.checkedOutByName,
      returnedAt: printMoment(receipt.returnedAt),
      latenessNote: receipt.latenessNote,
      checkedInByNames: receipt.checkedInByNames,
    };

    return data(payload({ pdfMeta }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw data(error(reason), { status: reason.status });
  }
};
