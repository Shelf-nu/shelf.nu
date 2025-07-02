import { TagUseFor } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect, redirectDocument } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { AssetForm, NewAssetFormSchema } from "~/components/assets/form";
import Header from "~/components/layout/header";
import { useSearchParams } from "~/hooks/search-params";
import {
  createAsset,
  getAllEntriesForCreateAndEdit,
  updateAssetMainImage,
} from "~/modules/asset/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { createNote } from "~/modules/note/service.server";
import { assertWhetherQrBelongsToCurrentOrganization } from "~/modules/qr/service.server";
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
  data,
  error,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { slugify } from "~/utils/slugify";

const title = "New asset";
const header = {
  title,
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.create,
    });
    /**
     * We need to check if the QR code passed in the URL belongs to the current org
     * This is relevant whenever the user is trying to link a new asset with an existing QR code
     * */
    await assertWhetherQrBelongsToCurrentOrganization({
      request,
      organizationId,
    });

    const { categories, totalCategories, tags, locations, totalLocations } =
      await getAllEntriesForCreateAndEdit({
        organizationId,
        request,
        tagUseFor: TagUseFor.ASSET,
      });

    const searchParams = getCurrentSearchParams(request);

    const customFields = await getActiveCustomFields({
      organizationId,
      category: searchParams.get("category"),
    });

    return json(
      data({
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
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason));
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.create,
    });

    const searchParams = getCurrentSearchParams(request);

    const customFields = await getActiveCustomFields({
      organizationId,
      category: searchParams.get("category"),
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

    /** Here we need to clone the request as we need 2 different streams:
     * 1. Access form data for creating asset
     * 2. Access form data via upload handler to be able to upload the file
     *
     * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
     */
    const clonedRequest = request.clone();

    const formData = await clonedRequest.formData();

    const payload = parseData(formData, FormSchema);

    const customFieldsValues = extractCustomFieldValuesFromPayload({
      payload,
      customFieldDef: customFields,
    });

    const {
      title,
      description,
      category,
      qrId,
      newLocationId,
      valuation,
      addAnother,
    } = payload;

    /** This checks if tags are passed and build the  */
    const tags = buildTagsSet(payload.tags);

    /** Extract barcode data from form */
    const barcodes = extractBarcodesFromFormData(formData);

    const asset = await createAsset({
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
      barcodes,
    });

    // Not sure how to handle this failing as the asset is already created
    await updateAssetMainImage({
      request,
      assetId: asset.id,
      userId: authSession.userId,
      organizationId,
      isNewAsset: true,
    });

    sendNotification({
      title: "Asset created",
      message: "Your asset has been created successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    await createNote({
      content: `Asset was created by **${asset.user.firstName?.trim()} ${asset.user.lastName?.trim()}**`,
      type: "UPDATE",
      userId: authSession.userId,
      assetId: asset.id,
    });

    if (asset.location) {
      await createNote({
        content: `**${asset.user.firstName?.trim()} ${asset.user.lastName?.trim()}** set the location of **${asset.title?.trim()}** to *[${asset.location.name.trim()}](/locations/${
          asset.location.id
        })**`,
        type: "UPDATE",
        userId: authSession.userId,
        assetId: asset.id,
      });
    }

    /** If the user used the add-another button, we reload the document to reset the form */
    if (addAnother) {
      return redirectDocument(`/assets/new?`);
    }

    return redirect(`/assets`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export default function NewAssetPage() {
  const title = useAtomValue(dynamicTitleAtom);
  const [searchParams] = useSearchParams();
  const qrId = searchParams.get("qrId");

  // Get category from URL params or use the default passed prop
  const categoryFromUrl = searchParams.get("category");

  return (
    <div className="relative">
      <Header title={title ? title : "Untitled Asset"} />
      <div>
        <AssetForm qrId={qrId} categoryId={categoryFromUrl} />
      </div>
    </div>
  );
}
