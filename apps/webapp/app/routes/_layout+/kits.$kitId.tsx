import { AssetStatus, BarcodeType, type Prisma } from "@prisma/client";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "react-router";
import {
  data,
  redirect,
  Outlet,
  useLoaderData,
  useMatches,
} from "react-router";
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
  emitAssetKitDetachmentNotes,
  fetchAssetKitDetachmentImpact,
  getKit,
  getKitCurrentBooking,
  mergeStandaloneCollisionsForKitDetachment,
  relinkKitQrCode,
} from "~/modules/kit/service.server";
import { createNote } from "~/modules/note/service.server";

import { generateQrObj } from "~/modules/qr/utils.server";
import { getScanByQrId } from "~/modules/scan/service.server";
import { parseScanData } from "~/modules/scan/utils.server";
import type { RouteHandleWithName } from "~/modules/types";
import { getUserByID } from "~/modules/user/service.server";
import dropdownCss from "~/styles/actions-dropdown.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { formatUnitCount } from "~/utils/asset-quantity";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
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

    const [kit, qrObj] = await Promise.all([
      getKit({
        id: kitId,
        organizationId,
        extraInclude: {
          assetKits: {
            select: {
              asset: {
                select: {
                  id: true,
                  status: true,
                  // `type` powers the qty-aware unavailability guard in
                  // ActionsDropdown — QUANTITY_TRACKED assets don't block
                  // kit-custody assign (Option B handles partial pools).
                  type: true,
                  custody: { select: { id: true } },
                  bookingAssets: {
                    where: {
                      booking: {
                        status: { in: ["ONGOING", "OVERDUE"] },
                      },
                    },
                    select: {
                      booking: {
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
                              displayName: true,
                              profilePicture: true,
                              email: true,
                            },
                          },
                        },
                      },
                    },
                  },
                  availableToBook: true,
                },
              },
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

    /**
     * We get the first QR code(for now we can only have 1)
     * And using the ID of tha qr code, we find the latest scan
     */
    const lastScan = kit.qrCodes[0]?.id
      ? parseScanData({
          scan: (await getScanByQrId({ qrId: kit.qrCodes[0].id })) || null,
          userId,
        })
      : null;
    const currentBooking = getKitCurrentBooking({
      id: kit.id,
      assets: kit.assetKits.map((ak) => ak.asset),
    });

    const header: HeaderData = {
      title: kit.name,
    };

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return payload({
      kit,
      currentBooking,
      header,
      modelName,
      qrObj,
      lastScan,
      currentOrganization,
      userId,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { kitId, userId });
    throw data(error(reason), { status: reason.status });
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
      z.object({
        intent: z.enum([
          "removeAsset",
          "delete",
          "add-barcode",
          "relink-qr-code",
        ]),
      })
    );

    const intent2ActionMap: { [K in typeof intent]: PermissionAction } = {
      delete: PermissionAction.delete,
      removeAsset: PermissionAction.update,
      "add-barcode": PermissionAction.update,
      "relink-qr-code": PermissionAction.update,
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
        displayName: true,
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
        await deleteKit({ id: kitId, organizationId, actorUserId: userId });

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

        /**
         * Wrap the kit disconnect + custody cleanup + status flip in a
         * single transaction so that:
         *   1. only the kit-allocated Custody row is removed (operator-
         *      assigned custody on the same asset is preserved), and
         *   2. the asset's status is only flipped back to AVAILABLE when
         *      no custody rows remain — if operator custody still exists
         *      on the asset, status stays IN_CUSTODY.
         *
         * The AssetKit row is deleted at the end, which cascades
         * `ON DELETE SET NULL` to any BookingAsset rows holding this
         * kit-driven slice. Before that fires we resolve the rare case
         * where a standalone slice already exists for the same
         * `(bookingId, assetId)` — merging the kit qty into the
         * standalone row so the SET NULL doesn't trip
         * `BookingAsset_manual_unique`. Detachment notes get the kit /
         * asset names from a snapshot taken before the merge.
         */
        const { kit, detachmentImpact, slice } = await db.$transaction(
          async (tx) => {
            const assetKitRows = await tx.assetKit.findMany({
              where: { kitId, assetId },
              // type + unitOfMeasure label the qty-tracked unit count in
              // the membership-remove note ("removed 50 units from …");
              // quantity is the per-row AssetKit.quantity actually being
              // detached (NOT Asset.quantity). Captured before the
              // deleteMany below so the note can render after the tx
              // commits without re-querying.
              select: {
                id: true,
                quantity: true,
                asset: {
                  select: { type: true, unitOfMeasure: true },
                },
              },
            });
            const assetKitIds = assetKitRows.map((ak: { id: string }) => ak.id);
            const impact = await fetchAssetKitDetachmentImpact(tx, assetKitIds);
            await mergeStandaloneCollisionsForKitDetachment(tx, assetKitIds);

            const updatedKit = await tx.kit.update({
              where: { id: kitId, organizationId },
              data: {
                // Remove the pivot row that links this asset to the kit.
                assetKits: { deleteMany: { assetId } },
              },
              select: {
                name: true,
                custody: { select: { id: true, custodianId: true } },
              },
            });

            /**
             * If kit was in custody then we have to clean up the kit-
             * allocated custody row on the asset. Filter the deleteMany by
             * `kitCustodyId` so operator-assigned custody on the same asset
             * (e.g. someone holding 10 of 50 batteries directly) is left
             * untouched.
             */
            if (updatedKit.custody?.id) {
              await tx.custody.deleteMany({
                where: { assetId, kitCustodyId: updatedKit.custody.id },
              });

              // After removing only the kit-allocated rows, check whether
              // any custody rows remain for this asset. The asset should
              // only flip back to AVAILABLE if no custody is left.
              const remainingCustody = await tx.custody.count({
                where: { assetId },
              });

              if (remainingCustody === 0) {
                await tx.asset.update({
                  where: { id: assetId, organizationId },
                  data: { status: AssetStatus.AVAILABLE },
                });
              }
            }

            // Snapshot the (single) AssetKit slice being detached for the
            // post-tx note. `assetKitRows[0]` is the only matching row
            // (composite unique on AssetKit (assetId, kitId) guarantees ≤ 1).
            const detachedSlice = assetKitRows[0] ?? null;

            return {
              kit: updatedKit,
              detachmentImpact: impact,
              slice: detachedSlice,
            };
          }
        );

        await emitAssetKitDetachmentNotes({
          impact: detachmentImpact,
          actorUserId: userId,
          actorFirstName: user.firstName,
          actorLastName: user.lastName,
          organizationId,
        });

        const actor = wrapUserLinkForNote({
          id: userId,
          firstName: user.firstName,
          lastName: user.lastName,
        });
        const kitLink = wrapLinkForNote(`/kits/${kitId}`, kit.name.trim());

        // Qty-tracked: name the per-row AssetKit.quantity actually
        // detached ("removed 50 units from Camera Kit"); INDIVIDUAL keeps
        // the original countless wording. Mirrors the singular path in
        // `createKitChangeNote` (note/service.server.ts) and the bulk
        // remove path in `bulkRemoveAssetsFromKits`.
        const count = slice?.asset
          ? formatUnitCount(slice.asset, slice.quantity)
          : null;
        await createNote({
          content: count
            ? `${actor} removed ${count} from ${kitLink}.`
            : `${actor} removed the asset from ${kitLink}.`,
          type: "UPDATE",
          userId,
          assetId,
          organizationId,
        });

        sendNotification({
          title: "Asset removed",
          message: "Your asset has been removed from the kit",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return payload({ kit });
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
          return data(payload({ error: validationError }), { status: 400 });
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

          return payload({ success: true });
        } catch (cause) {
          // Handle constraint violations and other barcode creation errors
          const reason = makeShelfError(cause);

          // Extract specific validation errors if they exist
          const validationErrors = reason.additionalData
            ?.validationErrors as any;
          if (validationErrors && validationErrors["barcodes[0].value"]) {
            return data(
              payload({ error: validationErrors["barcodes[0].value"].message }),
              {
                status: reason.status,
              }
            );
          }

          return data(payload({ error: reason.message }), {
            status: reason.status,
          });
        }
      }

      case "relink-qr-code": {
        const { newQrId } = parseData(
          formData,
          z.object({ newQrId: z.string() })
        );

        await relinkKitQrCode({
          qrId: newQrId,
          kitId,
          organizationId,
          userId,
        });

        sendNotification({
          title: "QR Relinked",
          message: "A new qr code has been linked to your kit.",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return payload({ success: true });
      }

      default: {
        checkExhaustiveSwitch(intent);
        return payload(null);
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return data(error(reason), { status: reason.status });
  }
}

export default function KitDetails() {
  usePosition();
  const { kit, currentBooking, qrObj, lastScan, userId, currentOrganization } =
    useLoaderData<typeof loader>();
  const { roles } = useUserRoleHelper();
  const { canUseBarcodes } = useBarcodePermissions();

  const kitHasUnavailableAssets = kit.assetKits.some(
    (ak) => !ak.asset.availableToBook
  );

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
          <When truthy={!!kit.custody || !!currentBooking}>
            <CustodyCard
              className="mt-0"
              booking={currentBooking || undefined}
              hasPermission={userCanViewSpecificCustody({
                roles,
                custodianUserId: kit?.custody?.custodian?.user?.id,
                organization: currentOrganization,
                currentUserId: userId,
              })}
              custody={kit.custody ? [kit.custody] : null}
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
