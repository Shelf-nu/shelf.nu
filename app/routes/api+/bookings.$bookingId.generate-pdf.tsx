import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import { fetchAllPdfRelatedData } from "~/modules/booking/pdf-helpers";
import { getDateTimeFormat } from "~/utils/client-hints";
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
      { orderBy, orderDirection }
    );

    const dateTimeFormat = getDateTimeFormat(request, {
      dateStyle: "short",
      timeStyle: "short",
    });

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

    return data(payload({ pdfMeta }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw data(error(reason), { status: reason.status });
  }
};
