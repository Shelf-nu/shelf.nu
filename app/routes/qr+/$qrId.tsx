import type { Organization } from "@prisma/client";
import { redirect, json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserOrganizations } from "~/modules/organization/service.server";
import { getQr } from "~/modules/qr/service.server";
import { createScan, updateScan } from "~/modules/scan/service.server";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  assertIsPost,
  payload,
  error,
  getParams,
  parseData,
} from "~/utils/http.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.isAuthenticated
    ? context.getSession()
    : { userId: "anonymous" };
  const { userId } = authSession;
  const { qrId: id } = getParams(params, z.object({ qrId: z.string() }), {
    additionalData: { userId },
  });

  try {
    /* Find the QR in the database */
    const qr = await getQr({ id });
    /**
     * If the QR doesn't exist, getQR will throw a 404
     */

    /** Record the scan in the DB using the QR id
     * if the QR doesn't exist, we still record the scan
     * and we still save the id in a field specifically for deleted QRs
     */
    const scan = await createScan({
      userAgent: request.headers.get("user-agent") as string,
      userId,
      qrId: id,
      deleted: !qr,
    });

    /**
     * Check if user is logged in.
     *  - If not, redirect to the login page, which will automatically then redirect back to here so all checks are performed again
     *  - If so, continue
     */
    if (!context.isAuthenticated) {
      return redirect(`not-logged-in?scanId=${scan.id}&redirectTo=/qr/${id}`);
    }

    /** Once the user is loged in and this loader gets re-validated,
     * we update the scan with the userId so we know which user scanned it */
    await updateScan({
      id: scan.id,
      userId,
    });

    /**
     * Does the QR code belong to any user or is it unclaimed?
     */
    if (!qr.organizationId) {
      /** We redirect to claim where we handle the linking of the code to an organization */
      return redirect(`claim?scanId=${scan.id}`);
    }

    /**
     * Does the QR code belong to LOGGED IN user's any of organizations?
     * Redirect to page to report if found.
     */
    /** There could be a case when you get removed from an organization while browsing it.
     * In this case what we do is we set the current organization to the first one in the list
     */
    const userOrganizations = await getUserOrganizations({
      userId: authSession.userId,
    });
    const organizations = userOrganizations.map((uo) => uo.organization);
    const organizationsIds = organizations.map((org) => org.id);
    const personalOrganization = organizations.find(
      (org) => org.type === "PERSONAL"
    ) as Pick<Organization, "id">;

    if (!organizationsIds.includes(qr.organizationId)) {
      return redirect(`contact-owner?scanId=${scan.id}`);
    }

    const headers = [
      setCookie(
        await setSelectedOrganizationIdCookie(
          organizationsIds.find((orgId) => orgId === qr.organizationId) ||
            personalOrganization.id
        )
      ),
    ];

    /**
     * When there is no assetId or qrId that means that the asset or kit was deleted or the Qr was generated as unlinked.
     * Here we redirect to a page where the user has the option to link to existing asset or kit create a new one.
     */
    if (!qr.assetId && !qr.kitId) {
      return redirect(`link?scanId=${scan.id}`, {
        headers,
      });
    }

    /** If its linked to an asset, redirect to the asset */
    if (qr.assetId) {
      return redirect(
        `/assets/${qr.assetId}/overview?ref=qr&scanId=${scan.id}&qrId=${qr.id}`,
        {
          headers,
        }
      );
    } else if (qr.kitId) {
      /** If its linked to a kit, redirect to the kit */
      return redirect(
        `/kits/${qr.kitId}?ref=qr&scanId=${scan.id}&qrId=${qr.id}`,
        {
          headers,
        }
      );
    } else {
      throw new ShelfError({
        cause: null,
        message:
          "Something went wrong with handling this QR code. This should not happen. Please try again or contact support.",
        label: "QR",
      });
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertIsPost(request);

    const { latitude, longitude, scanId } = parseData(
      await request.formData(),
      z.object({
        latitude: z.string(),
        longitude: z.string(),
        scanId: z.string(),
      })
    );

    /** This handles the automatic update when we have scanId formData */
    if (scanId) {
      await updateScan({
        id: scanId,
        latitude,
        longitude,
      });
    }

    return json(payload({ ok: true }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export const ErrorBoundary = () => <ErrorContent />;

export default function Qr() {
  return null;
}
