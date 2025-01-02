import React from "react";
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import ReactDOMServer from "react-dom/server";
import { z } from "zod";
import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import {
  fetchAllPdfRelatedData,
  generatePdfContent,
  getBookingAssetsCustomHeader,
} from "~/modules/booking/pdf-helpers";
import { getDateTimeFormat } from "~/utils/client-hints";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
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

    const pdfMeta: PdfDbResult = await fetchAllPdfRelatedData(
      bookingId,
      organizationId,
      userId,
      role
    );
    const { from, to } = pdfMeta.booking;
    if (from && to) {
      pdfMeta.from = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(from));

      pdfMeta.to = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(to));
    }

    return json(data({ pdfMeta }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw json(error(reason), { status: reason.status });
  }
};
