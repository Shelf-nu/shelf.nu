import { BarcodeType, OrganizationRoles } from "@prisma/client";
import { DateTime } from "luxon";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { redirect, data, useLoaderData, Outlet } from "react-router";
import { z } from "zod";
import { createSetReminderSchema } from "~/components/asset-reminder/set-or-edit-reminder-dialog";
import ActionsDropdown from "~/components/assets/actions-dropdown";
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import BookingActionsDropdown from "~/components/assets/booking-actions-dropdown";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";
import { toStillOutBookingRows } from "~/modules/asset/quantity-breakdown.server";
import {
  deleteAsset,
  deleteOtherImages,
  getAsset,
  relinkAssetQrCode,
} from "~/modules/asset/service.server";
import { isQuantityTracked } from "~/modules/asset/utils";
import { createAssetReminder } from "~/modules/asset-reminder/service.server";
import { createBarcode } from "~/modules/barcode/service.server";
import {
  validateBarcodeValue,
  normalizeBarcodeValue,
} from "~/modules/barcode/validation";
import { computeCheckedOutByBookingForAsset } from "~/modules/booking/checked-out.server";
import { getTeamMembersForQuantityCustody } from "~/modules/team-member/service.server";
import assetCss from "~/styles/asset.css?url";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { redactCustodianForViewer } from "~/utils/custody-visibility.server";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  error,
  getParams,
  payload,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
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

/**
 * Asset detail page parent loader.
 *
 * Ships the canonical `asset` record consumed by both this page's header
 * (notably `AssetStatusBadge` in the sub-heading) AND every child route
 * outlet (`assets.$assetId.overview.tsx`, `…activity.tsx`, `…bookings.tsx`,
 * `…reminders.tsx`). Because the header `AssetStatusBadge` reads its
 * quantity-aware tooltip data straight from `asset.bookingAssets`, this
 * loader is responsible for honouring the
 * {@link import('~/components/assets/asset-status-badge/quantity-data').getQuantityData getQuantityData}
 * contract for ONGOING/OVERDUE rows: `BookingAsset.quantity` on those rows is
 * the units still off the shelf on that booking, not the raw pivot snapshot.
 *
 * If a child route adds another badge / tooltip that reads `bookingAssets`
 * from the parent loader, it inherits this shape. The rows are built by
 * `toStillOutBookingRows`, the same function the lazy-fetch endpoint uses, so
 * the two paths agree.
 *
 * @see {@link file://./../../modules/asset/quantity-breakdown.server.ts}
 * @see {@link file://./../../components/assets/asset-status-badge/quantity-data.ts}
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations, role, canSeeAllCustody } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      });

    const asset = await getAsset({
      id,
      organizationId,
      userOrganizations,
      request,
      include: {
        // Model cover image for an asset with no image of its own
        ...ASSET_MODEL_IMAGE_SELECT,
        // Explicit select rather than `include: { custodian: true }`: the
        // include returned every `Custody` scalar, `teamMemberId` among them —
        // a stable per-holder identifier that survives redaction (which only
        // empties `custodian`) and groups a colleague's items for a restricted
        // viewer. Mirrors the shape at `modules/asset/fields.ts`. Nothing reads
        // `custody.teamMemberId` client-side; the release control keys on
        // `custodian.id`.
        custody: {
          select: {
            createdAt: true,
            quantity: true,
            custodian: {
              select: {
                id: true,
                name: true,
                userId: true,
                user: {
                  select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    displayName: true,
                    profilePicture: true,
                  },
                },
              },
            },
          },
        },
        assetKits: {
          select: {
            id: true,
            quantity: true,
            kit: { select: { id: true, name: true, status: true } },
          },
        },
        qrCodes: true,
        bookingAssets: {
          where: {
            booking: { status: { in: ["RESERVED", "ONGOING", "OVERDUE"] } },
          },
          select: {
            quantity: true,
            assetKitId: true,
            booking: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });

    /**
     * The header `AssetStatusBadge` tooltip reads `asset.bookingAssets`, so
     * ONGOING / OVERDUE rows carry the units still off the shelf, through the
     * same `toStillOutBookingRows` the lazy-fetch endpoint uses. The tooltip
     * and the overview's "Checked out" figure therefore agree.
     */
    const assetWithEffectiveBookingAssets = {
      ...asset,
      bookingAssets: toStillOutBookingRows(
        asset.bookingAssets ?? [],
        await computeCheckedOutByBookingForAsset(db, asset.id, organizationId)
      ),
    };

    /**
     * For QUANTITY_TRACKED assets, fetch team members so the
     * QuantityCustodyDialog in the actions dropdown has initial data.
     */
    const { teamMembers, totalTeamMembers } = isQuantityTracked(asset)
      ? await getTeamMembersForQuantityCustody({
          organizationId,
          request,
          userId,
          // The rule, not a role check: `isSelfService` was false for BASE, so
          // the seed shipped the whole roster — with every user's email and
          // Stripe id — to a role that cannot assign custody at all.
          role,
          canSeeAllCustody,
        })
      : { teamMembers: [], totalTeamMembers: 0 };

    const header: HeaderData = {
      title: asset.title,
    };

    /**
     * `custody: { include: { custodian: true } }` selects the whole TeamMember
     * row, and this route is gated on `asset: read` — held by BASE and
     * SELF_SERVICE. Redacting the list payloads is not enough on its own: the
     * ids are in the list, so iterating the detail pages recovers exactly the
     * identities the index just removed.
     */
    const [redactedAsset] = redactCustodianForViewer(
      [assetWithEffectiveBookingAssets],
      { canSeeAllCustody, userId }
    );

    return payload({
      asset: redactedAsset,
      header,
      teamMembers,
      totalTeamMembers,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * Handles the asset page's own intents: delete, relink QR code, set reminder and
 * add barcode. Each intent is permission-checked against the action it maps to,
 * so deleting needs `asset: delete` while the other three need `asset: update`.
 *
 * @returns A redirect after deletion, or the intent's result or failure with its status
 */
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
      z.object({
        intent: z.enum([
          "delete",
          "relink-qr-code",
          "set-reminder",
          "add-barcode",
        ]),
      })
    );

    const intent2ActionMap: { [K in typeof intent]: PermissionAction } = {
      delete: PermissionAction.delete,
      "relink-qr-code": PermissionAction.update,
      "set-reminder": PermissionAction.update,
      "add-barcode": PermissionAction.update,
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

        // Name the actor, or the activity event records the deletion as
        // "System" — the mobile delete route already passes it, so the same
        // action read differently depending on where it was performed.
        await deleteAsset({ organizationId, id, actorUserId: userId });

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

        return redirect("/assets");
      }

      case "relink-qr-code": {
        const { newQrId } = parseData(
          formData,
          z.object({ newQrId: z.string() })
        );

        await relinkAssetQrCode({
          qrId: newQrId,
          assetId: id,
          organizationId,
          userId,
        });

        sendNotification({
          title: "QR Relinked",
          message: "A new qr code has been linked to your asset.",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return payload({ success: true });
      }

      case "set-reminder": {
        // Resolve the acting user's timezone BEFORE validating so the schema's
        // "must be in the future" check runs in the SAME zone the value is later
        // stored in (below) and the SAME zone the client validated in. Validating
        // with the default server-zone schema first, then storing in the pref
        // zone, lets the two disagree for a wall-clock time near "now".
        const { timeZone } = await resolveUserFormatPrefsById(
          userId,
          getClientHint(request)
        );

        const { redirectTo, ...payload } = parseData(
          formData,
          createSetReminderSchema({ timeZone }),
          { shouldBeCaptured: false }
        );

        // Parse the submitted wall-clock time in that same resolved timezone —
        // not the browser hint. When the two differ the browser zone would
        // offset the stored UTC instant wrong.
        const alertDateTime = DateTime.fromFormat(
          formData.get("alertDateTime")!.toString()!,
          DATE_TIME_FORMAT,
          {
            zone: timeZone,
          }
        ).toJSDate();

        await createAssetReminder({
          ...payload,
          assetId: id,
          alertDateTime,
          organizationId,
          createdById: userId,
        });

        sendNotification({
          title: "Reminder created",
          message: "A reminder for you asset has been created successfully.",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return redirect(safeRedirect(redirectTo));
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
            assetId: id,
          });

          sendNotification({
            title: "Barcode added",
            message: "Barcode has been added to your asset successfully",
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

      default: {
        checkExhaustiveSwitch(intent);
        return payload(null);
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return data(error(reason), { status: reason.status });
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
];

export default function AssetDetailsPage() {
  const { asset } = useLoaderData<typeof loader>();

  const { roles } = useUserRoleHelper();

  const items = [
    { to: "overview", content: "Overview" },
    // The activity loader requires `note:read` and 403s without it, so a role
    // that can't read notes must not be offered the tab. Mirrors the bookings
    // detail page.
    ...(userHasPermission({
      roles,
      entity: PermissionEntity.note,
      action: PermissionAction.read,
    })
      ? [{ to: "activity", content: "Activity" }]
      : []),
    { to: "bookings", content: "Bookings" },
    ...(userHasPermission({
      roles,
      entity: PermissionEntity.assetReminders,
      action: PermissionAction.read,
    })
      ? [{ to: "reminders", content: "Reminders" }]
      : []),
  ];

  return (
    <div className="relative">
      <Header
        slots={{
          "left-of-title": (
            <AssetImage
              key={asset.id}
              asset={{
                id: asset.id,
                mainImage: asset.mainImage,
                thumbnailImage: asset.thumbnailImage,
                mainImageExpiration: asset.mainImageExpiration,
                assetModel: asset.assetModel ?? null,
              }}
              alt={`Image of ${asset.title}`}
              className={tw(
                "mr-4 size-14 cursor-pointer rounded border object-cover"
              )}
              withPreview
            />
          ),
        }}
        subHeading={
          <div className="flex gap-2">
            <AssetStatusBadge
              id={asset.id}
              status={asset.status}
              availableToBook={asset.availableToBook}
              asset={asset}
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
        <BookingActionsDropdown />
      </Header>
      <HorizontalTabs items={items} />
      <div>
        <Outlet />
      </div>
    </div>
  );
}
