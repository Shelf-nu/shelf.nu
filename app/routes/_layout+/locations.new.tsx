import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, redirectDocument } from "react-router";
import { useAtomValue } from "jotai";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import Header from "~/components/layout/header";
import {
  LocationForm,
  NewLocationFormSchema,
} from "~/components/location/form";

import {
  createLocation,
  updateLocationImage,
} from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
const title = "New Location";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.create,
    });

    const header = {
      title,
    };

    return payload({ header });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.create,
    });

    /** Here we need to clone the request as we need 2 different streams:
     * 1. Access form data for creating asset
     * 2. Access form data via upload handler to be able to upload the file
     *
     * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
     */
    const clonedRequest = request.clone();

    const payload = parseData(
      await clonedRequest.formData(),
      NewLocationFormSchema,
      {
        additionalData: { userId, organizationId },
      }
    );

    const { name, description, address, addAnother } = payload;

    const location = await createLocation({
      name,
      description,
      address,
      userId: authSession.userId,
      organizationId,
    });

    await updateLocationImage({
      request,
      locationId: location.id,
      organizationId,
    });

    sendNotification({
      title: "Location created",
      message: "Your location has been created successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    /** If the user clicked add-another, reload the document to clear the form */
    if (addAnother) {
      return redirectDocument("/locations/new");
    }

    return redirect(`/locations/${location.id}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function NewLocationPage() {
  const title = useAtomValue(dynamicTitleAtom);

  return (
    <div className="relative">
      <Header title={title ? title : "Untitled location"} />
      <div>
        <LocationForm />
      </div>
    </div>
  );
}
