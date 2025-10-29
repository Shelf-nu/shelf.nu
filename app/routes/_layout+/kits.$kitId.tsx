import { AssetStatus, BarcodeType, type Prisma } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "@remix-run/node";
import { Outlet, useLoaderData, useMatches } from "@remix-run/react";
import { z } from "zod";
import { CustodyCard } from "~/components/assets/asset-custody-card";
import { CodePreview } from "~/components/code-preview/code-preview";
import ActionsDropdown from "~/components/kits/actions-dropdown";
import BookingActionsDropdown from "~/components/kits/booking-actions-dropdown";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { ScanDetails } from "~/components/location/scan-details";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { usePosition } from "~/hooks/use-position";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { createBarcode } from "~/modules/barcode/service.server";
import {
  validateBarcodeValue,
  normalizeBarcodeValue,
} from "~/modules/barcode/validation";
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
import { payload, error, getParams, parseData } from "~/utils/http.server";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

type KitWithOptionalBarcodes = ReturnType<
  typeof useLoaderData<typeof loader>
>["kit"] & {
  barcodes?: Array<{
    id: string;
    type: any;
    value: string;
  }>;
};

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
    const {
      organizationId,
      userOrganizations,
      currentOrganization,
      canUseBarcodes,
    } = await requirePermission({
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
                where: {
                  status: { in: ["ONGOING", "OVERDUE"] },
                },
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
          qrCodes: true,
          ...(canUseBarcodes && {
            barcodes: {
              select: {
                id: true,
                type: true,
                value: true,
              },
            },
          }),
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
      payload({
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
    const formData = await request.formData();
    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["removeAsset", "delete", "add-barcode"]) })
    );

    const intent2ActionMap: { [K in typeof intent]: PermissionAction } = {
      delete: PermissionAction.delete,
      removeAsset: PermissionAction.update,
      "add-barcode": PermissionAction.update,
    };

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: intent2ActionMap[intent],
    });

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Prisma.UserSelect,
    });

    const { image } = parseData(
      formData,
      z.object({
        image: z.string().optional(),
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
          formData,
          z.object({
            assetId: z.string(),
          }),
          { additionalData: { userId, organizationId, kitId } }
        );

        const kit = await db.kit.update({
          where: { id: kitId, organizationId },
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
            where: { id: assetId, organizationId },
            data: {
              status: AssetStatus.AVAILABLE,
              custody: { delete: true },
            },
          });
        }

        const actor = wrapUserLinkForNote({
          id: userId,
          firstName: user.firstName,
          lastName: user.lastName,
        });
        const kitLink = wrapLinkForNote(`/kits/${kitId}`, kit.name.trim());

        await createNote({
          content: `${actor} removed the asset from ${kitLink}.`,
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

        return json(payload({ kit }));
      }

      case "add-barcode": {
        const { barcodeType, barcodeValue } = parseData(
          formData,
          z.object({
            barcodeType: z.nativeEnum(BarcodeType),
            barcodeValue: z.string().min(1, "Barcode value is required"),
          })
        );

        // Validate barcode value
        const normalizedValue = normalizeBarcodeValue(
          barcodeType,
          barcodeValue
        );
        const validationError = validateBarcodeValue(
          barcodeType,
          normalizedValue
        );

        if (validationError) {
          return json(payload({ error: validationError }), { status: 400 });
        }

        try {
          await createBarcode({
            type: barcodeType,
            value: normalizedValue,
            organizationId,
            userId,
            kitId,
          });

          sendNotification({
            title: "Barcode added",
            message: "Barcode has been added to your kit successfully",
            icon: { name: "success", variant: "success" },
            senderId: authSession.userId,
          });

          return json(payload({ success: true }));
        } catch (cause) {
          // Handle constraint violations and other barcode creation errors
          const reason = makeShelfError(cause);

          // Extract specific validation errors if they exist
          const validationErrors = reason.additionalData
            ?.validationErrors as any;
          if (validationErrors && validationErrors["barcodes[0].value"]) {
            return json(
              payload({ error: validationErrors["barcodes[0].value"].message }),
              {
                status: reason.status,
              }
            );
          }

          return json(payload({ error: reason.message }), {
            status: reason.status,
          });
        }
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(payload(null));
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
  const { canUseBarcodes } = useBarcodePermissions();

  const kitHasUnavailableAssets = kit.assets.some((a) => !a.availableToBook);

  const items = [
    { to: "assets", content: "Assets" },
    { to: "overview", content: "Overview" },
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
          {/* Kit Custody */}
          <When truthy={!!kit.custody}>
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

          <CodePreview
            qrObj={qrObj}
            barcodes={
              canUseBarcodes
                ? (kit as KitWithOptionalBarcodes).barcodes || []
                : []
            }
            item={{
              id: kit.id,
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
