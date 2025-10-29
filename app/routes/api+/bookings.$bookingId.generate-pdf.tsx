import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import { fetchAllPdfRelatedData } from "~/modules/booking/pdf-helpers";
import { getDateTimeFormat } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
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
      role,
      request
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

    return json(payload({ pdfMeta }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw json(error(reason), { status: reason.status });
  }
};
