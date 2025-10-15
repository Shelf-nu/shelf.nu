import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import {
  LocationForm,
  NewLocationFormSchema,
} from "~/components/location/form";
import { Button } from "~/components/shared/button";
import {
  getLocation,
  updateLocation,
  updateLocationImage,
} from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  data,
  error,
  getParams,
  getRefererPath,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

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
    const { organizationId, userOrganizations } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    const { location } = await getLocation({
      organizationId,
      id,
      userOrganizations,
      request,
      orderBy: "createdAt",
    });

    const header: HeaderData = {
      title: `Edit | ${location.name}`,
      subHeading: location.id,
    };

    return json(
      data({
        location,
        header,
        referer: getRefererPath(request),
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

    const payload = parseData(
      await clonedRequest.formData(),
      NewLocationFormSchema,
      {
        additionalData: { userId, organizationId, id },
      }
    );

    const { name, description, address } = payload;

    const location = await updateLocation({
      id,
      userId: authSession.userId,
      name,
      description,
      address,
      organizationId,
    });

    await updateLocationImage({
      request,
      locationId: id,
      organizationId,
      prevImageUrl: location.imageUrl,
      prevThumbnailUrl: location.thumbnailUrl,
    });

    sendNotification({
      title: "Location updated",
      message: "Your location  has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    // If redirectTo is provided, redirect back to previous page
    // Otherwise stay on current page (e.g., when opened in new tab)
    if (payload.redirectTo) {
      return redirect(safeRedirect(payload.redirectTo, `/locations/${id}`));
    }

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return json(error(reason), { status: reason.status });
  }
}

export default function LocationEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const { location, referer } = useLoaderData<typeof loader>();

  return (
    <div className="relative">
      <Header
        title={
          <Button to={`/locations/${location.id}`} variant={"inherit"}>
            {name !== "" ? name : location.name}
          </Button>
        }
      />
      <div className="items-top flex justify-between">
        <LocationForm
          name={location.name}
          description={location.description}
          address={location.address}
          referer={referer}
        />
      </div>
    </div>
  );
}
