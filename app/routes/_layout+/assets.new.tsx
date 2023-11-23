import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useSearchParams } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";

import { AssetForm, NewAssetFormSchema } from "~/components/assets/form";
import Header from "~/components/layout/header";

import {
  createAsset,
  createNote,
  getAllRelatedEntries,
  updateAssetMainImage,
} from "~/modules/asset";
import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { getActiveCustomFields } from "~/modules/custom-field";
import { getOrganization } from "~/modules/organization";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { assertWhetherQrBelongsToCurrentOrganization } from "~/modules/qr";
import { buildTagsSet } from "~/modules/tag";
import { assertIsPost, slugify } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import {
  extractCustomFieldValuesFromResults,
  mergedSchema,
} from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";

const title = "New Asset";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const { userId } = authSession;
  const organization = await getOrganization({ id: organizationId });
  /**
   * We need to check if the QR code passed in the URL belongs to the current org
   * This is relevant whenever the user is trying to link a new asset with an existing QR code
   * */
  await assertWhetherQrBelongsToCurrentOrganization({
    request,
    organizationId,
  });

  const { categories, tags, locations, customFields } =
    await getAllRelatedEntries({
      userId,
      organizationId,
    });

  const header = {
    title,
  };

  return json({
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
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  assertIsPost(request);

  /** Here we need to clone the request as we need 2 different streams:
   * 1. Access form data for creating asset
   * 2. Access form data via upload handler to be able to upload the file
   *
   * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
   */
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

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      {
        status: 400,
        headers: [setCookie(await commitAuthSession(request, { authSession }))],
      }
    );
  }

  const { title, description, category, qrId, newLocationId, valuation } =
    result.data;

  const customFieldsValues = extractCustomFieldValuesFromResults({
    result,
    customFieldDef: customFields,
  });

  /** This checks if tags are passed and build the  */
  const tags = buildTagsSet(result.data.tags);

  const rsp = await createAsset({
    organizationId,
    title,
    description,
    userId: authSession.userId,
    categoryId: category,
    locationId: newLocationId,
    qrId,
    tags,
    valuation,
    customFieldsValues,
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
  const { asset } = rsp;

  // Not sure how to handle this failing as the asset is already created
  await updateAssetMainImage({
    request,
    assetId: asset.id,
    userId: authSession.userId,
  });

  sendNotification({
    title: "Asset created",
    message: "Your asset has been created successfully",
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  if (asset.location) {
    await createNote({
      content: `**${asset.user.firstName} ${asset.user.lastName}** set the location of **${asset.title}** to **${asset.location.name}**`,
      type: "UPDATE",
      userId: authSession.userId,
      assetId: asset.id,
    });
  }

  return redirect(`/assets`, {
    headers: [setCookie(await commitAuthSession(request, { authSession }))],
  });
}

export default function NewAssetPage() {
  const title = useAtomValue(dynamicTitleAtom);
  const [searchParams] = useSearchParams();
  const qrId = searchParams.get("qrId");
  return (
    <>
      <Header title={title ? title : "Untitled Asset"} />
      <div>
        <AssetForm qrId={qrId} />
      </div>
    </>
  );
}
