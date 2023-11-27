import { useMemo } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
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
import { getOrganization } from "~/modules/organization";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { buildTagsSet } from "~/modules/tag";
import { assertIsPost, getRequiredParam, slugify } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import {
  extractCustomFieldValuesFromResults,
  mergedSchema,
} from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const organization = await getOrganization({ id: organizationId });
  const { userId } = authSession;

  const { categories, tags, locations, customFields } =
    await getAllRelatedEntries({
      userId,
      organizationId,
    });

  const id = getRequiredParam(params, "assetId");

  const asset = await getAsset({ organizationId, id });
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
    currency: organization?.currency,
    customFields,
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "single",
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);

  const id = getRequiredParam(params, "assetId");
  const clonedRequest = request.clone();
  const formData = await clonedRequest.formData();

  const customFields = await getActiveCustomFields({
    organizationId,
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
  const result = await FormSchema.safeParseAsync(parseFormAny(formData));
  const customFieldsValues = extractCustomFieldValuesFromResults({
    result,
    customFieldDef: customFields,
  });

  if (!result.success) {
    return json(
      {
        errors: result.error,
        success: false,
      },
      {
        status: 400,
        headers: [setCookie(await commitAuthSession(request, { authSession }))],
      }
    );
  }

  await updateAssetMainImage({
    request,
    assetId: id,
    userId: authSession.userId,
  });

  const {
    title,
    description,
    category,
    newLocationId,
    currentLocationId,
    valuation,
  } = result.data;

  /** This checks if tags are passed and build the  */
  const tags = buildTagsSet(result.data.tags);

  const rsp = await updateAsset({
    id,
    title,
    description,
    categoryId: category,
    tags,
    newLocationId,
    currentLocationId,
    userId: authSession.userId,
    customFieldsValues,
    valuation,
  });

  if (rsp.error) {
    return json(
      {
        errors: {
          title: rsp.error,
        },
      },
      {
        status: 400,
        headers: [setCookie(await commitAuthSession(request, { authSession }))],
      }
    );
  }

  sendNotification({
    title: "Asset updated",
    message: "Your asset has been updated successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  return redirect(`/assets/${id}`, {
    headers: [setCookie(await commitAuthSession(request, { authSession }))],
  });
}

export default function AssetEditPage() {
  const title = useAtomValue(dynamicTitleAtom);
  const hasTitle = title !== "";
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
          valuation={asset.valuation}
          tags={tags}
        />
      </div>
    </>
  );
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
