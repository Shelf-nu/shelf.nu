import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { useLoaderData, Outlet } from "@remix-run/react";
import mapCss from "maplibre-gl/dist/maplibre-gl.css?url";
import { z } from "zod";
import ActionsDropdown from "~/components/assets/actions-dropdown";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { Button } from "~/components/shared/button";
import When from "~/components/when/when";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  deleteAsset,
  deleteOtherImages,
  getAsset,
} from "~/modules/asset/service.server";
import assetCss from "~/styles/asset.css?url";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getDateTimeFormat } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams, data, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const AvailabilityForBookingFormSchema = z.object({
  availableToBook: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const asset = await getAsset({
      id,
      organizationId,
      include: {
        custody: { include: { custodian: true } },
        kit: true,
      },
    });

    const header: HeaderData = {
      title: asset.title,
    };

    return json(
      data({
        asset: {
          ...asset,
          createdAt: getDateTimeFormat(request, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(asset.createdAt),
        },
        header,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason));
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["delete"]) })
    );

    const intent2ActionMap: { [K in typeof intent]: PermissionAction } = {
      delete: PermissionAction.delete,
    };

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: intent2ActionMap[intent],
    });

    switch (intent) {
      case "delete": {
        const { mainImageUrl } = parseData(
          formData,
          z.object({ mainImageUrl: z.string().optional() })
        );

        await deleteAsset({ organizationId, id });

        if (mainImageUrl) {
          // as it is deletion operation giving hardcoded path(to make sure all the images were deleted)
          await deleteOtherImages({
            userId,
            assetId: id,
            data: { path: `main-image-${id}.jpg` },
          });
        }

        sendNotification({
          title: "Asset deleted",
          message: "Your asset has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: authSession.userId,
        });

        return redirect(`/assets`);
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
];

export const handle = {
  breadcrumb: () => "single",
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: assetCss },
  { rel: "stylesheet", href: mapCss },
];

export default function AssetDetailsPage() {
  const { asset } = useLoaderData<typeof loader>();

  let items = [
    { to: "overview", content: "Overview" },
    { to: "activity", content: "Activity" },
    { to: "bookings", content: "Bookings" },
  ];

  /** Due to some conflict of types between prisma and remix, we need to use the SerializeFrom type
   * Source: https://github.com/prisma/prisma/discussions/14371
   */
  const { roles } = useUserRoleHelper();
  return (
    <>
      <Header
        slots={{
          "left-of-title": (
            <AssetImage
              asset={{
                assetId: asset.id,
                mainImage: asset.mainImage,
                mainImageExpiration: asset.mainImageExpiration,
                alt: asset.title,
              }}
              className={tw(
                "mr-4 size-[56px] cursor-pointer rounded border object-cover"
              )}
              withPreview
            />
          ),
        }}
        subHeading={
          <div className="flex gap-2">
            <AssetStatusBadge
              status={asset.status}
              availableToBook={asset.availableToBook}
            />
          </div>
        }
      >
        <When
          truthy={userHasPermission({
            roles,
            entity: PermissionEntity.asset,
            action: [PermissionAction.update, PermissionAction.custody],
          })}
        >
          <ActionsDropdown />
        </When>
        <Button
          to={`/bookings/new?assetId=${asset.id}`}
          role="link"
          aria-label="new booking"
          data-test-id="createNewBooking"
          prefetch="none"
          disabled={
            asset.kit
              ? {
                  reason: (
                    <>
                      Cannot book this asset directly because it's part of a
                      kit. Please book the{" "}
                      <Button
                        to={`/kits/${asset.kit.id}`}
                        target="_blank"
                        variant="link"
                      >
                        kit
                      </Button>{" "}
                      instead.
                    </>
                  ),
                }
              : false
          }
        >
          Book
        </Button>
      </Header>
      <HorizontalTabs items={items} />
      <div>
        <Outlet />
      </div>
    </>
  );
}
