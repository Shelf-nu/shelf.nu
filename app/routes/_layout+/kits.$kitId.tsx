import { AssetStatus, KitStatus } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "@remix-run/node";
import { Outlet, useLoaderData, useMatches } from "@remix-run/react";
import { z } from "zod";
import AgreementStatusCard from "~/components/assets/agreement-status-card";
import { CustodyCard } from "~/components/assets/asset-custody-card";
import ActionsDropdown from "~/components/kits/actions-dropdown";
import BookingActionsDropdown from "~/components/kits/booking-actions-dropdown";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { ScanDetails } from "~/components/location/scan-details";
import { QrPreview } from "~/components/qr/qr-preview";
import { Card } from "~/components/shared/card";
import TextualDivider from "~/components/shared/textual-divider";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { usePosition } from "~/hooks/use-position";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  deleteKit,
  deleteKitImage,
  getKit,
  getKitCurrentBooking,
} from "~/modules/kit/service.server";
import { createNote } from "~/modules/note/service.server";

import { generateQrObj } from "~/modules/qr/utils.server";
import { getScanByQrId } from "~/modules/scan/service.server";
import { parseScanData } from "~/modules/scan/utils.server";
import type { RouteHandleWithName } from "~/modules/types";
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

export type KitPageLoaderData = typeof loader;

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

    let [kit, qrObj] = await Promise.all([
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
              agreement: true,
            },
          },
          qrCodes: true,
          custodyReceipts: {
            select: { id: true },
            orderBy: { agreementSignedOn: "desc" },
            take: 1, // take the latest custody receipt
          },
        },
        userOrganizations,
        request,
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
    useLoaderData<KitPageLoaderData>();
  const { roles } = useUserRoleHelper();

  const kitHasUnavailableAssets = kit.assets.some((a) => !a.availableToBook);

  const items = [
    { to: "assets", content: "Assets" },
    { to: "bookings", content: "Bookings" },
  ];

  const matches = useMatches();
  const currentRoute: RouteHandleWithName = matches[matches.length - 1];

  /**When we are on the kit.scan-assets route, we render an outlet on the whole layout.
   * On the .assets and .bookings routes, we render the outlet only on the left column
   */
  const shouldRenderFullOutlet =
    currentRoute?.handle?.name === "kit.scan-assets";

  return shouldRenderFullOutlet ? (
    <Outlet />
  ) : (
    <>
      <Header
        subHeading={
          <KitStatusBadge
            kitId={kit.id}
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

      <HorizontalTabs items={items} />

      <div className="mt-4 block md:mx-0 lg:flex">
        {/* Left column */}
        <div className="flex-1 md:overflow-hidden">
          <Outlet />
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
          {kit.custody &&
          kit.custody.agreement &&
          kit.custody.agreement.signatureRequired ? (
            <AgreementStatusCard
              signUrl={`/sign/kit-custody/${kit.custody.id}`}
              className="mt-0"
              custodian={kit.custody.custodian}
              receiptId={
                kit.custodyReceipts.length ? kit.custodyReceipts[0].id : null
              }
              agreementName={kit.custody.agreement?.name ?? ""}
              isSignaturePending={kit.status === KitStatus.SIGNATURE_PENDING}
            />
          ) : null}

          <When truthy={kit.status === KitStatus.IN_CUSTODY}>
            <CustodyCard
              className="mt-0"
              // @ts-expect-error - we are passing the correct props
              booking={currentBooking || undefined}
              hasPermission={userCanViewSpecificCustody({
                roles,
                custodianUserId: kit?.custody?.custodian?.user?.id,
                organization: currentOrganization,
                currentUserId: userId,
              })}
              custody={kit.custody}
            />
          </When>

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
