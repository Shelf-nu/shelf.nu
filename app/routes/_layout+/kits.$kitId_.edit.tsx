import { json } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import KitsForm, { NewKitFormSchema } from "~/components/kits/form";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Button } from "~/components/shared/button";
import { getCategoriesForCreateAndEdit } from "~/modules/asset/service.server";
import {
  getKit,
  updateKit,
  updateKitImage,
} from "~/modules/kit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { extractBarcodesFromFormData } from "~/utils/barcode-form-data.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  assertIsPost,
  data,
  error,
  getParams,
  parseData,
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

    const { categories, totalCategories } = await getCategoriesForCreateAndEdit(
      {
        organizationId,
        request,
        defaultCategory: kit?.categoryId,
      }
    );

    const header: HeaderData = {
      title: `Edit | ${kit.name}`,
      subHeading: kit.id,
    };

    return json(
      data({
        kit,
        header,
        categories,
        totalCategories,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
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

    const payload = parseData(formData, NewKitFormSchema, {
      additionalData: { userId, kitId, organizationId },
    });

    /** Extract barcode data from form */
    const barcodes = canUseBarcodes
      ? extractBarcodesFromFormData(formData)
      : [];

    await Promise.all([
      updateKit({
        id: kitId,
        createdById: userId,
        name: payload.name,
        description: payload.description,
        organizationId,
        categoryId: payload.category ? payload.category : "uncategorized",
        barcodes,
      }),
      updateKitImage({
        request,
        kitId,
        userId,
        organizationId,
      }),
    ]);

    sendNotification({
      title: "Kit updated",
      message: "Your kit has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return json(error(reason), { status: reason.status });
  }
}

export default function KitEdit() {
  const title = useAtomValue(dynamicTitleAtom);
  const { kit } = useLoaderData<typeof loader>();

  return (
    <>
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
          saveButtonLabel="Save"
          barcodes={kit.barcodes}
        />
      </div>
    </>
  );
}
