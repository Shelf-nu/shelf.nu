import { useMemo } from "react";
import { TagUseFor } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, redirect } from "react-router";
import { useLoaderData } from "react-router";
import { useAtomValue } from "jotai";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { AssetForm, NewAssetFormSchema } from "~/components/assets/form";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import {
  getAllEntriesForCreateAndEdit,
  getAsset,
  updateAsset,
  updateAssetMainImage,
} from "~/modules/asset/service.server";

import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { buildTagsSet } from "~/modules/tag/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { extractBarcodesFromFormData } from "~/utils/barcode-form-data.server";
import {
  extractCustomFieldValuesFromPayload,
  mergedSchema,
} from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  assertIsPost,
  payload,
  error,
  getCurrentSearchParams,
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
import { slugify } from "~/utils/slugify";

export type AssetEditLoaderData = typeof loader;

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, currentOrganization, userOrganizations } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      });

    const asset = await getAsset({
      organizationId,
      id,
      include: {
        tags: true,
        customFields: true,
        kit: {
          select: {
            id: true,
            name: true,
          },
        },
        barcodes: {
          select: {
            id: true,
            type: true,
            value: true,
          },
        },
      },
      userOrganizations,
      request,
    });

    const { categories, totalCategories, tags, locations, totalLocations } =
      await getAllEntriesForCreateAndEdit({
        request,
        organizationId,
        defaults: {
          category: asset.categoryId,
          location: asset.locationId,
        },
        tagUseFor: TagUseFor.ASSET,
      });

    const searchParams = getCurrentSearchParams(request);

    const customFields = await getActiveCustomFields({
      organizationId,
      category: searchParams.get("category") ?? asset.categoryId,
    });

    const header: HeaderData = {
      title: `Edit | ${asset.title}`,
      subHeading: asset.id,
    };

    return payload({
      asset,
      header,
      categories,
      totalCategories,
      tags,
      totalTags: tags.length,
      locations,
      totalLocations,
      currency: currentOrganization?.currency,
      customFields,
      referer: getRefererPath(request),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
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
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    assertIsPost(request);

    const { organizationId, canUseBarcodes } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();

    const searchParams = getCurrentSearchParams(request);

    const customFields = await getActiveCustomFields({
      organizationId,
      category:
        searchParams.get("category") ?? String(formData.get("category")),
    });

    const FormSchema = mergedSchema({
      baseSchema: NewAssetFormSchema,
      customFields: customFields.map((cf) => ({
        id: cf.id,
        name: slugify(cf.name),
        helpText: cf?.helpText || "",
        required: cf.required,
        type: cf.type.toLowerCase() as "text" | "number" | "date" | "boolean",
        options: cf.options,
      })),
    });

    const parsedData = parseData(formData, FormSchema, {
      additionalData: { userId, organizationId },
    });

    const customFieldsValues = extractCustomFieldValuesFromPayload({
      payload: parsedData,
      customFieldDef: customFields,
    });

    await updateAssetMainImage({
      request,
      assetId: id,
      userId: authSession.userId,
      organizationId,
    });

    const {
      title,
      description,
      category,
      newLocationId,
      currentLocationId,
      valuation,
      addAnother,
      redirectTo,
    } = parsedData;

    /** This checks if tags are passed and build the  */
    const tags = buildTagsSet(parsedData.tags);

    /** Extract barcode data from form */
    const barcodes = canUseBarcodes
      ? extractBarcodesFromFormData(formData)
      : [];

    await updateAsset({
      id,
      title,
      description,
      categoryId: category ? category : "uncategorized",
      tags,
      newLocationId,
      currentLocationId,
      userId: authSession.userId,
      customFieldsValues,
      barcodes,
      valuation,
      organizationId,
    });

    sendNotification({
      title: "Asset updated",
      message: "Your asset has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    if (addAnother) {
      return redirect(`/assets/new`);
    }

    // If redirectTo is provided, redirect back to previous page
    // Otherwise stay on current page (e.g., when opened in new tab)
    if (redirectTo) {
      return redirect(safeRedirect(redirectTo, `/assets/${id}`));
    }

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return data(error(reason), { status: reason.status });
  }
}

export default function AssetEditPage() {
  const title = useAtomValue(dynamicTitleAtom);
  const { asset, referer } = useLoaderData<typeof loader>();
  const tags = useMemo(
    () => asset.tags?.map((tag) => ({ label: tag.name, value: tag.id })) || [],
    [asset.tags]
  );

  return (
    <div className="relative">
      <Header
        title={
          <Button to={`/assets/${asset.id}`} variant={"inherit"}>
            {title !== "" ? title : asset.title}
          </Button>
        }
      />
      <div className=" items-top flex justify-between">
        <AssetForm
          id={asset.id}
          sequentialId={asset.sequentialId}
          mainImage={asset.mainImage}
          thumbnailImage={asset.thumbnailImage}
          mainImageExpiration={
            asset.mainImageExpiration
              ? new Date(asset.mainImageExpiration)
              : null
          }
          title={asset.title}
          categoryId={asset.categoryId}
          locationId={asset.locationId}
          description={asset.description}
          valuation={asset.valuation}
          tags={tags}
          barcodes={asset.barcodes}
          referer={referer}
        />
      </div>
    </div>
  );
}
