import { json, redirect } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";

import { useAtomValue } from "jotai";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import KitsForm, { NewKitFormSchema } from "~/components/kits/form";
import Header from "~/components/layout/header";
import { createKit, updateKitImage } from "~/modules/kit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

const header = {
  title: "Untitled kit",
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.create,
    });
    return json(
      data({
        header,
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
  breadcrumb: () => <span>{header.title}</span>,
};

export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
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

    const kit = await createKit({
      ...payload,
      description: payload.description ?? "",
      createdById: userId,
      organizationId,
    });

    await updateKitImage({
      request,
      kitId: kit.id,
      userId,
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
    return json(error(reason), { status: reason.status });
  }
}

export default function CreateNewKit() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <>
      <Header title={title ?? "Untitled kit"} />
      <KitsForm />
    </>
  );
}
