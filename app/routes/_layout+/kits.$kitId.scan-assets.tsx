import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigation } from "@remix-run/react";
import { useSetAtom } from "jotai";
import { z } from "zod";
import { addScannedItemAtom } from "~/atoms/qr-scanner";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { CodeScanner } from "~/components/scanner/code-scanner";
import type { OnQrDetectionSuccessProps } from "~/components/scanner/code-scanner";
import AddAssetsToKitDrawer from "~/components/scanner/drawer/uses/add-assets-to-kit-drawer";
import { db } from "~/database/db.server";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { userPrefs } from "~/utils/cookies.server";

import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export type LoaderData = typeof loader;

export async function loader({ context, request, params }: LoaderFunctionArgs) {
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
      action: PermissionAction.update,
    });

    const kit = await db.kit
      .findFirstOrThrow({
        where: { id: kitId, organizationId },
        select: {
          id: true,
          name: true,
          qrCodes: {
            select: { id: true },
          },
          assets: { select: { id: true } },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Kit not found!",
          message:
            "The kit you are trying to access does not exists or you do not have permission to asset it.",
          status: 404,
          label: "Kit",
        });
      });

    /** We get the userPrefs cookie so we can see if there is already a default camera */
    const cookieHeader = request.headers.get("Cookie");
    const cookie = (await userPrefs.parse(cookieHeader)) || {};

    const header: HeaderData = {
      title: `Scan assets for kit | ${kit.name}`,
    };

    return json(data({ header, kit, scannerCameraId: cookie.scannerCameraId }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  name: "kit.scan-assets",
};

// export async function action({ context, request, params }: ActionFunctionArgs) {
//   const authSession = context.getSession();
//   const { userId } = authSession;

//   const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
//     additionalData: { userId },
//   });

//   try {
//     const { organizationId } = await requirePermission({
//       userId: authSession.userId,
//       request,
//       entity: PermissionEntity.kit,
//       action: PermissionAction.update,
//     });

//     let { assetIds } = parseData(
//       await request.formData(),
//       z.object({
//         assetIds: z.array(z.string()).optional().default([]),
//       }),
//       { additionalData: { userId, organizationId, kitId } }
//     );

//     const user = await getUserByID(userId);

//     const kit = await db.kit
//       .findUniqueOrThrow({
//         where: { id: kitId, organizationId },
//         include: {
//           assets: {
//             select: {
//               id: true,
//               title: true,
//               kit: true,
//               bookings: { select: { id: true, status: true } },
//             },
//           },
//           custody: {
//             select: {
//               custodian: {
//                 select: {
//                   id: true,
//                   name: true,
//                   user: {
//                     select: {
//                       email: true,
//                       firstName: true,
//                       lastName: true,
//                       profilePicture: true,
//                     },
//                   },
//                 },
//               },
//             },
//           },
//         },
//       })
//       .catch((cause) => {
//         throw new ShelfError({
//           cause,
//           message: "Kit not found",
//           additionalData: { kitId, userId, organizationId },
//           status: 404,
//           label: "Kit",
//         });
//       });

//     const removedAssets = kit.assets.filter(
//       (asset) => !assetIds.includes(asset.id)
//     );

//     /**
//      * If user has selected all assets, then we have to get ids of all those assets
//      * with respect to the filters applied.
//      * */
//     const hasSelectedAll = assetIds.includes(ALL_SELECTED_KEY);
//     if (hasSelectedAll) {
//       const searchParams = getCurrentSearchParams(request);
//       const assetsWhere = getAssetsWhereInput({
//         organizationId,
//         currentSearchParams: searchParams.toString(),
//       });

//       const allAssets = await db.asset.findMany({
//         where: assetsWhere,
//         select: { id: true },
//       });
//       const kitAssets = kit.assets.map((asset) => asset.id);
//       const removedAssetsIds = removedAssets.map((asset) => asset.id);

//       /**
//        * New assets that needs to be added are
//        * - Previously added assets
//        * - All assets with applied filters
//        */
//       assetIds = [
//         ...new Set([
//           ...allAssets.map((asset) => asset.id),
//           ...kitAssets.filter((asset) => !removedAssetsIds.includes(asset)),
//         ]),
//       ];
//     }

//     const newlyAddedAssets = await db.asset
//       .findMany({
//         where: { id: { in: assetIds } },
//         select: { id: true, title: true, kit: true, custody: true },
//       })
//       .catch((cause) => {
//         throw new ShelfError({
//           cause,
//           message:
//             "Something went wrong while fetching the assets. Please try again or contact support.",
//           additionalData: { assetIds, userId, kitId },
//           label: "Assets",
//         });
//       });

//     /** An asset already in custody cannot be added to a kit */
//     const isSomeAssetInCustody = newlyAddedAssets.some(
//       (asset) => asset.custody && asset.kit?.id !== kit.id
//     );
//     if (isSomeAssetInCustody) {
//       throw new ShelfError({
//         cause: null,
//         message: "Cannot add unavailable asset in a kit.",
//         additionalData: { userId, kitId },
//         label: "Kit",
//         shouldBeCaptured: false,
//       });
//     }

//     const kitBookings =
//       kit.assets.find((a) => a.bookings.length > 0)?.bookings ?? [];

//     await db.kit.update({
//       where: { id: kit.id, organizationId },
//       data: {
//         assets: {
//           /**
//            * set: [] will make sure that if any previously selected asset is removed,
//            * then it is also disconnected from the kit
//            */
//           set: [],
//           /**
//            * Then this will update the assets to be whatever user has selected now
//            */
//           connect: newlyAddedAssets.map(({ id }) => ({ id })),
//         },
//       },
//     });

//     await createBulkKitChangeNotes({
//       kit,
//       newlyAddedAssets,
//       removedAssets,
//       userId,
//     });

//     /**
//      * If a kit is in custody then the assets added to kit will also inherit the status
//      */
//     const assetsToInheritStatus = newlyAddedAssets.filter(
//       (asset) => !asset.custody
//     );
//     if (
//       kit.custody &&
//       kit.custody.custodian.id &&
//       assetsToInheritStatus.length > 0
//     ) {
//       await Promise.all([
//         ...assetsToInheritStatus.map((asset) =>
//           db.asset.update({
//             where: { id: asset.id },
//             data: {
//               status: AssetStatus.IN_CUSTODY,
//               custody: {
//                 create: {
//                   custodian: { connect: { id: kit.custody?.custodian.id } },
//                 },
//               },
//             },
//           })
//         ),
//         db.note.createMany({
//           data: assetsToInheritStatus.map((asset) => ({
//             content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${resolveTeamMemberName(
//               (kit.custody as NonNullable<typeof kit.custody>).custodian
//             )}** custody over **${asset.title.trim()}**`,
//             type: "UPDATE",
//             userId,
//             assetId: asset.id,
//           })),
//         }),
//       ]);
//     }

//     /**
//      * If a kit is in custody and some assets are removed,
//      * then we have to make the removed assets Available
//      */
//     if (removedAssets.length && kit.custody?.custodian.id) {
//       await Promise.all([
//         db.custody.deleteMany({
//           where: { assetId: { in: removedAssets.map((a) => a.id) } },
//         }),
//         db.asset.updateMany({
//           where: { id: { in: removedAssets.map((a) => a.id) } },
//           data: { status: AssetStatus.AVAILABLE },
//         }),
//         db.note.createMany({
//           data: removedAssets.map((asset) => ({
//             content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has released **${resolveTeamMemberName(
//               (kit.custody as NonNullable<typeof kit.custody>).custodian
//             )}'s** custody over **${asset.title.trim()}**`,
//             type: "UPDATE",
//             userId,
//             assetId: asset.id,
//           })),
//         }),
//       ]);
//     }

//     /**
//      * If user is adding/removing an asset to a kit which is a part of DRAFT, RESERVED, ONGOING or OVERDUE booking,
//      * then we have to add or remove these assets to booking also
//      */
//     const bookingsToUpdate = kitBookings.filter(
//       (b) =>
//         b.status === "DRAFT" ||
//         b.status === "RESERVED" ||
//         b.status === "ONGOING" ||
//         b.status === "OVERDUE"
//     );

//     if (bookingsToUpdate?.length) {
//       await Promise.all(
//         bookingsToUpdate.map((booking) =>
//           db.booking.update({
//             where: { id: booking.id },
//             data: {
//               assets: {
//                 connect: newlyAddedAssets.map((a) => ({ id: a.id })),
//                 disconnect: removedAssets.map((a) => ({ id: a.id })),
//               },
//             },
//           })
//         )
//       );
//     }

//     /**
//      * If the kit is part of an ONGOING booking, then we have to make all
//      * the assets CHECKED_OUT
//      */
//     if (kit.status === KitStatus.CHECKED_OUT) {
//       await db.asset.updateMany({
//         where: { id: { in: newlyAddedAssets.map((a) => a.id) } },
//         data: { status: AssetStatus.CHECKED_OUT },
//       });
//     }

//     return redirect(`/kits/${kitId}/assets`);
//   } catch (cause) {
//     const reason = makeShelfError(cause, { userId, kitId });
//     return json(error(reason), { status: reason.status });
//   }
// }

export default function ScanAssetsForKit() {
  const addItem = useSetAtom(addScannedItemAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 67 : vh - 100;
  function handleQrDetectionSuccess({
    qrId,
    error,
  }: OnQrDetectionSuccessProps) {
    /** WE send the error to the item. addItem will automatically handle the data based on its value */
    addItem(qrId, error);
  }

  return (
    <>
      <Header hidePageDescription />

      <AddAssetsToKitDrawer isLoading={isLoading} />

      <div className="-mx-4 flex flex-col" style={{ height: `${height}px` }}>
        <CodeScanner
          isLoading={isLoading}
          onQrDetectionSuccess={handleQrDetectionSuccess}
          backButtonText="Booking"
          allowNonShelfCodes
          paused={false}
          setPaused={() => {}}
          scannerModeClassName={(mode) =>
            tw(mode === "scanner" && "justify-start pt-[100px]")
          }
        />
      </div>
    </>
  );
}
