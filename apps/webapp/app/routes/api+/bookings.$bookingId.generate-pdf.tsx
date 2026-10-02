/**
 * Booking Checklist API
 *
 * Serves `/api/bookings/:bookingId/generate-pdf`: everything the printable
 * booking checklist renders, loaded when its preview opens. Dates are
 * formatted in the acting user's format, lapsed asset photos are re-signed so
 * every photo prints, and one `pdf_preview_opened` event is sent per preview.
 *
 * @see {@link file://./../../modules/booking/pdf-helpers.ts}
 * @see {@link file://./../../components/booking/booking-overview-pdf.tsx}
 */

import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { captureServerEvent } from "~/integrations/posthog/client.server";
import {
  ASSET_IMAGE_RESIGN_LIMITS,
  refreshExpiredAssetImages,
} from "~/modules/asset/service.server";
import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import { fetchAllPdfRelatedData } from "~/modules/booking/pdf-helpers";
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

    // Extract sorting params from URL using standard utilities
    const searchParams = getCurrentSearchParams(request);
    const paramsValues = getParamsValues(searchParams);
    // Default to "status" for booking assets (getParamsValues defaults to "createdAt" which isn't valid here)
    const orderBy =
      paramsValues.orderBy === "createdAt" ? "status" : paramsValues.orderBy;
    const orderDirection = paramsValues.orderDirection;

    const pdfMeta: PdfDbResult = await fetchAllPdfRelatedData(
      bookingId,
      organizationId,
      userId,
      role,
      request,
      { orderBy, orderDirection, search: paramsValues.search }
    );

    // Asset photos are signed URLs that stop loading once they lapse, and a
    // photo that does not load prints as the placeholder. Re-signed here, in
    // the loader of the sheet that prints photos, rather than in the shared
    // data helper: the check-in receipt reuses that helper and prints none.
    pdfMeta.assets = await refreshExpiredAssetImages(pdfMeta.assets, {
      organizationId,
      ...ASSET_IMAGE_RESIGN_LIMITS,
    });

    // Resolve the acting user's format preferences so booking PDF dates render
    // per their settings rather than the request locale.
    const prefs = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    // Preserve the existing `.format(date)` call shape used below.
    const dateTimeFormat = {
      format: (date: Date) => formatDate(date, prefs, { includeTime: true }),
    };

    const { from, to, originalFrom, originalTo } = pdfMeta.booking;
    if (from && to) {
      pdfMeta.from = dateTimeFormat.format(new Date(from));
      pdfMeta.to = dateTimeFormat.format(new Date(to));
    }

    if (originalFrom) {
      pdfMeta.originalFrom = dateTimeFormat.format(new Date(originalFrom));
    }

    if (originalTo) {
      pdfMeta.originalTo = dateTimeFormat.format(new Date(originalTo));
    }

    captureServerEvent({
      distinctId: userId,
      event: "pdf_preview_opened",
      properties: {
        sheet: "booking_checklist",
        organizationId,
        rowCount: pdfMeta.assets.length,
      },
    });

    return data(payload({ pdfMeta }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw data(error(reason), { status: reason.status });
  }
};
