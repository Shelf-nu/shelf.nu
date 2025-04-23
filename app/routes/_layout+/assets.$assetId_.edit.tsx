import { useMemo } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
import {
  extractCustomFieldValuesFromPayload,
  mergedSchema,
} from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  assertIsPost,
  data,
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { slugify } from "~/utils/slugify";

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
      include: { tags: true, customFields: true },
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

    return json(
      data({
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
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw json(error(reason), { status: reason.status });
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

    const { organizationId } = await requirePermission({
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

    const payload = parseData(formData, FormSchema, {
      additionalData: { userId, organizationId },
    });

    const customFieldsValues = extractCustomFieldValuesFromPayload({
      payload,
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
    } = payload;

    /** This checks if tags are passed and build the  */
    const tags = buildTagsSet(payload.tags);

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

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return json(error(reason), { status: reason.status });
  }
}

export default function AssetEditPage() {
  const title = useAtomValue(dynamicTitleAtom);
  const { asset } = useLoaderData<typeof loader>();
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
          mainImage={asset.mainImage}
          thumbnailImage={asset.thumbnailImage}
          mainImageExpiration={String(asset.mainImageExpiration)}
          title={asset.title}
          category={asset.categoryId}
          location={asset.locationId}
          description={asset.description}
          valuation={asset.valuation}
          tags={tags}
        />
      </div>
    </div>
  );
}
