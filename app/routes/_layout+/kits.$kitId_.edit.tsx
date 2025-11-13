import { useAtomValue } from "jotai";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, redirect , useLoaderData } from "react-router";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import KitsForm, { NewKitFormSchema } from "~/components/kits/form";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import {
  getCategoriesForCreateAndEdit,
  getLocationsForCreateAndEdit,
} from "~/modules/asset/service.server";
import {
  getKit,
  updateKit,
  updateKitImage,
  updateKitLocation,
} from "~/modules/kit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { extractBarcodesFromFormData } from "~/utils/barcode-form-data.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  assertIsPost,
  payload,
  error,
  getParams,
  getRefererPath,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: {
      userId,
    },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const kit = await getKit({
      id: kitId,
      organizationId,
      userOrganizations,
      request,
      extraInclude: {
        barcodes: {
          select: {
            id: true,
            type: true,
            value: true,
          },
        },
      },
    });

    const [{ categories, totalCategories }, { locations, totalLocations }] =
      await Promise.all([
        getCategoriesForCreateAndEdit({
          organizationId,
          request,
          defaultCategory: kit?.categoryId,
        }),
        getLocationsForCreateAndEdit({
          request,
          organizationId,
          defaultLocation: kit?.locationId,
        }),
      ]);

    const header: HeaderData = {
      title: `Edit | ${kit.name}`,
      subHeading: kit.id,
    };

    return payload({
      kit,
      header,
      categories,
      totalCategories,
      locations,
      totalLocations,
      referer: getRefererPath(request),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "single",
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    assertIsPost(request);

    const { organizationId, canUseBarcodes } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();

    const parsedData = parseData(formData, NewKitFormSchema, {
      additionalData: { userId, kitId, organizationId },
    });

    /** Extract barcode data from form */
    const barcodes = canUseBarcodes
      ? extractBarcodesFromFormData(formData)
      : [];

    // Get current kit to compare location changes
    const currentKit = await getKit({
      id: kitId,
      organizationId,
      userOrganizations: [],
      request,
    });

    await Promise.all([
      updateKit({
        id: kitId,
        createdById: userId,
        name: parsedData.name,
        description: parsedData.description,
        organizationId,
        categoryId: parsedData.category ? parsedData.category : "uncategorized",
        barcodes,
        // Don't set locationId here - will be handled by updateKitLocation if changed
      }),
      updateKitImage({
        request,
        kitId,
        userId,
        organizationId,
      }),
    ]);

    // Handle location update separately to cascade to assets
    if (parsedData.locationId !== currentKit.locationId) {
      await updateKitLocation({
        id: kitId,
        organizationId,
        currentLocationId: currentKit.locationId,
        newLocationId: parsedData.locationId || "", // Handle undefined case
        userId,
      });
    }

    sendNotification({
      title: "Kit updated",
      message: "Your kit has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    // If redirectTo is provided, redirect back to previous page
    // Otherwise stay on current page (e.g., when opened in new tab)
    if (parsedData.redirectTo) {
      return redirect(safeRedirect(parsedData.redirectTo, `/kits/${kitId}`));
    }

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return data(error(reason), { status: reason.status });
  }
}

export default function KitEdit() {
  const title = useAtomValue(dynamicTitleAtom);
  const { kit, referer } = useLoaderData<typeof loader>();

  return (
    <div className="relative">
      <Header
        title={
          <Button to={`/kits/${kit.id}`} variant={"inherit"}>
            {title !== "" ? title : kit.name}
          </Button>
        }
      />

      <div className="items-top flex justify-between">
        <KitsForm
          name={kit.name}
          description={kit.description}
          categoryId={kit.categoryId}
          barcodes={kit.barcodes}
          locationId={kit?.locationId}
          referer={referer}
        />
      </div>
    </div>
  );
}
