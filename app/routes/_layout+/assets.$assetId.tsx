import { BarcodeType } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { redirect, data } from "@remix-run/node";
import { useLoaderData, Outlet } from "@remix-run/react";
import { DateTime } from "luxon";
import { z } from "zod";
import { setReminderSchema } from "~/components/asset-reminder/set-or-edit-reminder-dialog";
import ActionsDropdown from "~/components/assets/actions-dropdown";
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import BookingActionsDropdown from "~/components/assets/booking-actions-dropdown";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import When from "~/components/when/when";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  deleteAsset,
  deleteOtherImages,
  getAsset,
  relinkQrCode,
} from "~/modules/asset/service.server";
import { createAssetReminder } from "~/modules/asset-reminder/service.server";
import { createBarcode } from "~/modules/barcode/service.server";
import {
  validateBarcodeValue,
  normalizeBarcodeValue,
} from "~/modules/barcode/validation";
import assetCss from "~/styles/asset.css?url";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getHints } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
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

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId: id } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations } = await requirePermission({
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
        custody: { include: { custodian: true } },
        kit: true,
        qrCodes: true,
      },
    });

    const header: HeaderData = {
      title: asset.title,
    };

    return payload({
      asset,
      header,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

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

        await deleteAsset({ organizationId, id });

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

        await relinkQrCode({
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
        const { redirectTo, ...payload } = parseData(
          formData,
          setReminderSchema
        );
        const hints = getHints(request);

        const alertDateTime = DateTime.fromFormat(
          formData.get("alertDateTime")!.toString()!,
          DATE_TIME_FORMAT,
          {
            zone: hints.timeZone,
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

  let items = [
    { to: "overview", content: "Overview" },
    { to: "activity", content: "Activity" },
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
              asset={{
                id: asset.id,
                mainImage: asset.mainImage,
                thumbnailImage: asset.thumbnailImage,
                mainImageExpiration: asset.mainImageExpiration,
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
