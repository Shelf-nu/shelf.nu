import {
  json,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import invariant from "tiny-invariant";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  LocationForm,
  NewLocationFormSchema,
} from "~/components/location/form";
import { getLocation, updateLocation } from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { MAX_SIZE } from "./locations.new";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId: id } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    const { location } = await getLocation({ organizationId, id });

    const header: HeaderData = {
      title: `Edit | ${location.name}`,
    };

    return json(
      data({
        location,
        header,
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
  breadcrumb: () => <span>Edit</span>,
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId: id } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });
    const clonedRequest = request.clone();

    const payload = parseData(await request.formData(), NewLocationFormSchema, {
      additionalData: { userId, organizationId, id },
    });

    const { name, description, address } = payload;

    const formDataFile = await unstable_parseMultipartFormData(
      clonedRequest,
      unstable_createMemoryUploadHandler({ maxPartSize: MAX_SIZE })
    );

    const file = formDataFile.get("image") as File | null;
    invariant(file instanceof File, "file not the right type");

    await updateLocation({
      id,
      userId: authSession.userId,
      name,
      description,
      address,
      image: file || null,
      organizationId,
    });

    sendNotification({
      title: "Location updated",
      message: "Your location  has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return json(error(reason), { status: reason.status });
  }
}

export default function LocationEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "";
  const { location } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={hasName ? name : location.name} />
      <div className=" items-top flex justify-between">
        <LocationForm
          name={location.name}
          description={location.description}
          address={location.address}
        />
      </div>
    </>
  );
}
