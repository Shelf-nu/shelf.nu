import { type Location } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  SerializeFrom,
  MetaFunction,
} from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import mapCss from "maplibre-gl/dist/maplibre-gl.css";
import ActionsDopdown from "~/components/assets/actions-dropdown";
import { AssetImage } from "~/components/assets/asset-image";
import { Notes } from "~/components/assets/notes";
import { ErrorBoundryComponent } from "~/components/errors";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { ScanDetails } from "~/components/location";

import { Badge } from "~/components/shared";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Tag } from "~/components/shared/tag";
import TextualDivider from "~/components/shared/textual-divider";
import { usePosition } from "~/hooks";
import { deleteAsset, getAsset } from "~/modules/asset";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { getScanByQrId } from "~/modules/scan";
import { parseScanData } from "~/modules/scan/utils.server";
import assetCss from "~/styles/asset.css";
import {
  assertIsDelete,
  getRequiredParam,
  tw,
  userFriendlyAssetStatus,
  isLink,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getDateTimeFormat, getLocale } from "~/utils/client-hints";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfStackError } from "~/utils/error";
import { parseMarkdownToReact } from "~/utils/md.server";
import { deleteAssetImage } from "~/utils/storage.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const { userId } = authSession;
  const locale = getLocale(request);
  const id = getRequiredParam(params, "assetId");

  const asset = await getAsset({ organizationId, id });
  if (!asset) {
    throw new ShelfStackError({ message: "Asset Not Found", status: 404 });
  }
  /** We get the first QR code(for now we can only have 1)
   * And using the ID of tha qr code, we find the latest scan
   */
  const lastScan = asset.qrCodes[0]?.id
    ? parseScanData({
        scan: (await getScanByQrId({ qrId: asset.qrCodes[0].id })) || null,
        userId,
        request,
      })
    : null;

  const notes = asset.notes.map((note) => ({
    ...note,
    dateDisplay: getDateTimeFormat(request).format(note.createdAt),
    content: parseMarkdownToReact(note.content),
  }));

  let custody = null;
  if (asset.custody) {
    const date = new Date(asset.custody.createdAt);
    const dateDisplay = getDateTimeFormat(request).format(date);

    custody = {
      ...asset.custody,
      dateDisplay,
    };
  }

  const header: HeaderData = {
    title: asset.title,
  };

  return json({
    asset: {
      ...asset,
      custody,
      notes,
    },
    lastScan,
    header,
    locale,
  });
}
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsDelete(request);
  const id = getRequiredParam(params, "assetId");
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const formData = await request.formData();
  const mainImageUrl = formData.get("mainImage") as string;

  await deleteAsset({ organizationId, id });
  await deleteAssetImage({
    url: mainImageUrl,
    bucketName: "assets",
  });

  sendNotification({
    title: "Asset deleted",
    message: "Your asset has been deleted successfully",
    icon: { name: "trash", variant: "error" },
    senderId: authSession.userId,
  });

  return redirect(`/assets`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
];

export const handle = {
  breadcrumb: () => "single",
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: assetCss },
  { rel: "stylesheet", href: mapCss },
];

export default function AssetDetailsPage() {
  const { asset, locale } = useLoaderData<typeof loader>();
  const customFieldsValues =
    asset?.customFields?.length > 0
      ? asset.customFields.filter((f) => f?.value)
      : [];
  const assetIsAvailable = asset.status === "AVAILABLE";
  /** Due to some conflict of types between prisma and remix, we need to use the SerializeFrom type
   * Source: https://github.com/prisma/prisma/discussions/14371
   */
  const location = asset?.location as SerializeFrom<Location>;
  usePosition();

  return (
    <>
      <AssetImage
        asset={{
          assetId: asset.id,
          mainImage: asset.mainImage,
          mainImageExpiration: asset.mainImageExpiration,
          alt: asset.title,
        }}
        className="mx-auto mb-8 h-[240px] w-full rounded-lg object-cover sm:w-[343px] md:hidden"
      />
      <Header
        subHeading={
          <div className="mt-3 flex gap-2">
            <Badge color={assetIsAvailable ? "#12B76A" : "#2E90FA"}>
              {userFriendlyAssetStatus(asset.status)}
            </Badge>
            {location ? (
              <span className="inline-flex justify-center rounded-2xl bg-gray-100 px-[8px] py-[2px] text-center text-[12px] font-medium text-gray-700">
                {location.name}
              </span>
            ) : null}
          </div>
        }
      >
        <Button
          to="qr"
          variant="secondary"
          icon="barcode"
          onlyIconOnMobile={true}
        >
          View QR code
        </Button>
        <ActionsDopdown asset={asset} />
      </Header>

      <ContextualModal />
      <div className="mt-8 block lg:flex">
        <div className="shrink-0 overflow-hidden lg:w-[343px] xl:w-[400px]">
          <AssetImage
            asset={{
              assetId: asset.id,
              mainImage: asset.mainImage,
              mainImageExpiration: asset.mainImageExpiration,
              alt: asset.title,
            }}
            className={tw(
              "mb-8 hidden h-auto w-[343px] rounded-lg border object-cover md:block lg:w-full",
              asset.description ? "rounded-b-none border-b-0" : ""
            )}
          />
          {asset.description ? (
            <Card className="mt-0 rounded-t-none">
              <p className=" text-gray-600">{asset.description}</p>
            </Card>
          ) : null}

          {/* We simply check if the asset is available and we can assume that if it't not, there is a custodian assigned */}
          {!assetIsAvailable && asset?.custody?.createdAt ? (
            <Card>
              <div className="flex items-center gap-3">
                <img
                  src="/images/default_pfp.jpg"
                  alt="custodian"
                  className="h-10 w-10 rounded"
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

          <TextualDivider text="Details" className="mb-8 lg:hidden" />
          <Card>
            <ul className="item-information">
              <li className="mb-4 flex justify-between">
                <span className="text-[12px] font-medium text-gray-600">
                  ID
                </span>
                <div className="max-w-[250px]">{asset.id}</div>
              </li>
              {asset?.category ? (
                <li className="mb-4 flex justify-between">
                  <span className="text-[12px] font-medium text-gray-600">
                    Category
                  </span>
                  <div className="max-w-[250px]">
                    <Badge color={asset.category?.color} withDot={false}>
                      {asset.category?.name}
                    </Badge>
                  </div>
                </li>
              ) : (
                <li className="mb-4 flex justify-between">
                  <span className="text-[12px] font-medium text-gray-600">
                    Category
                  </span>
                  <div className="max-w-[250px]">
                    <Badge color={"#808080"} withDot={false}>
                      Uncategorized
                    </Badge>
                  </div>
                </li>
              )}
              {location ? (
                <li className="mb-2 flex justify-between">
                  <span className="text-[12px] font-medium text-gray-600">
                    Location
                  </span>
                  <div className="max-w-[250px]">
                    <Tag key={location.id} className="mb-2 ml-2">
                      {location.name}
                    </Tag>
                  </div>
                </li>
              ) : null}
              {asset?.tags?.length > 0 ? (
                <li className="mb-2 flex justify-between">
                  <span className="text-[12px] font-medium text-gray-600">
                    Tags
                  </span>
                  <div className="text-right ">
                    {asset.tags.map((tag) => (
                      <Tag key={tag.id} className="mb-2 ml-2">
                        {tag.name}
                      </Tag>
                    ))}
                  </div>
                </li>
              ) : null}
              {asset.organization && asset.valuation ? (
                <li className="flex justify-between">
                  <span className="text-[12px] font-medium text-gray-600">
                    Value
                  </span>
                  <div className="max-w-[250px]">
                    <Tag key={asset.valuation} className="mb-2 ml-2">
                      <>
                        {asset.organization.currency}{" "}
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
              <Card>
                <ul className="item-information">
                  {customFieldsValues.map((field, index) => {
                    const customFieldDisplayValue = getCustomFieldDisplayValue(
                      field.value as unknown as ShelfAssetCustomFieldValueType["value"]
                    );
                    return (
                      <li
                        className={tw(
                          "flex justify-between",
                          index === customFieldsValues.length - 1 ? "" : "mb-4 "
                        )}
                        key={field.id}
                      >
                        <span className="text-[12px] font-medium text-gray-600">
                          {field.customField.name}
                        </span>
                        <div className="max-w-[250px] text-end">
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

          <ScanDetails />
        </div>

        <div className="w-full lg:ml-6">
          <TextualDivider text="Notes" className="mb-8 lg:hidden" />
          <Notes />
        </div>
      </div>
      <ContextualSidebar />
    </>
  );
}

export const ErrorBoundary = () => (
  <ErrorBoundryComponent title="Sorry, asset you are looking for doesn't exist" />
);
