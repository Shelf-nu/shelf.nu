import { AssetStatus, BookingStatus, type Prisma } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ChevronRight } from "~/components/icons/library";
import ActionsDropdown from "~/components/kits/actions-dropdown";
import AssetRowActionsDropdown from "~/components/kits/asset-row-actions-dropdown";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { GrayBadge } from "~/components/shared/gray-badge";
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
import dropdownCss from "~/styles/actions-dropdown.css?url";
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
            select: {
              status: true,
              custody: { select: { id: true } },
              bookings: { select: { status: true } },
            },
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

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: dropdownCss },
];

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
  const { kit } = useLoaderData<typeof loader>();
  const _kit = kit as unknown as Prisma.KitGetPayload<{
    include: {
      assets: { select: { bookings: { select: { status: true } } } };
    };
  }>;

  const isSelfService = useUserIsSelfService();

  /**
   * User can manage assets if
   * 1. Kit has AVAILABLE status
   * 2. Kit has a booking whose status is one of the following
   *    DRAFT
   *    ARCHIVED
   *    CANCELLED
   *    COMPLETE
   */
  const allowedBookingStatus: BookingStatus[] = [
    BookingStatus.DRAFT,
    BookingStatus.ARCHIVED,
    BookingStatus.CANCELLED,
    BookingStatus.COMPLETE,
  ];
  const canManageAssets = _kit.assets.length
    ? _kit.assets[0]?.bookings.every((b) =>
        allowedBookingStatus.includes(b.status)
      )
    : kit.status === "AVAILABLE";

  return (
    <>
      <Header
        subHeading={
          <KitStatusBadge
            status={kit.status}
            availableToBook={kit.status === "AVAILABLE"}
          />
        }
      >
        {!isSelfService ? <ActionsDropdown /> : null}
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
          {!isSelfService && !canManageAssets && kit?.custody?.createdAt ? (
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
        </div>

        <div className="w-full lg:ml-6">
          <TextualDivider text="Assets" className="mb-8 lg:hidden" />
          <div className="mb-3 flex gap-4 lg:hidden">
            {canManageAssets ? (
              <Button
                as="button"
                to="add-assets"
                variant="primary"
                icon="plus"
                width="full"
              >
                Manage assets
              </Button>
            ) : null}
            <div className="w-full">
              <ActionsDropdown fullWidth />
            </div>
          </div>

          <div className="flex flex-col md:gap-2">
            <Filters className="responsive-filters mb-2 lg:mb-0">
              {canManageAssets && !isSelfService && (
                <div className="flex items-center justify-normal gap-6 xl:justify-end">
                  <div className="hidden lg:block">
                    <Button
                      as="button"
                      to="manage-assets"
                      variant="primary"
                      icon="plus"
                      className="whitespace-nowrap"
                    >
                      Manage assets
                    </Button>
                  </div>
                </div>
              )}
            </Filters>
            <List
              ItemComponent={ListContent}
              customEmptyStateContent={{
                title: "Not assets in kit",
                text: !isSelfService ? "Start by adding your first asset." : "",
                newButtonContent: !isSelfService ? "Manage assets" : undefined,
                newButtonRoute: !isSelfService ? "manage-assets" : undefined,
              }}
              headerChildren={
                <>
                  <Th className="hidden md:table-cell">Category</Th>
                  <Th className="hidden md:table-cell">Location</Th>
                </>
              }
            />
          </div>
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

  const isSelfService = useUserIsSelfService();
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
                className="mb-1 text-gray-900 hover:text-gray-700"
              >
                {item.title}
              </Button>
              <AssetStatusBadge
                status={item.status}
                availableToBook={item.availableToBook}
              />
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
          <GrayBadge>
            {location.image ? (
              <Image
                imageId={location.image.id}
                alt="img"
                className="mr-1 size-4 rounded-full object-cover"
                updatedAt={location.image?.updatedAt}
              />
            ) : null}
            <span>{location.name}</span>
          </GrayBadge>
        ) : null}
      </Td>
      {!isSelfService && (
        <Td className="pr-4 text-right">
          <AssetRowActionsDropdown asset={item} />
        </Td>
      )}
    </>
  );
}
