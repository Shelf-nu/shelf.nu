import type {
  MetaFunction,
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { CustodyCard } from "~/components/assets/asset-custody-card";
import AssetQR from "~/components/assets/asset-qr";
import { Switch } from "~/components/forms/switch";
import Icon from "~/components/icons/icon";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";
import { ScanDetails } from "~/components/location/scan-details";

import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Tag } from "~/components/shared/tag";
import TextualDivider from "~/components/shared/textual-divider";
import { usePosition } from "~/hooks/use-position";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import { ASSET_OVERVIEW_FIELDS } from "~/modules/asset/fields";
import {
  getAsset,
  updateAssetBookingAvailability,
} from "~/modules/asset/service.server";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import {
  createQr,
  generateCode,
  getQrByAssetId,
} from "~/modules/qr/service.server";
import { getScanByQrId } from "~/modules/scan/service.server";
import { parseScanData } from "~/modules/scan/utils.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint, getDateTimeFormat } from "~/utils/client-hints";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { error, getParams, data, parseData } from "~/utils/http.server";
import { isLink } from "~/utils/misc";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
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
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const { locale, timeZone } = getClientHint(request);

    const asset = await getAsset({
      id,
      organizationId,
      include: ASSET_OVERVIEW_FIELDS,
    });

    let qr = await getQrByAssetId({ assetId: id });

    /** If for some reason there is no QR, we create one and return it */
    if (!qr) {
      qr = await createQr({ assetId: id, userId, organizationId });
    }

    /** Create a QR code with a URL */
    const { sizes, code } = await generateCode({
      version: qr.version as TypeNumber,
      errorCorrection: qr.errorCorrection as ErrorCorrectionLevel,
      size: "medium",
      qr,
    });

    /**
     * We get the first QR code(for now we can only have 1)
     * And using the ID of tha qr code, we find the latest scan
     */
    const lastScan = asset.qrCodes[0]?.id
      ? parseScanData({
          scan: (await getScanByQrId({ qrId: asset.qrCodes[0].id })) || null,
          userId,
          request,
        })
      : null;

    let custody = null;
    if (asset.custody) {
      const date = new Date(asset.custody.createdAt);
      const dateDisplay = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);

      custody = {
        ...asset.custody,
        dateDisplay,
      };
    }

    const qrObj = {
      qr: code,
      sizes,
      showSidebar: true,
    };

    const booking = asset.bookings.length > 0 ? asset.bookings[0] : undefined;
    let currentBooking: any = null;

    if (booking && booking.from) {
      const bookingFrom = new Date(booking.from);
      const bookingDateDisplay = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(bookingFrom);

      currentBooking = { ...booking, from: bookingDateDisplay };

      asset.bookings = [currentBooking];
    }

    const header: HeaderData = {
      title: `${asset.title}'s overview`,
    };

    return json(
      data({
        asset: {
          ...asset,
          createdAt: getDateTimeFormat(request, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(asset.createdAt),
          custody,
          /** We only need customField with same category of asset or without any category */
          customFields: asset.categoryId
            ? asset.customFields.filter(
                (cf) =>
                  !cf.customField.categories.length ||
                  cf.customField.categories
                    .map((c) => c.id)
                    .includes(asset.categoryId!)
              )
            : asset.customFields,
        },
        lastScan,
        header,
        locale,
        timeZone,
        qrObj,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason));
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Overview",
};

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
      z.object({ intent: z.enum(["toggle"]) })
    );

    if (intent === "toggle") {
      const { availableToBook } = parseData(
        formData,
        AvailabilityForBookingFormSchema
      );

      await updateAssetBookingAvailability(id, availableToBook);

      sendNotification({
        title: "Asset availability status updated successfully",
        message: "Your asset's availability for booking has been updated",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return json(data(null));
    } else {
      checkExhaustiveSwitch(intent);
      return json(data(null));
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return json(error(reason), { status: reason.status });
  }
}

export default function AssetOverview() {
  const { asset, locale, timeZone, qrObj } = useLoaderData<typeof loader>();
  const booking = asset?.bookings?.length ? asset?.bookings[0] : undefined;

  const customFieldsValues =
    asset && asset.customFields?.length > 0
      ? asset.customFields.filter((f) => f.value)
      : [];
  const location = asset && asset.location;
  usePosition();
  const fetcher = useFetcher();
  const zo = useZorm(
    "NewQuestionWizardScreen",
    AvailabilityForBookingFormSchema
  );
  const isSelfService = useUserIsSelfService();

  return (
    <div>
      <ContextualModal />
      <div className="mt-[-16px] block lg:flex">
        <div className="flex-1 overflow-hidden">
          <Card className="my-3 px-[-4] py-[-5]">
            <ul className="item-information">
              <li className="flex w-full border-b-[1.1px] border-b-gray-100 p-4">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  ID
                </span>
                <div className="w-3/5 text-gray-600">{asset?.id}</div>
              </li>
              <li className="flex w-full border-b-[1.1px] border-b-gray-100 p-4">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  Created
                </span>
                <div className="w-3/5 text-gray-600">
                  {asset && asset.createdAt}
                </div>
              </li>

              {asset?.category ? (
                <li className="flex w-full border-b-[1.1px] border-b-gray-100 p-4">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Category
                  </span>
                  <div className="w-3/5 text-gray-600">
                    <Badge color={asset.category?.color} withDot={false}>
                      {asset.category?.name}
                    </Badge>
                  </div>
                </li>
              ) : (
                <li className="flex w-full border-b-[1.1px] border-b-gray-100 p-4">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Category
                  </span>
                  <div className="w-3/5 text-gray-600">
                    <Badge color={"#808080"} withDot={false}>
                      Uncategorized
                    </Badge>
                  </div>
                </li>
              )}
              {location ? (
                <li className="flex w-full border-b-[1.1px] border-b-gray-100 p-4">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Location
                  </span>
                  <div className="-ml-2 w-3/5 text-gray-600">
                    <Tag key={location.id} className="ml-2">
                      {location.name}
                    </Tag>
                  </div>
                </li>
              ) : null}
              {asset?.description ? (
                <li className="flex w-full border-b-[1.1px] border-b-gray-100 p-4">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Description
                  </span>
                  <div className="w-3/5 whitespace-pre-wrap text-gray-600">
                    {asset.description}
                  </div>
                </li>
              ) : null}
              {asset && asset?.tags?.length > 0 ? (
                <li className="flex w-full border-b-[1.1px] border-b-gray-100 p-4">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Tags
                  </span>
                  <div className="-ml-2 w-3/5 text-gray-600">
                    {asset.tags.map((tag) => (
                      <Tag key={tag.id} className="ml-2">
                        {tag.name}
                      </Tag>
                    ))}
                  </div>
                </li>
              ) : null}
              {asset?.organization && asset.valuation ? (
                <li className="flex w-full border-b-[1.1px] border-b-gray-100 p-4">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Value
                  </span>
                  <div className="-ml-2 mb-2 w-3/5">
                    <Tag key={asset.valuation} className="ml-2">
                      <>
                        {asset.valuation.toLocaleString(locale, {
                          style: "currency",
                          currency: asset.organization.currency,
                        })}
                      </>
                    </Tag>
                  </div>
                </li>
              ) : null}
            </ul>
          </Card>

          {/* Here custom fields relates to AssetCustomFieldValue */}
          {customFieldsValues?.length > 0 ? (
            <>
              <TextualDivider
                text="Custom fields"
                className="mb-8 pt-3 lg:hidden"
              />
              <Card className="my-3 px-[-4] py-[-5]">
                <ul className="item-information">
                  {customFieldsValues.map((field, _index) => {
                    const customFieldDisplayValue = getCustomFieldDisplayValue(
                      field.value as unknown as ShelfAssetCustomFieldValueType["value"],
                      { locale, timeZone }
                    );
                    return (
                      <li
                        className={tw(
                          "flex w-full border-b-[1.1px] border-b-gray-100 p-4"
                        )}
                        key={field.id}
                      >
                        <span className="w-1/4 text-[14px] font-medium text-gray-900">
                          {field.customField.name}
                        </span>
                        <div className="w-3/5 max-w-[250px] text-gray-600">
                          {isLink(customFieldDisplayValue) ? (
                            <Button
                              role="link"
                              variant="link"
                              className="text-gray text-end font-normal underline hover:text-gray-600"
                              target="_blank"
                              to={`${customFieldDisplayValue}?ref=shelf-webapp`}
                            >
                              {customFieldDisplayValue}
                            </Button>
                          ) : (
                            customFieldDisplayValue
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </>
          ) : null}
        </div>

        <div className="w-full md:w-[360px] lg:ml-4">
          {!isSelfService ? (
            <Card className="my-3">
              <fetcher.Form
                ref={zo.ref}
                method="post"
                onChange={(e) => fetcher.submit(e.currentTarget)}
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-medium text-gray-700">
                      Available for bookings
                    </p>
                    <p className="text-[12px] text-gray-600">
                      Asset is available for being used in bookings
                    </p>
                  </div>
                  <Switch
                    name={zo.fields.availableToBook()}
                    disabled={isSelfService || isFormProcessing(fetcher.state)} // Disable for self service users
                    defaultChecked={asset?.availableToBook}
                    required
                    title={
                      isSelfService
                        ? "You do not have the permissions to change availability"
                        : "Toggle availability"
                    }
                  />
                  <input type="hidden" value="toggle" name="intent" />
                </div>
              </fetcher.Form>
            </Card>
          ) : null}

          {asset?.kit?.name ? (
            <Card className="my-3 py-3">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-full bg-gray-100/50">
                  <div className="flex size-7 items-center justify-center rounded-full bg-gray-200">
                    <Icon icon="kit" />
                  </div>
                </div>

                <div>
                  <h3 className="mb-1 text-sm font-semibold">
                    Included in kit
                  </h3>
                  <Button
                    to={`/kits/${asset.kitId}`}
                    role="link"
                    variant="link"
                    className={tw(
                      "justify-start text-sm font-normal text-gray-700 underline hover:text-gray-700"
                    )}
                  >
                    {asset.kit.name}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          <CustodyCard
            booking={booking}
            custody={asset?.custody || null}
            isSelfService={isSelfService}
          />

          {asset && <AssetQR qrObj={qrObj} asset={asset} />}
          {/* @TODO: Figure our the issue with type definition of `lastScan` */}
          {!isSelfService ? <ScanDetails /> : null}
        </div>
      </div>
      <ContextualSidebar />
    </div>
  );
}
