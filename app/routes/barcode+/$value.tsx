import type { Organization } from "@prisma/client";
import { redirect, data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import { getBarcodeByValue } from "~/modules/barcode/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const meta = () => [{ title: appendToMetaTitle("Barcode") }];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { value } = getParams(params, z.object({ value: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations, canUseBarcodes } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset, // Use asset permissions for barcode access
        action: PermissionAction.read,
      });

    // Check if organization has barcode permissions enabled
    if (!canUseBarcodes) {
      throw new ShelfError({
        cause: null,
        message:
          "Your workspace does not support scanning barcodes. Contact your workspace owner to activate this feature or try scanning a Shelf QR code.",
        additionalData: { value, shouldSendNotification: false },
        label: "Barcode",
        shouldBeCaptured: false,
        status: 403,
      });
    }

    /* Find the barcode in the database */
    const barcode = await getBarcodeByValue({
      value,
      organizationId,
    });

    /**
     * If the barcode doesn't exist, getBarcodeByValue will return null
     */
    if (!barcode) {
      throw new ShelfError({
        cause: null,
        title: "Barcode not found",
        message:
          "This barcode doesn't exist or it doesn't belong to your current organization.",
        additionalData: { value, shouldSendNotification: false },
        label: "Barcode",
        shouldBeCaptured: false,
      });
    }

    /**
     * Does the barcode belong to LOGGED IN user's any of organizations?
     * This check is already done by requirePermission and getBarcodeByValue
     */
    const organizations = userOrganizations.map((uo) => uo.organization);
    const organizationsIds = organizations.map((org) => org.id);
    const personalOrganization = organizations.find(
      (org) => org.type === "PERSONAL"
    ) as Pick<Organization, "id">;

    if (!organizationsIds.includes(barcode.organizationId)) {
      throw new ShelfError({
        cause: null,
        message: "You don't have permission to access this barcode.",
        additionalData: { value, shouldSendNotification: false },
        label: "Barcode",
        shouldBeCaptured: false,
      });
    }

    const headers = [
      setCookie(
        await setSelectedOrganizationIdCookie(
          organizationsIds.find((orgId) => orgId === barcode.organizationId) ||
            personalOrganization.id
        )
      ),
    ];

    /**
     * When there is no assetId or kitId that means that the barcode was created but not linked.
     * This shouldn't normally happen with our current barcode system.
     */
    if (!barcode.assetId && !barcode.kitId) {
      throw new ShelfError({
        cause: null,
        message: "This barcode is not linked to any asset or kit.",
        additionalData: { value, shouldSendNotification: false },
        label: "Barcode",
        shouldBeCaptured: false,
      });
    }

    /** If its linked to an asset, redirect to the asset */
    if (barcode.assetId) {
      return redirect(
        `/assets/${barcode.assetId}/overview?ref=barcode&barcodeValue=${value}`,
        {
          headers,
        }
      );
    } else if (barcode.kitId) {
      /** If its linked to a kit, redirect to the kit */
      return redirect(
        `/kits/${barcode.kitId}?ref=barcode&barcodeValue=${value}`,
        {
          headers,
        }
      );
    } else {
      throw new ShelfError({
        cause: null,
        message:
          "Something went wrong with handling this barcode. This should not happen. Please try again or contact support.",
        label: "Barcode",
      });
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, value });
    throw data(error(reason), { status: reason.status });
  }
}

export const ErrorBoundary = () => <ErrorContent />;

export default function BarcodeScanner() {
  return null;
}
