import type { RenderableTreeNode } from "@markdoc/markdoc";
import { CustomFieldType } from "@prisma/client";
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
import { AssetReminderCards } from "~/components/assets/asset-reminder-cards";
import { Switch } from "~/components/forms/switch";
import Icon from "~/components/icons/icon";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";
import { ScanDetails } from "~/components/location/scan-details";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { QrPreview } from "~/components/qr/qr-preview";

import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Tag } from "~/components/shared/tag";
import TextualDivider from "~/components/shared/textual-divider";
import When from "~/components/when/when";
import { usePosition } from "~/hooks/use-position";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { ASSET_OVERVIEW_FIELDS } from "~/modules/asset/fields";
import {
  getAsset,
  updateAssetBookingAvailability,
} from "~/modules/asset/service.server";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import { getRemindersForOverviewPage } from "~/modules/asset-reminder/service.server";

import { generateQrObj } from "~/modules/qr/utils.server";
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

    const { locale, timeZone } = getClientHint(request);

    const asset = await getAsset({
      id,
      organizationId,
      userOrganizations,
      request,
      include: ASSET_OVERVIEW_FIELDS,
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

    const qrObj = await generateQrObj({
      assetId: asset.id,
      userId,
      organizationId,
    });

    const reminders = await getRemindersForOverviewPage({
      assetId: id,
      organizationId,
      request,
    });

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
    /** We only need customField with same category of asset or without any category */
    let customFields = asset.categoryId
      ? asset.customFields.filter(
          (cf) =>
            !cf.customField.categories.length ||
            cf.customField.categories
              .map((c) => c.id)
              .includes(asset.categoryId!)
        )
      : asset.customFields;

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
          customFields,
        },
        lastScan,
        header,
        locale,
        timeZone,
        qrObj,
        reminders,
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
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

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

      await updateAssetBookingAvailability({
        id,
        organizationId,
        availableToBook,
      });

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
  const { asset, locale, timeZone, qrObj, lastScan } =
    useLoaderData<typeof loader>();
  const booking = asset?.bookings?.length ? asset?.bookings[0] : undefined;

  const customFieldsValues =
    asset && asset.customFields?.length > 0
      ? asset.customFields
          .filter((f) => f.value)
          .sort((a, b) => a.customField.name.localeCompare(b.customField.name))
      : [];

  const location = asset && asset.location;
  usePosition();
  const fetcher = useFetcher();
  const zo = useZorm(
    "NewQuestionWizardScreen",
    AvailabilityForBookingFormSchema
  );
  const { roles } = useUserRoleHelper();
  const canUpdateAvailability = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });

  return (
    <div>
      <ContextualModal />
      <div className="mx-[-16px] mt-[-16px] block md:mx-0 lg:flex">
        <div className="flex-1 overflow-hidden">
          <Card className="my-3 px-[-4] py-[-5] md:border">
            <ul className="item-information">
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  ID
                </span>
                <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                  {asset?.id}
                </div>
              </li>
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  Created
                </span>
                <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                  {asset && asset.createdAt}
                </div>
              </li>

              {asset?.category ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Category
                  </span>
                  <div className="mt-1 text-gray-600 md:mt-0 md:w-3/5">
                    <Badge color={asset.category?.color} withDot={false}>
                      {asset.category?.name}
                    </Badge>
                  </div>
                </li>
              ) : (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Category
                  </span>
                  <div className="mt-1 text-gray-600 md:mt-0 md:w-3/5">
                    <Badge color={"#808080"} withDot={false}>
                      Uncategorized
                    </Badge>
                  </div>
                </li>
              )}
              {location ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Location
                  </span>
                  <div className="-ml-2 mt-1 text-gray-600 md:mt-0 md:w-3/5">
                    <Tag key={location.id} className="ml-2">
                      {location.name}
                    </Tag>
                  </div>
                </li>
              ) : null}
              {asset?.description ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Description
                  </span>
                  <div className="mt-1 whitespace-pre-wrap text-gray-600 md:mt-0 md:w-3/5">
                    {asset.description}
                  </div>
                </li>
              ) : null}
              {asset && asset?.tags?.length > 0 ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Tags
                  </span>
                  <div className="-ml-2 mt-1 text-gray-600 md:mt-0 md:w-3/5">
                    {asset.tags.map((tag) => (
                      <Tag key={tag.id} className="ml-2">
                        {tag.name}
                      </Tag>
                    ))}
                  </div>
                </li>
              ) : null}
              {asset?.organization && asset.valuation ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Value
                  </span>
                  <div className="-ml-2 md:w-3/5">
                    <div className="ml-2 mt-1 text-gray-600 md:mt-0 md:w-3/5">
                      {asset.valuation.toLocaleString(locale, {
                        currency: asset.organization.currency,
                        style: "currency",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                    </div>
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
              <Card className="my-3 px-[-4] py-[-5] md:border">
                <ul className="item-information">
                  {customFieldsValues.map((field, _index) => {
                    const fieldValue =
                      field.value as unknown as ShelfAssetCustomFieldValueType["value"];

                    const customFieldDisplayValue = getCustomFieldDisplayValue(
                      fieldValue,
                      { locale, timeZone }
                    );

                    return (
                      <li
                        className={tw(
                          "w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex"
                        )}
                        key={field.id}
                      >
                        <span className="w-1/4 text-[14px] font-medium text-gray-900">
                          {field.customField.name}
                        </span>
                        <div
                          className={tw(
                            "mt-1 text-gray-600 md:mt-0 md:w-3/5",
                            field.customField.type !==
                              CustomFieldType.MULTILINE_TEXT && "max-w-[250px]"
                          )}
                        >
                          {field.customField.type ===
                          CustomFieldType.MULTILINE_TEXT ? (
                            <MarkdownViewer
                              content={
                                customFieldDisplayValue as RenderableTreeNode
                              }
                            />
                          ) : isLink(customFieldDisplayValue as string) ? (
                            <Button
                              role="link"
                              variant="link"
                              className="text-gray text-end font-normal underline hover:text-gray-600"
                              target="_blank"
                              to={`${customFieldDisplayValue}?ref=shelf-webapp`}
                            >
                              {customFieldDisplayValue as string}
                            </Button>
                          ) : (
                            (customFieldDisplayValue as string)
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
          <When truthy={canUpdateAvailability}>
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
                    disabled={
                      !canUpdateAvailability || isFormProcessing(fetcher.state)
                    } // Disable for self service users
                    defaultChecked={asset?.availableToBook}
                    required
                    title={
                      !canUpdateAvailability
                        ? "You do not have the permissions to change availability"
                        : "Toggle availability"
                    }
                  />
                  <input type="hidden" value="toggle" name="intent" />
                </div>
              </fetcher.Form>
            </Card>
          </When>

          <AssetReminderCards className="my-2" />

          {asset?.kit?.name ? (
            <Card className="my-3 py-3 md:border">
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
                    target="_blank"
                  >
                    <div className="max-w-[250px] truncate">
                      {asset.kit.name}
                    </div>
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          <CustodyCard
            booking={booking}
            custody={asset?.custody || null}
            hasPermission={userHasPermission({
              roles,
              entity: PermissionEntity.custody,
              action: PermissionAction.read,
            })}
          />

          {asset && (
            <QrPreview
              qrObj={qrObj}
              item={{
                name: asset.title,
                type: "asset",
              }}
            />
          )}
          <When
            truthy={userHasPermission({
              roles,
              entity: PermissionEntity.scan,
              action: PermissionAction.read,
            })}
          >
            <ScanDetails lastScan={lastScan} />
          </When>
        </div>
      </div>
      <ContextualSidebar />
    </div>
  );
}
