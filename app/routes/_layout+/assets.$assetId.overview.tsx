import type { Asset, Custody, Kit, Note, Organization } from "@prisma/client";
import type { MetaFunction, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useRouteLoaderData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import AssetQR from "~/components/assets/asset-qr";
import { Switch } from "~/components/forms/switch";
import Icon from "~/components/icons/icon";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import { ScanDetails } from "~/components/location/scan-details";

import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Tag } from "~/components/shared/tag";
import TextualDivider from "~/components/shared/textual-divider";
import { usePosition } from "~/hooks/use-position";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import { updateAssetBookingAvailability } from "~/modules/asset/service.server";
import type {
  AssetCustomFieldsValuesWithFields,
  ShelfAssetCustomFieldValueType,
} from "~/modules/asset/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { error, getParams, data, parseData } from "~/utils/http.server";
import { isLink } from "~/utils/misc";
import { tw } from "~/utils/tw";
export const AvailabilityForBookingFormSchema = z.object({
  availableToBook: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export function loader() {
  const title = "Asset Overview";

  return json(data({ title }));
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  breadcrumb: () => "Overview",
};
type SizeKeys = "cable" | "small" | "medium" | "large";

export interface AssetType {
  asset: {
    id: string;
    createdAt: Date;
    notes: Note[];
    kitId: Asset["kitId"];
    category: {
      id: string;
      name: string;
      description: string;
      color: string;
      createdAt: string;
      updatedAt: string;
      userId: string;
    };
    title: string;
    status: string;
    location: {
      id: string;
      name: string;
    };
    customFields: AssetCustomFieldsValuesWithFields[];
    tags: {
      id: string;
      name: string;
    }[];
    description: string;
    organization: {
      name: Organization["name"];
      currency?: Organization["currency"];
    };
    custody: {
      custodian: {
        name: string;
      };
      dateDisplay: Date;
      createdAt: Custody["createdAt"];
    };
    valuation: Asset["valuation"];
    availableToBook?: boolean;
    kit: {
      name: Kit["name"];
      image: Kit["image"];
    };
  };
  locale: string;
  qrObj: {
    qr: {
      size: SizeKeys;
      id: string;
      src: string;
    };
  };
  lastScan: any;
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
  const data = useRouteLoaderData<AssetType>("routes/_layout+/assets.$assetId");
  const { asset, locale, qrObj, lastScan } = data ?? {};

  const customFieldsValues =
    asset && asset.customFields?.length > 0
      ? asset.customFields.filter((f) => f.value)
      : [];
  const assetIsAvailable = asset && asset.status === "AVAILABLE";
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
                      field.value as unknown as ShelfAssetCustomFieldValueType["value"]
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

          {/* We simply check if the asset is available and we can assume that if it't not, there is a custodian assigned */}
          {!isSelfService && !assetIsAvailable && asset?.custody?.createdAt ? (
            <Card className="my-3">
              <div className="flex items-center gap-3">
                <img
                  src="/static/images/default_pfp.jpg"
                  alt="custodian"
                  className="size-10 rounded"
                />
                <div>
                  <p className="">
                    In custody of{" "}
                    <span className="font-semibold">
                      {asset.custody?.custodian.name}
                    </span>
                  </p>
                  <span>Since {asset.custody.dateDisplay}</span>
                </div>
              </div>
            </Card>
          ) : null}
          {asset && <AssetQR qrObj={qrObj} asset={asset} />}
          {!isSelfService ? <ScanDetails lastScan={lastScan} /> : null}
        </div>
      </div>
      <ContextualSidebar />
    </div>
  );
}
