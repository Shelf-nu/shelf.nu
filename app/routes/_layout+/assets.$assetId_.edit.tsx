import { useMemo } from "react";
import { OrganizationType } from "@prisma/client";
import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { titleAtom } from "~/atoms/assets.new";
import { AssetForm, NewAssetFormSchema } from "~/components/assets/form";
import { ErrorBoundryComponent } from "~/components/errors";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  getAllRelatedEntries,
  getAsset,
  updateAsset,
  updateAssetMainImage,
} from "~/modules/asset";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { getActiveCustomFields } from "~/modules/custom-field";
import { getOrganizationByUserId } from "~/modules/organization/service.server";
import { buildTagsSet } from "~/modules/tag";
import { assertIsPost, getRequiredParam, slugify } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  extractCustomFieldValuesFromResults,
  mergedSchema,
} from "~/utils/custom-field-schema";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";

export async function loader({ request, params }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const organization = await getOrganizationByUserId({
    userId,
    orgType: OrganizationType.PERSONAL,
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  const { categories, tags, locations, customFields } =
    await getAllRelatedEntries({
      userId,
      organizationId: organization.id,
    });

  const id = getRequiredParam(params, "assetId");

  const asset = await getAsset({ userId, id });
  if (!asset) {
    throw new ShelfStackError({ message: "Not Found", status: 404 });
  }

  const header: HeaderData = {
    title: `Edit | ${asset.title}`,
    subHeading: asset.id,
  };

  return json({
    asset,
    header,
    categories,
    tags,
    locations,
    customFields,
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "single",
};

export async function action({ request, params }: ActionArgs) {
  assertIsPost(request);
  const authSession = await requireAuthSession(request);

  const id = getRequiredParam(params, "assetId");
  const clonedRequest = request.clone();
  const formData = await clonedRequest.formData();

  const customFields = await getActiveCustomFields({
    userId: authSession.userId,
  });

  const FormSchema = mergedSchema({
    baseSchema: NewAssetFormSchema,
    customFields: customFields.map((cf) => ({
      id: cf.id,
      name: slugify(cf.name),
      helpText: cf?.helpText || "",
      required: cf.required,
      type: cf.type.toLowerCase() as "text" | "number" | "date" | "boolean",
    })),
  });
  const result = await FormSchema.safeParseAsync(parseFormAny(formData));
  const customFieldsValues = extractCustomFieldValuesFromResults({ result });

  if (!result.success) {
    return json(
      {
        errors: result.error,
        success: false,
      },
      {
        status: 400,
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  await updateAssetMainImage({
    request,
    assetId: id,
    userId: authSession.userId,
  });

  const { title, description, category, newLocationId, currentLocationId } =
    result.data;

  /** This checks if tags are passed and build the  */
  const tags = buildTagsSet(result.data.tags);

  await updateAsset({
    id,
    title,
    description,
    categoryId: category,
    tags,
    newLocationId,
    currentLocationId,
    userId: authSession.userId,
    customFieldsValues,
  });

  sendNotification({
    title: "Asset updated",
    message: "Your asset has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/assets/${id}`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function AssetEditPage() {
  const title = useAtomValue(titleAtom);
  const hasTitle = title !== "Untitled asset";
  const { asset } = useLoaderData<typeof loader>();
  const tags = useMemo(
    () => asset.tags?.map((tag) => ({ label: tag.name, value: tag.id })) || [],
    [asset.tags]
  );

  return (
    <>
      <Header title={hasTitle ? title : asset.title} />
      <div className=" items-top flex justify-between">
        <AssetForm
          title={asset.title}
          category={asset.categoryId}
          location={asset.locationId}
          description={asset.description}
          tags={tags}
        />
      </div>
    </>
  );
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
