import type { Organization } from "@prisma/client";
import { ScanCodeType, ScanSource } from "@prisma/client";
import { redirect, data } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserOrganizations } from "~/modules/organization/service.server";
import { getQr } from "~/modules/qr/service.server";
import {
  recordScan,
  updateScan,
  updateScanGeolocation,
} from "~/modules/scan/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  assertIsPost,
  payload,
  error,
  getParams,
  parseData,
} from "~/utils/http.server";

export const meta = () => [{ title: appendToMetaTitle("QR code") }];

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

    /**
     * Record the scan against the asset or kit the QR points at, in its
     * workspace. A QR no workspace has claimed is not recorded: no one could
     * ever read that scan. The row's id rides the redirects below as
     * `scanId`, for the follow-up geolocation post; with no row there is no
     * `scanId`, and no post.
     */
    const scan = qr.organizationId
      ? await recordScan({
          codeType: ScanCodeType.QR,
          code: id,
          source: ScanSource.QR_LINK,
          userAgent: request.headers.get("user-agent"),
          userId,
          qrId: qr.id,
          assetId: qr.assetId,
          kitId: qr.kitId,
          organizationId: qr.organizationId,
          writeNote: true,
        })
      : null;

    /** `path` with its query, plus the recorded scan's id when there is one. */
    const withScanId = (path: string, params: Record<string, string> = {}) => {
      const search = new URLSearchParams({
        ...(scan ? { scanId: scan.id } : {}),
        ...params,
      }).toString();
      return search ? `${path}?${search}` : path;
    };

    /**
     * Check if user is logged in.
     *  - If not, redirect to the login page, which will automatically then redirect back to here so all checks are performed again
     *  - If so, continue
     */
    if (!context.isAuthenticated) {
      return redirect(withScanId("not-logged-in", { redirectTo: `/qr/${id}` }));
    }

    /** Once the user is logged in and this loader gets re-validated,
     * we update the scan with the userId so we know which user scanned it */
    if (scan) {
      await updateScan({
        id: scan.id,
        userId,
      });
    }

    /**
     * Does the QR code belong to any user or is it unclaimed?
     */
    if (!qr.organizationId) {
      /** We redirect to claim where we handle the linking of the code to an organization */
      return redirect(withScanId("claim"));
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
      return redirect(withScanId("contact-owner"));
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
      return redirect(withScanId("link"), {
        headers,
      });
    }

    /** If its linked to an asset, redirect to the asset */
    if (qr.assetId) {
      return redirect(
        withScanId(`/assets/${qr.assetId}/overview`, {
          ref: "qr",
          qrId: qr.id,
        }),
        {
          headers,
        }
      );
    } else if (qr.kitId) {
      /** If its linked to a kit, redirect to the kit */
      return redirect(
        withScanId(`/kits/${qr.kitId}`, { ref: "qr", qrId: qr.id }),
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
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    assertIsPost(request);

    // Trust-bound qrId from the URL path (NOT from form data) — used to
    // verify the supplied scanId actually belongs to this QR.
    const { qrId } = getParams(params, z.object({ qrId: z.string() }));

    const { latitude, longitude, scanId } = parseData(
      await request.formData(),
      z.object({
        latitude: z.string(),
        longitude: z.string(),
        scanId: z.string(),
      })
    );

    /**
     * This handles the automatic geolocation update when we have scanId
     * formData. SECURITY: this route is public/unauthenticated and `scanId`
     * is attacker-controlled — `updateScanGeolocation` permits the update only
     * when the scan was created within a short window AND its `qrId` matches
     * the URL path's `qrId`, so a leaked scanId alone cannot tamper.
     */
    if (scanId) {
      await updateScanGeolocation({
        scanId,
        qrId,
        latitude,
        longitude,
      });
    }

    return data(payload({ ok: true }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

export const ErrorBoundary = () => <ErrorContent />;

export default function Qr() {
  return null;
}
