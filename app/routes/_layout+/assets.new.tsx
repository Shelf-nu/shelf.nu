import { OrganizationType } from "@prisma/client";
import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useSearchParams } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { titleAtom } from "~/atoms/assets.new";

import { AssetForm, NewAssetFormSchema } from "~/components/assets/form";
import Header from "~/components/layout/header";
import { db } from "~/database";

import {
  createAsset,
  createNote,
  getAllRelatedEntries,
  updateAssetMainImage,
} from "~/modules/asset";
import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { getOrganizationByUserId } from "~/modules/organization/service.server";
import { buildTagsSet } from "~/modules/tag";
import { assertIsPost, slugify } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { mergedSchema } from "~/utils/custom-field-schema";
import { sendNotification } from "~/utils/emitter/send-notification.server";

const title = "New Asset";

export async function loader({ request }: LoaderArgs) {
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

  const header = {
    title,
  };

  return json({ header, categories, tags, locations, customFields });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ request }: LoaderArgs) {
  const authSession = await requireAuthSession(request);
  assertIsPost(request);

  /** Here we need to clone the request as we need 2 different streams:
   * 1. Access form data for creating asset
   * 2. Access form data via upload handler to be able to upload the file
   *
   * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
   */
  const clonedRequest = request.clone();

  const formData = await clonedRequest.formData();

  const customFields = await db.customField.findMany({
    where: {
      userId: authSession.userId,
    },
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

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      {
        status: 400,
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  const { title, description, category, qrId, newLocationId } = result.data;
  /** This checks if tags are passed and build the  */
  const tags = buildTagsSet(result.data.tags);

  const asset = await createAsset({
    title,
    description,
    userId: authSession.userId,
    categoryId: category,
    locationId: newLocationId,
    qrId,
    tags,
  });

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
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewAssetPage() {
  const title = useAtomValue(titleAtom);
  const [searchParams] = useSearchParams();
  const qrId = searchParams.get("qrId");

  return (
    <>
      <Header title={title} />
      <div>
        <AssetForm qrId={qrId} />
      </div>
    </>
  );
}
