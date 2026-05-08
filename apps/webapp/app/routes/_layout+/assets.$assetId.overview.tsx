import { useState } from "react";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import { AssetStatus, CustomFieldType } from "@prisma/client";
import type {
  MetaFunction,
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { CustodyCard } from "~/components/assets/asset-custody-card";
import { AssetReminderCards } from "~/components/assets/asset-reminder-cards";
import { BarcodeCard } from "~/components/barcode/barcode-card";
import { UnlockBarcodesBanner } from "~/components/barcode/unlock-barcodes-banner";
import { CodePreview } from "~/components/code-preview/code-preview";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import Icon from "~/components/icons/icon";
import ContextualModal from "~/components/layout/contextual-modal";
import type { HeaderData } from "~/components/layout/header/types";
import { LocationBadge } from "~/components/location/location-badge";
import { LocationSelect } from "~/components/location/location-select";
import { ScanDetails } from "~/components/location/scan-details";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { DateS } from "~/components/shared/date";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { InlineEditableField } from "~/components/shared/inline-editable-field";
import { Tag } from "~/components/shared/tag";
import TextualDivider from "~/components/shared/textual-divider";
import When from "~/components/when/when";
import { usePosition } from "~/hooks/use-position";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getAssetOverviewFields } from "~/modules/asset/fields";
import {
  getActiveCustomFieldsForAsset,
  getAsset,
  getCategoriesForCreateAndEdit,
  getLocationsForCreateAndEdit,
  parseAssetValuation,
  updateAsset,
  updateAssetBookingAvailability,
} from "~/modules/asset/service.server";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import { getRemindersForOverviewPage } from "~/modules/asset-reminder/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { generateQrObj } from "~/modules/qr/utils.server";
import { getScanByQrId } from "~/modules/scan/service.server";
import { parseScanData } from "~/modules/scan/utils.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";
import { buildCustomFieldLinkHref } from "~/utils/custom-field-link";
import {
  buildCustomFieldValue,
  getCustomFieldDisplayValue,
} from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { error, getParams, payload, parseData } from "~/utils/http.server";
import { isLink } from "~/utils/misc";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

type AssetWithOptionalBarcodes = ReturnType<
  typeof useLoaderData<typeof loader>
>["asset"] & {
  barcodes?: Array<{
    id: string;
    type: any;
    value: string;
  }>;
  _count?: {
    barcodes: number;
  };
};

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
    const {
      organizationId,
      userOrganizations,
      currentOrganization,
      canUseBarcodes,
    } = await requirePermission({
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
      include: getAssetOverviewFields(id, canUseBarcodes),
    });

    /**
     * We get the first QR code(for now we can only have 1)
     * And using the ID of tha qr code, we find the latest scan
     */
    const lastScan = asset.qrCodes[0]?.id
      ? parseScanData({
          scan: (await getScanByQrId({ qrId: asset.qrCodes[0].id })) || null,
          userId,
        })
      : null;

    const qrObj = await generateQrObj({
      assetId: asset.id,
      userId,
      organizationId,
    });

    /**
     * Derive edit permission once in the loader so we can conditionally
     * skip the heavy categories/locations/custom-field-defs queries for
     * users who are view-only. Uses the server-side `hasPermission` because
     * the client-side `userHasPermission` validator file has the `.client.`
     * suffix and is stripped from the SSR bundle. Passing `roles` explicitly
     * avoids the validator's DB fallback lookup.
     */
    const roles = userOrganizations.find(
      (o) => o.organization.id === organizationId
    )?.roles;

    const canEditAsset = await hasPermission({
      userId,
      organizationId,
      roles,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const reminders = await getRemindersForOverviewPage({
      assetId: id,
      organizationId,
    });
    const booking = asset.bookings.length > 0 ? asset.bookings[0] : undefined;
    const currentBooking: any = null;

    if (booking && booking.from) {
      asset.bookings = [currentBooking];
    }
    /** We only need customField with same category of asset or without any category */
    const customFields = asset.categoryId
      ? asset.customFields.filter(
          (cf) =>
            !cf.customField.categories.length ||
            cf.customField.categories
              .map((c) => c.id)
              .includes(asset.categoryId!)
        )
      : asset.customFields;

    /**
     * Editor data is only needed for users who can update the asset. View-only
     * users see static display rows and never enter edit mode, so we skip the
     * categories/locations/custom-fields-definitions queries entirely. We also
     * skip tags — they are read-only on the overview page in this iteration.
     */
    const [allCustomFieldDefs, categoriesData, locationsData] = canEditAsset
      ? await Promise.all([
          getActiveCustomFields({
            organizationId,
            category: asset.categoryId,
          }),
          getCategoriesForCreateAndEdit({
            request,
            organizationId,
            defaultCategory: asset.categoryId,
          }),
          getLocationsForCreateAndEdit({
            request,
            organizationId,
            defaultLocation: asset.locationId,
          }),
        ])
      : [
          [],
          { categories: [], totalCategories: 0 },
          { locations: [], totalLocations: 0 },
        ];

    const { categories, totalCategories } = categoriesData;
    const { locations, totalLocations } = locationsData;
    const header: HeaderData = {
      title: `${asset.title}'s overview`,
    };

    return payload({
      asset: {
        ...asset,
        customFields,
      },
      currentOrganization,
      userId,
      lastScan,
      header,
      locale,
      timeZone,
      qrObj,
      reminders,
      categories,
      totalCategories,
      locations,
      totalLocations,
      allCustomFieldDefs,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
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
      z.object({ intent: z.enum(["toggle", "updateField"]) })
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
      return payload(null);
    } else if (intent === "updateField") {
      const { fieldName } = parseData(
        formData,
        z.object({
          fieldName: z.enum([
            "description",
            "category",
            "location",
            "valuation",
            "customField",
          ]),
        })
      );

      const fieldValue = formData.get("fieldValue") as string | null;

      switch (fieldName) {
        case "description": {
          /** Trim whitespace; treat empty as empty string (Prisma allows it) */
          const description = (fieldValue ?? "").trim();
          await updateAsset({
            id,
            description,
            userId,
            organizationId,
            request,
          });
          break;
        }
        case "category": {
          await updateAsset({
            id,
            categoryId: fieldValue || "uncategorized",
            userId,
            organizationId,
            request,
          });
          break;
        }
        case "location": {
          const newLocationId =
            (formData.get("newLocationId") as string) || undefined;
          const currentLocationId =
            (formData.get("currentLocationId") as string) || undefined;
          await updateAsset({
            id,
            newLocationId,
            currentLocationId,
            userId,
            organizationId,
            request,
          });
          break;
        }
        case "valuation": {
          const rawVal = formData.get("fieldValue") as string | null;
          const valuation = parseAssetValuation(rawVal);
          await updateAsset({
            id,
            valuation,
            userId,
            organizationId,
            request,
          });
          break;
        }
        case "customField": {
          const customFieldId = formData.get("customFieldId") as string;

          /**
           * Org+category scoped lookup. Throws 404 if the asset does not belong
           * to this organization, blocking cross-org writes. The asset's category
           * is what gates which custom-field defs are returned, preventing crafted
           * POSTs from writing values for fields outside this asset's category.
           */
          const customFields = await getActiveCustomFieldsForAsset({
            id,
            organizationId,
          });
          const fieldDef = customFields.find((cf) => cf.id === customFieldId);
          if (!fieldDef) {
            throw new ShelfError({
              cause: null,
              message: "Custom field not found",
              label: "Assets",
              status: 400,
            });
          }

          const builtValue = buildCustomFieldValue(
            { raw: fieldValue ?? "" },
            fieldDef
          );

          /**
           * Block clearing required custom fields. The full edit form
           * enforces this via mergedSchema; inline editing must match.
           */
          if (!builtValue && fieldDef.required) {
            throw new ShelfError({
              cause: null,
              message: `${fieldDef.name} is required and cannot be empty`,
              label: "Assets",
              shouldBeCaptured: false,
              status: 400,
            });
          }

          const customFieldsValues = builtValue
            ? [{ id: customFieldId, value: builtValue }]
            : [{ id: customFieldId, value: undefined }];

          await updateAsset({
            id,
            customFieldsValues:
              customFieldsValues as ShelfAssetCustomFieldValueType[],
            userId,
            organizationId,
            request,
          });
          break;
        }
        default:
          checkExhaustiveSwitch(fieldName);
      }

      sendNotification({
        title: "Asset updated",
        message: "Your asset has been updated successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
      return payload({ success: true });
    } else {
      checkExhaustiveSwitch(intent);
      return payload(null);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return data(error(reason), { status: reason.status });
  }
}

// react-doctor:no-giant-component — deferred for follow-up refactor
export default function AssetOverview() {
  const {
    asset,
    locale,
    timeZone,
    qrObj,
    lastScan,
    currentOrganization,
    userId,
    allCustomFieldDefs,
  } = useLoaderData<typeof loader>();
  const booking =
    asset.status === AssetStatus.CHECKED_OUT && asset?.bookings?.length
      ? asset?.bookings[0]
      : undefined;

  /**
   * Build ONE unified list of ALL custom fields, sorted alphabetically.
   * Each entry pairs the field definition with its stored value (or null
   * if not set). This keeps fields in a stable position regardless of
   * whether they have values — no jumping when a user adds or clears data.
   */
  const customFieldsValueMap = new Map(
    (asset?.customFields ?? [])
      .filter((f) => f.value)
      .map((f) => [f.customField.id, f])
  );
  const allCustomFields = (allCustomFieldDefs ?? [])
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((def) => ({
      def,
      storedValue: customFieldsValueMap.get(def.id) ?? null,
    }));

  const location = asset && asset.location;
  usePosition();
  const fetcher = useFetcher();
  const zo = useZorm(
    "NewQuestionWizardScreen",
    AvailabilityForBookingFormSchema
  );
  const { roles } = useUserRoleHelper();
  const { canUseBarcodes } = useBarcodePermissions();
  const canUpdateAvailability = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });
  const canEditAsset = canUpdateAvailability;

  return (
    <div>
      <ContextualModal />
      <div className="mx-[-16px] mt-[-16px] block md:mx-0 lg:flex ">
        <div className="max-w-full flex-1 overflow-hidden">
          <Card className="my-3 max-w-full px-[-4] py-[-5] md:border">
            <ul className="item-information">
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  ID
                </span>
                <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                  {asset?.id}
                </div>
              </li>
              {asset?.sequentialId ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Asset ID
                  </span>
                  <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                    {asset.sequentialId}
                  </div>
                </li>
              ) : null}
              {asset?.qrCodes?.[0] ? (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-1/4 text-[14px] font-medium text-gray-900">
                    Shelf QR ID
                  </span>
                  <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                    {asset.qrCodes[0].id}
                  </div>
                </li>
              ) : null}
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  Created
                </span>
                <div className="mt-1 w-3/5 text-gray-600 md:mt-0">
                  <DateS date={asset.createdAt} includeTime />
                </div>
              </li>

              <InlineEditableField
                fieldName="category"
                label="Category"
                canEdit={canEditAsset}
                renderDisplay={() => (
                  <Badge
                    color={asset.category?.color ?? "#808080"}
                    withDot={false}
                  >
                    {asset.category?.name ?? "Uncategorized"}
                  </Badge>
                )}
                renderEditor={() => (
                  <DynamicSelect
                    fieldName="fieldValue"
                    defaultValue={asset.category?.id ?? undefined}
                    model={{ name: "category", queryKey: "name" }}
                    contentLabel="Categories"
                    placeholder="Select category"
                    initialDataKey="categories"
                    countKey="totalCategories"
                    closeOnSelect
                    allowClear
                    hideLabel
                  />
                )}
              />

              <InlineEditableField
                fieldName="location"
                label="Location"
                canEdit={canEditAsset}
                isEmpty={!location}
                renderDisplay={() =>
                  location ? (
                    <div className="-ml-2">
                      <LocationBadge
                        location={{
                          id: location.id,
                          name: location.name,
                          parentId: location.parentId,
                          childCount: location._count?.children ?? 0,
                        }}
                      />
                    </div>
                  ) : (
                    <span className="text-gray-600">No location</span>
                  )
                }
                renderEditor={() => (
                  <LocationSelect
                    isBulk={false}
                    locationId={asset.location?.id ?? undefined}
                    fieldName="newLocationId"
                    defaultValue={asset.location?.id ?? undefined}
                    hideClearButton={false}
                    hideCurrentLocationInput={false}
                  />
                )}
              />

              <InlineEditableField
                fieldName="description"
                label="Description"
                canEdit={canEditAsset}
                isEmpty={!asset.description}
                renderDisplay={() => (
                  <div className="whitespace-pre-wrap text-gray-600">
                    {asset.description || "No description"}
                  </div>
                )}
                renderEditor={() => (
                  <div>
                    <Input
                      label="Description"
                      hideLabel
                      inputType="textarea"
                      name="fieldValue"
                      defaultValue={asset.description ?? ""}
                      className="w-full"
                      maxLength={1000}
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      Maximum 1000 characters
                    </p>
                  </div>
                )}
              />

              {/* Tags — read-only display. Inline editing deferred to a
                  follow-up PR (TagsAutocomplete needs a multi-select
                  DynamicSelect variant for compact inline contexts). */}
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-1/4 text-[14px] font-medium text-gray-900">
                  Tags
                </span>
                <div className="mt-1 text-gray-600 md:mt-0 md:w-3/5">
                  {asset.tags?.length > 0 ? (
                    <div className="-ml-2">
                      {asset.tags.map((tag) => (
                        <Tag
                          key={tag.id}
                          className="ml-2"
                          color={tag.color ?? undefined}
                          withDot={false}
                        >
                          {tag.name}
                        </Tag>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-600">No tags</span>
                  )}
                </div>
              </li>

              <InlineEditableField
                fieldName="valuation"
                label="Value"
                canEdit={canEditAsset}
                isEmpty={asset.valuation == null}
                renderDisplay={() => (
                  <div className="text-gray-600">
                    {asset.valuation != null
                      ? formatCurrency({
                          value: asset.valuation,
                          locale,
                          currency: asset.organization.currency,
                        })
                      : "No value"}
                  </div>
                )}
                renderEditor={() => (
                  /*
                   * Use type="text" with inputMode="decimal" — NOT
                   * type="number" (which silently strips non-numeric chars
                   * before submit, making server-side validation unreachable)
                   * and NOT with a `pattern` attribute (which the browser
                   * enforces with a native validation tooltip that ALSO
                   * blocks form submission).
                   *
                   * The server-side `Number.isFinite()` check in the action
                   * handler is the source of truth for valuation validation;
                   * any browser-side gate would prevent the user from seeing
                   * those server errors.
                   *
                   * inputMode="decimal" still hints mobile keyboards to show
                   * the numeric keypad.
                   */
                  <Input
                    label="Value"
                    hideLabel
                    type="text"
                    inputMode="decimal"
                    name="fieldValue"
                    defaultValue={asset.valuation ?? undefined}
                    className="w-full"
                  />
                )}
              />

              {(() => {
                const assetWithBarcodes = asset as AssetWithOptionalBarcodes;
                const barcodeCount =
                  assetWithBarcodes.barcodes?.length ||
                  assetWithBarcodes._count?.barcodes ||
                  0;

                if (!barcodeCount) return null;

                // Barcodes exist and addon is enabled — show them
                if (canUseBarcodes && assetWithBarcodes.barcodes?.length) {
                  return (
                    <li className="w-full max-w-full p-4 last:border-b-0 md:block">
                      <span className="mb-3 flex items-center gap-1 text-[14px] font-medium text-gray-900">
                        Barcodes ({assetWithBarcodes.barcodes.length})
                        <InfoTooltip
                          iconClassName="size-4"
                          content={
                            <>
                              <h6>Barcodes support</h6>
                              <p>
                                Want to know more about barcodes? Check out our
                                knowledge base article on{" "}
                                <Button
                                  variant="link"
                                  target="_blank"
                                  to="https://www.shelf.nu/knowledge-base/alternative-barcodes"
                                >
                                  barcode support
                                </Button>
                              </p>
                            </>
                          }
                        />
                      </span>
                      <div className="flex flex-wrap gap-3">
                        {assetWithBarcodes.barcodes.map((barcode) => (
                          <BarcodeCard key={barcode.id} barcode={barcode} />
                        ))}
                      </div>
                    </li>
                  );
                }

                // Barcodes exist but addon is disabled — show locked state
                return (
                  <li className="w-full max-w-full p-4 last:border-b-0 md:block">
                    <span className="mb-3 flex items-center gap-1 text-[14px] font-medium text-gray-900">
                      Barcodes ({barcodeCount})
                    </span>
                    <div className="flex flex-wrap gap-3">
                      {Array.from({ length: barcodeCount }).map((_, i) => (
                        <div
                          key={i}
                          className="flex h-[72px] w-[180px] items-center justify-center rounded border border-gray-200 bg-gray-50"
                        >
                          <div className="flex flex-col items-center gap-1 text-gray-400">
                            <Icon icon="lock" />
                            <span className="text-xs">Hidden</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <UnlockBarcodesBanner />
                    </div>
                  </li>
                );
              })()}
            </ul>
          </Card>

          {/* Custom fields — one unified alphabetically-sorted list */}
          {allCustomFields.some((cf) => cf.storedValue) ||
          (canEditAsset && allCustomFields.length > 0) ? (
            <>
              <TextualDivider
                text="Custom fields"
                className="mb-8 pt-3 lg:hidden"
              />
              <Card className="my-3 px-[-4] py-[-5] md:border">
                <ul className="item-information">
                  {allCustomFields.map(({ def, storedValue }) => {
                    const hasValue = !!storedValue;
                    const fieldValue = hasValue
                      ? (storedValue.value as unknown as ShelfAssetCustomFieldValueType["value"])
                      : null;
                    const rawValue =
                      fieldValue?.raw !== undefined
                        ? String(fieldValue.raw)
                        : "";
                    const customFieldDisplayValue = hasValue
                      ? getCustomFieldDisplayValue(fieldValue!, {
                          locale,
                          timeZone,
                        })
                      : null;

                    /* Hide "Not set" rows from view-only users */
                    if (!hasValue && !canEditAsset) return null;

                    return (
                      <InlineEditableField
                        key={def.id}
                        fieldName={`customField-${def.id}`}
                        formFieldName="customField"
                        label={def.name}
                        canEdit={canEditAsset}
                        extraHiddenInputs={{
                          customFieldId: def.id,
                        }}
                        renderDisplay={() =>
                          hasValue ? (
                            <div
                              className={tw(
                                "text-gray-600",
                                def.type !== CustomFieldType.MULTILINE_TEXT &&
                                  "max-w-[350px]"
                              )}
                            >
                              {def.type === CustomFieldType.MULTILINE_TEXT ? (
                                <MarkdownViewer
                                  content={
                                    customFieldDisplayValue as RenderableTreeNode
                                  }
                                />
                              ) : isLink(customFieldDisplayValue as string) ? (
                                <Button
                                  variant="link-gray"
                                  target="_blank"
                                  to={buildCustomFieldLinkHref(
                                    customFieldDisplayValue as string
                                  )}
                                >
                                  {customFieldDisplayValue as string}
                                </Button>
                              ) : def.type === CustomFieldType.AMOUNT ? (
                                formatCurrency({
                                  value: fieldValue!.raw as number,
                                  locale,
                                  currency: asset.organization.currency,
                                })
                              ) : (
                                (customFieldDisplayValue as string)
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">Not set</span>
                          )
                        }
                        renderEditor={() => {
                          switch (def.type) {
                            case CustomFieldType.MULTILINE_TEXT:
                              return (
                                <Input
                                  label={def.name}
                                  hideLabel
                                  inputType="textarea"
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full"
                                />
                              );
                            case CustomFieldType.BOOLEAN:
                              return (
                                <BooleanCustomFieldEditor
                                  name="fieldValue"
                                  label={def.name}
                                  defaultChecked={
                                    fieldValue?.raw === "yes" ||
                                    fieldValue?.raw === true
                                  }
                                  defaultIsUnset={!hasValue}
                                />
                              );
                            case CustomFieldType.DATE:
                              return (
                                <Input
                                  label={def.name}
                                  hideLabel
                                  type="date"
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full"
                                />
                              );
                            case CustomFieldType.OPTION:
                              return (
                                <select
                                  aria-label={def.name}
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                                >
                                  <option value="">Select an option</option>
                                  {(def.options as string[] | null)
                                    ?.filter(
                                      (o: string) => o !== null && o !== ""
                                    )
                                    .map((option: string) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                </select>
                              );
                            case CustomFieldType.AMOUNT:
                            case CustomFieldType.NUMBER:
                              return (
                                <Input
                                  label={def.name}
                                  hideLabel
                                  type="text"
                                  inputMode="decimal"
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full"
                                />
                              );
                            default:
                              return (
                                <Input
                                  label={def.name}
                                  hideLabel
                                  name="fieldValue"
                                  defaultValue={rawValue}
                                  className="w-full"
                                />
                              );
                          }
                        }}
                      />
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
            hasPermission={userCanViewSpecificCustody({
              roles,
              custodianUserId: asset?.custody?.custodian?.user?.id,
              organization: currentOrganization,
              currentUserId: userId,
            })}
          />

          {asset && (
            <CodePreview
              qrObj={qrObj}
              barcodes={
                canUseBarcodes
                  ? (asset as AssetWithOptionalBarcodes).barcodes || []
                  : []
              }
              item={{
                id: asset.id,
                name: asset.title,
                type: "asset",
              }}
              sequentialId={asset.sequentialId}
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
    </div>
  );
}

/**
 * Small helper for BOOLEAN custom fields.
 * Supports tri-state: yes / no / unset (empty string).
 * When `isUnset` is true the hidden input sends "" which
 * `buildCustomFieldValue` treats as undefined (no value stored).
 * This prevents "Not set" booleans from being forced to "no" on save.
 */
function BooleanCustomFieldEditor({
  name,
  label,
  defaultChecked,
  defaultIsUnset = false,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
  defaultIsUnset?: boolean;
}) {
  const [isUnset, setIsUnset] = useState(defaultIsUnset);
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <div className="flex items-center gap-2">
      <input
        type="hidden"
        name={name}
        value={isUnset ? "" : checked ? "yes" : "no"}
      />
      <Switch
        aria-label={label}
        checked={!isUnset && checked}
        onCheckedChange={(val) => {
          setIsUnset(false);
          setChecked(val);
        }}
      />
      <span className="text-sm text-gray-600">
        {isUnset ? `${label} (not set)` : label}
      </span>
      {/*
       * Clear is only offered when the field was originally unset
       * (defaultIsUnset === true) and the user has just toggled the Switch on,
       * so they can revert without committing a yes/no value. Once cleared, the
       * only way back is to flip the Switch — which automatically un-sets
       * isUnset via the onCheckedChange handler above.
       */}
      {!isUnset && defaultIsUnset && (
        <button
          type="button"
          onClick={() => setIsUnset(true)}
          className="text-xs text-gray-400 underline hover:text-gray-600"
        >
          Clear
        </button>
      )}
    </div>
  );
}
