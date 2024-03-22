import type { Organization } from "@prisma/client";
import { redirect, json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { isRouteErrorResponse, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { QrNotFound } from "~/components/qr/not-found";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserOrganizations } from "~/modules/organization/service.server";
import { getQr } from "~/modules/qr/service.server";
import { createScan, updateScan } from "~/modules/scan/service.server";
import { assertIsPost, data, error, getParams } from "~/utils";
import { setCookie } from "~/utils/cookies.server";
import { ShelfError, makeShelfError } from "~/utils/error";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.isAuthenticated
    ? context.getSession()
    : { userId: "anonymous" };
  const { userId } = authSession;
  const { qrId: id } = getParams(params, z.object({ qrId: z.string() }), {
    additionalData: { userId },
  });

  /* @TODO - double check because of messy merge*/
  try {
    /* Find the QR in the database */
    const qr = await getQr(id);

    /** Record the scan in the DB using the QR id
     * if the QR doesn't exist, we still record the scan
     * and we still save the id in a field specifically for deleted QRs
     */
    const scan = await createScan({
      userAgent: request.headers.get("user-agent") as string,
      qrId: id,
      deleted: !qr,
    });

    /** If the QR doesn't exist, return a 404
     *
     * AFTER MVP: Here we have to consider a deleted User which will
     * delete all the connected QRs.
     * However, in real life there could be a physical QR code
     * that is still there. Will we allow someone to claim it?
     */
    if (!qr) {
      throw new ShelfError({
        cause: null,
        title: "QR is not found",
        message:
          "The QR you are trying to access does not exist or you do not have permission to access it.",
        additionalData: { userId, id },
        label: "QR",
        status: 404,
      });
    }

    /**
     * Check if user is logged in.
     *  - If not, redirect to the login page, which will automatically then redirect back to here so all checks are performed again
     *  - If so, continue
     */
    if (!context.isAuthenticated) {
      return redirect(`not-logged-in?scanId=${scan.id}&redirectTo=/qr/${id}`);
    }

    await updateScan({
      id: scan.id,
      userId,
    });

    /**
     * Does the QR code belong to any user.
     * SKIP FOR NOW, AFTER MVP: QR codes sold on amazon. These will be created manually somehow by us and have no
     * user assigned. We currently can't even do that because we have a unique constraint
     * on the userId within Qr in the database.
     */
    /**
     * Does the QR code belong to LOGGED IN user's any of organizations?
     * Redirect to page to report if found.
     */
    /** There could be a case when you get removed from an organization while browsing it.
     * In this case what we do is we set the current organization to the first one in the list
     */
    const userOrganizations = (
      await getUserOrganizations({
        userId: authSession.userId,
      })
    ).map((uo) => uo.organization);
    const userOrganizationIds = userOrganizations.map((org) => org.id);
    const personalOrganization = userOrganizations.find(
      (org) => org.type === "PERSONAL"
    ) as Organization;

    if (!userOrganizationIds.includes(qr.organizationId)) {
      return redirect(`contact-owner?scanId=${scan.id}`);
    }

    const headers = [
      setCookie(
        await setSelectedOrganizationIdCookie(
          userOrganizationIds.find((orgId) => orgId === qr.organizationId) ||
            personalOrganization.id
        )
      ),
    ];

    /**
     * When there is no assetId that means that the asset was deleted so the QR code is orphaned.
     * Here we redirect to a page where the user has the option to link to existing asset or create a new one.
     */
    if (!qr.assetId) {
      return redirect(`link?scanId=${scan.id}`, {
        headers,
      });
    }

    return redirect(
      `/assets/${qr.assetId}?ref=qr&scanId=${scan.id}&qrId=${qr.id}`,
      {
        headers,
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertIsPost(request);

    const formData = await request.formData();
    const latitude = formData.get("latitude") as string;
    const longitude = formData.get("longitude") as string;
    const scanId = formData.get("scanId") as string;

    await updateScan({
      id: scanId,
      latitude,
      longitude,
    });

    return json(data({ ok: true }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export function ErrorBoundary() {
  const error = useRouteError();

  /** 404 error */
  if (isRouteErrorResponse(error)) {
    return <QrNotFound />;
  }
}

export default function Qr() {
  return null;
}
