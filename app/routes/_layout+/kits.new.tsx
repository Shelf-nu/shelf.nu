import { data, redirect } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import KitsForm, { NewKitFormSchema } from "~/components/kits/form";
import Header from "~/components/layout/header";
import { useSearchParams } from "~/hooks/search-params";
import {
  getCategoriesForCreateAndEdit,
  getLocationsForCreateAndEdit,
} from "~/modules/asset/service.server";
import { createKit, updateKitImage } from "~/modules/kit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { extractBarcodesFromFormData } from "~/utils/barcode-form-data.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const header = {
  title: "Untitled kit",
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.create,
    });

    const [{ categories, totalCategories }, { locations, totalLocations }] =
      await Promise.all([
        getCategoriesForCreateAndEdit({
          request,
          organizationId,
        }),
        getLocationsForCreateAndEdit({
          request,
          organizationId,
        }),
      ]);

    return payload({
      header,
      categories,
      totalCategories,
      locations,
      totalLocations,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{header.title}</span>,
};

export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const { organizationId, canUseBarcodes } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.create,
    });

    /** Here we need to clone the request as we need 2 different streams:
     * 1. Access form data for creating asset
     * 2. Access form data via upload handler to be able to upload the file
     *
     * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
     */
    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();

    const payload = parseData(formData, NewKitFormSchema);

    /** Extract barcode data from form */
    const barcodes = canUseBarcodes
      ? extractBarcodesFromFormData(formData)
      : [];

    const kit = await createKit({
      ...payload,
      description: payload.description ?? "",
      createdById: userId,
      organizationId,
      categoryId: payload.category ?? null,
      barcodes,
      locationId: payload.locationId ?? null,
    });

    await updateKitImage({
      request,
      kitId: kit.id,
      userId,
      organizationId,
    });

    sendNotification({
      title: "Kit created",
      message: "Your kit has been created successfully!",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect("/kits");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function CreateNewKit() {
  const title = useAtomValue(dynamicTitleAtom);
  const [searchParams] = useSearchParams();
  const qrId = searchParams.get("qrId");
  return (
    <>
      <Header title={title ?? "Untitled kit"} />
      <KitsForm qrId={qrId} />
    </>
  );
}
