import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import * as ejs from "ejs";
import { z } from "zod";
import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import {
  fetchAllPdfRelatedData,
  generatePdfContent,
  getBookingPdfTemplateData,
  getTemplatePath,
} from "~/modules/booking/pdf-helpers";
import { makeShelfError } from "~/utils/error";

import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
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
    const template = await getTemplatePath(
      "./app/views/booking-assets-template.ejs"
    );
    const templateData = getBookingPdfTemplateData(pdfMeta);
    const htmlContent = ejs.render(template, templateData);
    const pdfBuffer = await generatePdfContent(
      htmlContent,
      templateData.headerTemplate
    );

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw json(error(reason), { status: reason.status });
  }
};
