import { BarcodeType } from "@prisma/client";
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
import { DateS } from "~/components/shared/date";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { draftBookingsNote } from "~/modules/asset/archive-messages";
import {
  CONFIRM_MODEL_SHORTFALL_FIELD,
  isModelShortfallMessage,
} from "~/modules/asset/archive-shortfall";
import { getAssetAvailability } from "~/modules/asset/availability.server";
import { getCustodySourceSummary } from "~/modules/asset/custody-source.server";
import { ASSET_MODEL_IMAGE_SELECT } from "~/modules/asset/image-select";
import { toStillOutBookingRows } from "~/modules/asset/quantity-breakdown.server";
import {
  archiveAsset,
  assertAssetDeleteConfirmed,
  deleteAsset,
  getAsset,
  relinkAssetQrCode,
  unarchiveAsset,
} from "~/modules/asset/service.server";
import { isQuantityTracked } from "~/modules/asset/utils";
import { createAssetReminder } from "~/modules/asset-reminder/service.server";
import { resolveReminderPayloadDates } from "~/modules/asset-reminder/utils.server";
import { createBarcode } from "~/modules/barcode/service.server";
import {
  validateBarcodeValue,
  normalizeBarcodeValue,
} from "~/modules/barcode/validation";
import { computeCheckedOutByBookingForAsset } from "~/modules/booking/checked-out.server";
import { getTeamMembersForQuantityCustody } from "~/modules/team-member/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import assetCss from "~/styles/asset.css?url";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint } from "~/utils/client-hints";
import { redactCustodianForViewer } from "~/utils/custody-visibility.server";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { DeleteConfirmationSchema } from "~/utils/delete-confirmation";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  error,
  getParams,
  payload,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import { assertAssetsAreNotArchived } from "~/utils/org-validation.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import {
  assertUserCanUseRecurringReminders,
  canUseRecurringReminders,
} from "~/utils/subscription.server";
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
    const { organizationId, userOrganizations, organizations, access } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      });

    /**
     * Drives the Repeat control in the set-reminder dialog. Started now so it
     * runs alongside the asset reads, and a failed lookup only locks that
     * control: the server re-checks the plan on every recurring write.
     */
    const tierLimitPromise = getOrganizationTierLimit({
      organizationId,
      organizations,
    }).catch(() => null);

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
            // `from` lets the status tooltip say WHEN each claim starts, which
            // is what reconciles "12 reserved" with "10 free right now".
            // Mirrors the select in `getAssetQuantityRows`, the lazy-fetch
            // endpoint and this inline-SSR path feed the SAME component, so a
            // field added to one has to be added to the other or the tooltip
            // silently loses the date on whichever surface was missed.
            // `to` decides whether a RESERVED slice is an expired
            // reservation, which the reducer leaves out of `reserved`.
            booking: {
              select: {
                id: true,
                name: true,
                status: true,
                from: true,
                to: true,
              },
            },
          },
          // Soonest first, the tooltip caps how many slices it renders, so
          // this decides which ones survive the cut.
          orderBy: { booking: { from: "asc" } },
        },
      },
    });

    /**
     * Four reads only a QUANTITY_TRACKED asset needs, run together since none
     * depends on another. An INDIVIDUAL asset's badge asks
     * `/api/assets/:id/ongoing-booking` instead of reading `bookingAssets`,
     * and it has no quantity custody dialogs, so it pays for none of them.
     *
     *  - Units still out per active booking. The header `AssetStatusBadge`
     *    tooltip reads `asset.bookingAssets`, so ONGOING / OVERDUE rows carry
     *    these units through the same `toStillOutBookingRows` the lazy-fetch
     *    endpoint uses, and agree with the overview's "Checked out" figure.
     *  - Team members, so the QuantityCustodyDialog in the actions dropdown
     *    has initial data.
     *  - Where the asset's units can come from, for the Assign and Adjust
     *    dialogs. Built here, in the loader both entry points share (the
     *    header's actions menu and the overview's custody and quantity cards),
     *    so they always show the same numbers. Counts only, no names, so it
     *    needs no redaction.
     *  - The engine's free-now figure for the header tooltip.
     */
    const qtyTracked = isQuantityTracked(asset);
    const [
      stillOutByBooking,
      { teamMembers, totalTeamMembers },
      custodySources,
      freeNow,
    ] = qtyTracked
      ? await Promise.all([
          computeCheckedOutByBookingForAsset(db, asset.id, organizationId),
          getTeamMembersForQuantityCustody({
            organizationId,
            request,
            userId,
            access,
          }),
          getCustodySourceSummary({
            assetId: asset.id,
            organizationId,
            total: asset.quantity ?? 0,
          }),
          // The engine's free-now figure, so the header tooltip's "free right
          // now" matches the Quantity Overview and the assets index.
          getAssetAvailability({ assetId: asset.id, organizationId }).then(
            (availability) => Math.max(0, availability.physicalAvailable)
          ),
        ])
      : [
          null,
          { teamMembers: [], totalTeamMembers: 0 },
          { multiSource: false, options: [], poolAvailable: 0 },
          null,
        ];

    const assetWithEffectiveBookingAssets = stillOutByBooking
      ? {
          ...asset,
          bookingAssets: toStillOutBookingRows(
            asset.bookingAssets ?? [],
            stillOutByBooking
          ),
          freeNow,
        }
      : asset;

    const header: HeaderData = {
      title: asset.title,
    };

    const tierLimit = await tierLimitPromise;

    /**
     * `custody: { include: { custodian: true } }` selects the whole TeamMember
     * row, and this route is gated on `asset: read` — held by BASE and
     * SELF_SERVICE. Redacting the list payloads is not enough on its own: the
     * ids are in the list, so iterating the detail pages recovers exactly the
     * identities the index just removed.
     */
    const [redactedAsset] = redactCustodianForViewer(
      [assetWithEffectiveBookingAssets],
      { canSeeAllCustody: access.custody.seeAll, userId }
    );

    return payload({
      asset: redactedAsset,
      header,
      teamMembers,
      totalTeamMembers,
      custodySources,
      canUseRecurringReminders: canUseRecurringReminders(tierLimit),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * Handles the asset page's own intents: delete, relink QR code, set reminder and
 * add barcode. Each intent is permission-checked against the permission it maps
 * to: deleting needs `asset: delete`, setting a reminder `assetReminders: create`,
 * and relinking a QR code or adding a barcode `asset: update`.
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
          "archive",
          "reinstate",
          "relink-qr-code",
          "set-reminder",
          "add-barcode",
        ]),
      })
    );

    // Setting a reminder has its own permission; the other intents act on
    // the asset itself.
    const intent2Permission: {
      [K in typeof intent]: {
        entity: PermissionEntity;
        action: PermissionAction;
      };
    } = {
      delete: {
        entity: PermissionEntity.asset,
        action: PermissionAction.delete,
      },
      // Reinstating is the inverse of archiving, so one grant covers both.
      archive: {
        entity: PermissionEntity.asset,
        action: PermissionAction.archive,
      },
      reinstate: {
        entity: PermissionEntity.asset,
        action: PermissionAction.archive,
      },
      "relink-qr-code": {
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      },
      "set-reminder": {
        entity: PermissionEntity.assetReminders,
        action: PermissionAction.create,
      },
      "add-barcode": {
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      },
    };

    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      ...intent2Permission[intent],
    });

    // Archived assets are frozen (issue #382): only delete + reinstate are
    // allowed. Block the other mutating intents server-side.
    if (
      intent === "relink-qr-code" ||
      intent === "set-reminder" ||
      intent === "add-barcode"
    ) {
      await assertAssetsAreNotArchived({
        assetIds: [id],
        organizationId,
        actorUserId: userId,
      });
    }

    switch (intent) {
      case "delete": {
        const { confirmation } = parseData(formData, DeleteConfirmationSchema);

        // The dialog asks for the asset's title; refuse a request that skipped it.
        await assertAssetDeleteConfirmed({ id, organizationId, confirmation });

        // Name the actor, or the activity event records the deletion as
        // "System". `deleteAsset` also removes the stored image files.
        await deleteAsset({ organizationId, id, actorUserId: userId });

        sendNotification({
          title: "Asset deleted",
          message: "Your asset has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: authSession.userId,
        });

        return redirect("/assets");
      }

      case "archive": {
        const { draftBookings } = await archiveAsset({
          id,
          organizationId,
          actorUserId: userId,
          // Set by the "Archive anyway" prompt after the shortfall warning.
          confirmModelShortfall:
            formData.get(CONFIRM_MODEL_SHORTFALL_FIELD) === "true",
        });

        sendNotification({
          title: "Asset archived",
          message: `The asset is hidden from your lists and can't be booked. You can reinstate it any time.${draftBookingsNote(
            draftBookings
          )}`,
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return payload({ success: true });
      }

      case "reinstate": {
        const { availableToBook } = await unarchiveAsset({
          id,
          organizationId,
          actorUserId: userId,
        });

        sendNotification({
          title: "Asset reinstated",
          // Archiving never changed availability, so an asset marked
          // unavailable before it was archived is still unavailable now.
          message: availableToBook
            ? "The asset is active again and available to book."
            : "The asset is active again. It is still marked as unavailable for bookings.",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return payload({ success: true });
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
        // stored in and the SAME zone the client validated in.
        const { timeZone } = await resolveUserFormatPrefsById(
          userId,
          getClientHint(request)
        );

        const {
          redirectTo,
          repeat,
          endsAt: _endsAt,
          ...payload
        } = parseData(formData, createSetReminderSchema({ timeZone }), {
          shouldBeCaptured: false,
        });

        // Parse the submitted wall-clock time (and the optional end date) in
        // that same resolved timezone, which also becomes the series' zone.
        const { alertDateTime, recurrence } = resolveReminderPayloadDates({
          timeZone,
          formData,
          repeat,
        });

        /**
         * One-shot reminders stay free; only an actual recurrence request is
         * tier-gated (server-side, the disabled UI control is not a gate).
         */
        if (recurrence) {
          await assertUserCanUseRecurringReminders({
            organizationId,
            organizations,
          });
        }

        await createAssetReminder({
          ...payload,
          assetId: id,
          alertDateTime,
          recurrence,
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
    // The model-reservation warning is a question, not a failure: the Actions
    // menu turns it into an "Archive anyway" prompt, so no error toast.
    const isShortfallWarning = isModelShortfallMessage(reason.message);
    return data(error(reason, !isShortfallWarning), { status: reason.status });
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

  const roles = useOrganizationRoles();

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
          <div className="flex flex-wrap items-center gap-2">
            <AssetStatusBadge
              id={asset.id}
              status={asset.status}
              availableToBook={asset.availableToBook}
              asset={asset}
              isArchived={!!asset.archivedAt}
            />
            {/* When it left service; who did it is on the Activity tab. */}
            {asset.archivedAt ? (
              <span className="text-sm text-gray-600">
                Archived on <DateS date={asset.archivedAt} />
              </span>
            ) : null}
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
