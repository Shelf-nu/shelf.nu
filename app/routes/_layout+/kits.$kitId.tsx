import { AssetStatus } from "@prisma/client";
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
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_INDEX_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import ActionsDropdown from "~/components/kits/actions-dropdown";
import AssetRowActionsDropdown from "~/components/kits/asset-row-actions-dropdown";
import BookingActionsDropdown from "~/components/kits/booking-actions-dropdown";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { ScanDetails } from "~/components/location/scan-details";
import { QrPreview } from "~/components/qr/qr-preview";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { GrayBadge } from "~/components/shared/gray-badge";
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
import type { ListItemForKitPage } from "~/modules/kit/types";
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
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { ListItemTagsColumn } from "./assets._index";

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
    const { organizationId, userOrganizations, currentOrganization } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.kit,
        action: PermissionAction.read,
      });

    const isManageAssetsUrl = request.url.includes("manage-assets");

    let [kit, assets, qrObj] = await Promise.all([
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
        ignoreFilters: isManageAssetsUrl,
      }),
      generateQrObj({
        kitId,
        userId,
        organizationId,
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
      } as {
        // I need to specifically cast this. If I dont it doesn't recognize the id inside user
        dateDisplay: string;
        id: string;
        createdAt: Date;
        custodian: {
          user: {
            id: string; // Make sure this is included
            email: string;
            firstName: string | null;
            lastName: string | null;
            profilePicture: string | null;
          } | null;
          id: string;
          name: string;
        };
      };
    }

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
        currentOrganization,
        userId,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { kitId, userId });
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
  const { kit, currentBooking, qrObj, lastScan, userId, currentOrganization } =
    useLoaderData<typeof loader>();
  const { roles } = useUserRoleHelper();

  const kitHasUnavailableAssets = kit.assets.some((a) => !a.availableToBook);

  const userRoleCanManageAssets = userHasPermission({
    roles,
    entity: PermissionEntity.kit,
    action: PermissionAction.manageAssets,
  });

  return (
    <>
      <Header
        subHeading={
          <KitStatusBadge
            status={kit.status}
            availableToBook={!kitHasUnavailableAssets}
          />
        }
        slots={{
          "left-of-title": (
            <KitImage
              kit={{
                kitId: kit.id,
                image: kit.image,
                imageExpiration: kit.imageExpiration,
                alt: kit.name,
              }}
              className={tw("mr-4 size-14 rounded border object-cover")}
              withPreview
            />
          ),
        }}
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

      <ContextualSidebar />
      <ContextualModal />

      <div className="mx-[-16px] mt-4 block md:mx-0 lg:flex">
        {/* Left column - assets list */}
        <div className="flex-1 overflow-hidden">
          <TextualDivider text="Assets" className="mb-8 lg:hidden" />
          <div className="mb-3 flex gap-4 lg:hidden">
            {userRoleCanManageAssets ? (
              <Button
                to="manage-assets?status=AVAILABLE"
                variant="primary"
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
            <Filters
              className="responsive-filters mb-2 lg:mb-0"
              slots={{
                "right-of-search": (
                  <SortBy
                    sortingOptions={ASSET_INDEX_SORTING_OPTIONS}
                    defaultSortingBy="createdAt"
                  />
                ),
              }}
            >
              {userRoleCanManageAssets ? (
                <div className="flex items-center justify-normal gap-6 xl:justify-end">
                  <div className="hidden lg:block">
                    <Button
                      to="manage-assets?status=AVAILABLE"
                      variant="primary"
                      width="full"
                      className="whitespace-nowrap"
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
                text: userRoleCanManageAssets
                  ? "Start by adding your first asset."
                  : "",
                newButtonContent: userRoleCanManageAssets
                  ? "Manage assets"
                  : undefined,
                newButtonRoute: userRoleCanManageAssets
                  ? "manage-assets?status=AVAILABLE"
                  : undefined,
              }}
              headerChildren={
                <>
                  <Th>Category</Th>
                  <Th>Location</Th>
                  <Th>Tags</Th>
                </>
              }
            />
          </div>
        </div>

        {/* Right column */}
        <div className="w-full md:w-[360px] lg:ml-4">
          {kit.description ? (
            <Card className="mb-3 mt-0">
              <p className="whitespace-pre-wrap text-gray-600">
                {kit.description}
              </p>
            </Card>
          ) : null}

          {/* Kit Custody */}
          <CustodyCard
            // @ts-expect-error - we are passing the correct props
            booking={currentBooking || undefined}
            hasPermission={userCanViewSpecificCustody({
              roles,
              custodianUserId: kit?.custody?.custodian?.user?.id,
              organization: currentOrganization,
              currentUserId: userId,
            })}
            custody={kit.custody}
            className="mt-px"
          />

          <TextualDivider text="Details" className="mb-8 lg:hidden" />
          <Card className="mb-3 mt-0 flex justify-between">
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
      </div>
    </>
  );
}

function ListContent({ item }: { item: ListItemForKitPage }) {
  const { location, category, tags } = item;

  const { roles } = useUserRoleHelper();
  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4  md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={item.title}
                className="size-full rounded-[4px] border object-cover"
                withPreview
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
                  target={"_blank"}
                  onlyNewTabIconOnHover
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
            <span>{location.name}</span>
          </GrayBadge>
        ) : null}
      </Td>
      {/* Tags */}
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
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
