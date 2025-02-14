import type { Prisma } from "@prisma/client";
import { AssetStatus, BookingStatus } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { CustodyCard } from "~/components/assets/asset-custody-card";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import ActionsDropdown from "~/components/kits/actions-dropdown";
import AssetRowActionsDropdown from "~/components/kits/asset-row-actions-dropdown";
import BookingActionsDropdown from "~/components/kits/booking-actions-dropdown";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { ScanDetails } from "~/components/location/scan-details";
import { QrPreview } from "~/components/qr/qr-preview";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { GrayBadge } from "~/components/shared/gray-badge";
import { Image } from "~/components/shared/image";
import TextualDivider from "~/components/shared/textual-divider";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { usePosition } from "~/hooks/use-position";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  deleteKit,
  deleteKitImage,
  getAssetsForKits,
  getKit,
  getKitCurrentBooking,
} from "~/modules/kit/service.server";
import { createNote } from "~/modules/note/service.server";

import { generateQrObj } from "~/modules/qr/utils.server";
import { getScanByQrId } from "~/modules/scan/service.server";
import { parseScanData } from "~/modules/scan/utils.server";
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
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
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
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    let [kit, assets] = await Promise.all([
      getKit({
        id: kitId,
        organizationId,
        extraInclude: {
          assets: {
            select: {
              id: true,
              status: true,
              custody: { select: { id: true } },
              bookings: {
                select: {
                  id: true,
                  name: true,
                  from: true,
                  status: true,
                  custodianTeamMember: true,
                  custodianUser: {
                    select: {
                      firstName: true,
                      lastName: true,
                      profilePicture: true,
                      email: true,
                    },
                  },
                },
              },
              availableToBook: true,
            },
          },
          custody: {
            select: {
              custodian: {
                include: {
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
          qrCodes: true,
        },
        userOrganizations,
        request,
      }),
      getAssetsForKits({
        request,
        organizationId,
        kitId,
      }),
    ]);

    let custody = null;
    if (kit.custody) {
      const dateDisplay = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(kit.custody.createdAt);

      custody = {
        ...kit.custody,
        dateDisplay,
      };
    }

    const qrObj = await generateQrObj({
      kitId,
      userId,
      organizationId,
    });

    /**
     * We get the first QR code(for now we can only have 1)
     * And using the ID of tha qr code, we find the latest scan
     */
    const lastScan = kit.qrCodes[0]?.id
      ? parseScanData({
          scan: (await getScanByQrId({ qrId: kit.qrCodes[0].id })) || null,
          userId,
          request,
        })
      : null;
    const currentBooking = getKitCurrentBooking(request, {
      id: kit.id,
      assets: kit.assets,
    });

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
        currentBooking,
        header,
        ...assets,
        modelName,
        qrObj,
        lastScan,
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
  usePosition();
  const { kit, currentBooking, qrObj, lastScan } =
    useLoaderData<typeof loader>();
  const { isBaseOrSelfService, roles } = useUserRoleHelper();
  /**
   * User can manage assets if
   * 1. Kit has AVAILABLE status
   * 2. Kit has a booking whose status is one of the following
   *    DRAFT
   *    RESERVED
   *    ARCHIVED
   *    CANCELLED
   *    COMPLETE
   * 3. User is not self service
   */
  const allowedBookingStatus: BookingStatus[] = [
    BookingStatus.DRAFT,
    BookingStatus.RESERVED,
    BookingStatus.ARCHIVED,
    BookingStatus.CANCELLED,
    BookingStatus.COMPLETE,
  ];
  const kitIsAvailable = kit.assets.length
    ? kit.assets[0]?.bookings.every((b) =>
        allowedBookingStatus.includes(b.status)
      )
    : kit.status === "AVAILABLE";

  const kitHasUnavailableAssets = kit.assets.some((a) => !a.availableToBook);

  const kitBookings =
    kit.assets.find((a) => a.bookings.length > 0)?.bookings ?? [];

  const userRoleCanManageAssets = userHasPermission({
    roles,
    entity: PermissionEntity.kit,
    action: PermissionAction.manageAssets,
  });

  const canManageAssets =
    kitIsAvailable &&
    userRoleCanManageAssets &&
    !kitBookings.some((b) =>
      (
        [BookingStatus.ONGOING, BookingStatus.OVERDUE] as BookingStatus[]
      ).includes(b.status)
    );

  return (
    <>
      <Header
        subHeading={
          <KitStatusBadge
            status={kit.status}
            availableToBook={!kitHasUnavailableAssets}
          />
        }
      >
        <When
          truthy={userHasPermission({
            roles,
            entity: PermissionEntity.kit,
            action: [PermissionAction.update, PermissionAction.custody],
          })}
        >
          <ActionsDropdown />
        </When>
        <BookingActionsDropdown />
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
          <CustodyCard
            // @ts-expect-error - we are passing the correct props
            booking={currentBooking || undefined}
            hasPermission={userHasPermission({
              roles,
              entity: PermissionEntity.custody,
              action: PermissionAction.read,
            })}
            custody={kit.custody}
          />

          <TextualDivider text="Details" className="mb-8 lg:hidden" />
          <Card className="my-3 flex justify-between">
            <span className="text-xs font-medium text-gray-600">ID</span>
            <div className="max-w-[250px] font-medium">{kit.id}</div>
          </Card>
          <QrPreview
            qrObj={qrObj}
            item={{
              name: kit.name,
              type: "kit",
            }}
          />
          {userHasPermission({
            roles,
            entity: PermissionEntity.scan,
            action: PermissionAction.read,
          }) ? (
            <ScanDetails lastScan={lastScan} />
          ) : null}
        </div>

        <div className="w-full lg:ml-6">
          <TextualDivider text="Assets" className="mb-8 lg:hidden" />
          <div className="mb-3 flex gap-4 lg:hidden">
            {userRoleCanManageAssets ? (
              <Button
                to="manage-assets"
                variant="primary"
                width="full"
                disabled={
                  !canManageAssets
                    ? {
                        reason:
                          "You are not allowed to manage assets for this kit because its part of an ongoing booking",
                      }
                    : false
                }
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
              {userRoleCanManageAssets ? (
                <div className="flex items-center justify-normal gap-6 xl:justify-end">
                  <div className="hidden lg:block">
                    <Button
                      to="manage-assets"
                      variant="primary"
                      width="full"
                      className="whitespace-nowrap"
                      disabled={
                        !canManageAssets
                          ? {
                              reason:
                                "You are not allowed to manage assets for this kit because its part of an ongoing booking",
                            }
                          : false
                      }
                    >
                      Manage assets
                    </Button>
                  </div>
                </div>
              ) : null}
            </Filters>
            <List
              ItemComponent={ListContent}
              customEmptyStateContent={{
                title: "Not assets in kit",
                text: !isBaseOrSelfService
                  ? "Start by adding your first asset."
                  : "",
                newButtonContent: !isBaseOrSelfService
                  ? "Manage assets"
                  : undefined,
                newButtonRoute: !isBaseOrSelfService
                  ? "manage-assets"
                  : undefined,
              }}
              headerChildren={
                <>
                  <Th>Category</Th>
                  <Th>Location</Th>
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
  const { location, category } = item;

  const { roles } = useUserRoleHelper();
  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4  md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex size-12 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block font-medium">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left text-gray-900 hover:text-gray-700"
                >
                  {item.title}
                </Button>
              </span>
              <AssetStatusBadge
                status={item.status}
                availableToBook={item.availableToBook}
              />
            </div>
          </div>
        </div>
      </Td>

      <Td>
        {category ? (
          <Badge color={category.color} withDot={false}>
            {category.name}
          </Badge>
        ) : null}
      </Td>

      <Td>
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
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.asset,
          action: PermissionAction.manageAssets,
        })}
      >
        <Td className="pr-4 text-right">
          <AssetRowActionsDropdown asset={item} />
        </Td>
      </When>
    </>
  );
}
