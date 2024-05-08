import { AssetStatus, type Prisma } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import { ChevronRight } from "~/components/icons/library";
import ActionsDropdown from "~/components/kits/actions-dropdown";
import AssetRowActionsDropdown from "~/components/kits/asset-row-actions-dropdown";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ScanDetails } from "~/components/location/scan-details";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Image } from "~/components/shared/image";
import TextualDivider from "~/components/shared/textual-divider";
import { Td, Th } from "~/components/table";
import { db } from "~/database/db.server";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import { createNote } from "~/modules/asset/service.server";
import {
  deleteKit,
  deleteKitImage,
  getAssetsForKits,
  getKit,
} from "~/modules/kit/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getDateTimeFormat } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(
    params,
    z.object({
      kitId: z.string(),
    })
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const [kit, assets] = await Promise.all([
      getKit({
        id: kitId,
        organizationId,
        extraInclude: {
          assets: {
            select: { status: true, custody: { select: { id: true } } },
          },
          custody: { select: { custodian: true } },
        },
      }),
      getAssetsForKits({
        request,
        organizationId,
        kitId,
      }),
    ]);

    let custody = null;
    if (kit.custody) {
      const date = new Date(kit.custody.createdAt);
      const dateDisplay = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);

      custody = {
        ...kit.custody,
        dateDisplay,
      };
    }

    const header: HeaderData = {
      title: kit.name,
    };

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return json(
      data({
        kit: {
          ...kit,
          custody,
        },
        header,
        ...assets,
        modelName,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason));
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
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
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.delete,
    });

    const user = await getUserByID(userId);

    const { intent, image } = parseData(
      await request.clone().formData(),
      z.object({
        image: z.string().optional(),
        intent: z.enum(["removeAsset", "delete"]),
      }),
      { additionalData: { userId, organizationId, kitId } }
    );

    switch (intent) {
      case "delete": {
        await deleteKit({ id: kitId, organizationId });

        if (image) {
          await deleteKitImage({ url: image });
        }

        sendNotification({
          title: "Kit deleted",
          message: "Your kit has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: authSession.userId,
        });

        return redirect("/kits");
      }
      case "removeAsset": {
        const { assetId } = parseData(
          await request.formData(),
          z.object({
            assetId: z.string(),
          }),
          { additionalData: { userId, organizationId, kitId } }
        );

        const kit = await db.kit.update({
          where: { id: kitId },
          data: {
            assets: { disconnect: { id: assetId } },
          },
          select: { name: true, custody: { select: { custodianId: true } } },
        });

        /**
         * If kit was in custody then we have to make the asset available
         */
        if (kit.custody?.custodianId) {
          await db.asset.update({
            where: { id: assetId },
            data: {
              status: AssetStatus.AVAILABLE,
              custody: { delete: true },
            },
          });
        }

        await createNote({
          content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** removed asset from **[${kit.name.trim()}](/kits/${kitId})**`,
          type: "UPDATE",
          userId,
          assetId,
        });

        sendNotification({
          title: "Asset removed",
          message: "Your asset has been removed from the kit",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ kit }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return json(error(reason), { status: reason.status });
  }
}

export default function KitDetails() {
  const { kit, items } = useLoaderData<typeof loader>();

  const isSelfService = useUserIsSelfService();
  const kitIsAvailable = kit.status === "AVAILABLE";

  return (
    <>
      <Header
        subHeading={<KitStatusBadge status={kit.status} availableToBook />}
      >
        {!isSelfService ? (
          <>
            <Button to="qr" variant="secondary" icon="barcode">
              View QR code
            </Button>
            <ActionsDropdown />
          </>
        ) : null}
      </Header>

      <ContextualModal />

      <div className="mt-8 lg:flex">
        <div className="shrink-0 overflow-hidden lg:w-[343px] xl:w-[400px]">
          <KitImage
            kit={{
              kitId: kit.id,
              image: kit.image,
              imageExpiration: kit.imageExpiration,
              alt: kit.name,
            }}
            className={tw(
              "h-auto w-full rounded border object-cover",
              kit.description ? "rounded-b-none border-b-0" : ""
            )}
          />
          {kit.description ? (
            <Card className="mb-3 mt-0 rounded-t-none border-t-0">
              <p className="whitespace-pre-wrap text-gray-600">
                {kit.description}
              </p>
            </Card>
          ) : null}

          {/* Kit Custody */}
          {!isSelfService && !kitIsAvailable && kit?.custody?.createdAt ? (
            <Card className="my-3">
              <div className="flex items-center gap-3">
                <img
                  src="/static/images/default_pfp.jpg"
                  alt="custodian"
                  className="size-10 rounded"
                />
                <div>
                  <p className="">
                    In custody of{" "}
                    <span className="font-semibold">
                      {kit.custody?.custodian.name}
                    </span>
                  </p>
                  <span>Since {kit.custody.dateDisplay}</span>
                </div>
              </div>
            </Card>
          ) : null}

          <TextualDivider text="Details" className="mb-8 lg:hidden" />
          <Card className="my-3 flex justify-between">
            <span className="text-xs font-medium text-gray-600">ID</span>
            <div className="max-w-[250px] font-medium">{kit.id}</div>
          </Card>

          {!isSelfService ? <ScanDetails /> : null}
        </div>

        <div className="w-full lg:ml-6">
          <div className="flex w-full flex-col items-center justify-between rounded-t border-x border-t p-4 md:flex-row">
            <div>
              <h2 className="font-semibold">Assets</h2>
              <p className="text-sm text-gray-600">{items.length} items</p>
            </div>

            <Button to="manage-assets">Manage Assets</Button>
          </div>
          <List
            className="overflow-x-visible !rounded-none md:overflow-x-auto md:!rounded-b"
            ItemComponent={ListContent}
            hideFirstHeaderColumn
            customEmptyStateContent={{
              title: "Not assets in kit",
              text: "Start by adding your first asset.",
              newButtonContent: "Manage assets",
              newButtonRoute: "manage-assets",
            }}
            headerChildren={
              <>
                <Th className="hidden md:table-cell">Name</Th>
                <Th className="hidden md:table-cell">Category</Th>
                <Th className="hidden md:table-cell">Location</Th>
              </>
            }
          />
        </div>
      </div>
    </>
  );
}

function ListContent({
  item,
}: {
  item: Prisma.AssetGetPayload<{
    include: {
      location: {
        include: { image: { select: { id: true; updatedAt: true } } };
      };
      category: true;
    };
  }>;
}) {
  const { id, mainImage, mainImageExpiration, title, location, category } =
    item;

  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: id,
                  mainImage,
                  mainImageExpiration,
                  alt: title,
                }}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
              <Button
                to={`/assets/${item.id}`}
                variant="link"
                className="text-gray-900 hover:text-gray-700"
              >
                {item.title}
              </Button>
              <div className="block md:hidden">
                {category ? (
                  <Badge color={category.color} withDot={false}>
                    {category.name}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>

          <button className="block md:hidden">
            <ChevronRight />
          </button>
        </div>
      </Td>

      <Td className="hidden md:table-cell">
        {category ? (
          <Badge color={category.color} withDot={false}>
            {category.name}
          </Badge>
        ) : null}
      </Td>

      <Td className="hidden md:table-cell">
        {location ? (
          <div className="flex h-7 min-w-32 items-center justify-center gap-x-1 rounded-full bg-gray-100">
            <Image
              imageId={location.image?.id}
              alt="img"
              className="size-4 shrink-0 rounded-full object-cover"
              updatedAt={location.image?.updatedAt}
            />

            <p className="text-xs font-medium">{location.name}</p>
          </div>
        ) : null}
      </Td>

      <Td className="pr-4 text-right">
        <AssetRowActionsDropdown asset={item} />
      </Td>
    </>
  );
}
