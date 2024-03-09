import { AssetStatus, type Asset } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import {
  Form,
  useFetcher,
  useLoaderData,
  useNavigation,
  useParams,
  useSearchParams,
} from "@remix-run/react";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { StatusFilter } from "~/components/booking/status-filter";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons";
import { Filters, List } from "~/components/list";
import { Button } from "~/components/shared";
import { Td } from "~/components/table";
import { db } from "~/database";
import { useClearValueFromParams, useSearchParamHasValue } from "~/hooks";
import {
  getAsset,
  getPaginatedAndFilterableAssets,
  updateAssetQrCode,
} from "~/modules/asset";
import { getRequiredParam, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { userPrefs } from "~/utils/cookies.server";
import { ShelfStackError } from "~/utils/error";

import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { organizationId } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.qr,
    action: PermissionAction.update,
  });

  const { qrId } = params;

  let {
    search,
    totalAssets,
    perPage,
    page,
    categories,
    tags,
    assets,
    totalPages,
    cookie,
    totalCategories,
    totalTags,
  } = await getPaginatedAndFilterableAssets({
    request,
    organizationId,
  });

  if (totalPages !== 0 && page > totalPages) {
    return redirect(".");
  }

  if (!assets) {
    throw new ShelfStackError({
      title: "Hey!",
      message: `No assets found`,
      status: 404,
    });
  }
  const modelName = {
    singular: "asset",
    plural: "assets",
  };

  return json(
    {
      header: {
        title: "Link QR with asset",
        subHeading: "Choose an item to link this QR with",
      },
      showModal: true,
      qrId,
      items: assets,
      categories,
      tags,
      search,
      page,
      totalItems: totalAssets,
      perPage,
      totalPages,
      modelName,
      searchFieldLabel: "Search assets",
      searchFieldTooltip: {
        title: "Search your asset database",
        text: "Search assets based on asset name or description, category, tag, location, custodian name. Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
      },
      totalCategories,
      totalTags,
    },
    {
      headers: [["Set-Cookie", await userPrefs.serialize(cookie)]],
    }
  );
};

export const action = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { organizationId } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.qr,
    action: PermissionAction.update,
  });
  const formData = await request.formData();
  const assetId = formData.get("assetId") as string;
  const qrId = getRequiredParam(params, "qrId");
  const asset = await db.asset.findUnique({
    where: {
      id: assetId,
      organizationId,
    },
    select: {
      id: true,
      qrCodes: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!asset) {
    throw new ShelfStackError({
      title: "Hey!",
      message: `No asset found with id ${assetId}`,
      status: 404,
    });
  }

  const updatedAsset = await updateAssetQrCode({
    newQrId: qrId,
    assetId,
    organizationId,
  });
  // console.log("updatedAsset", updatedAsset);

  return json({ success: true });
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function QrLinkExisting() {
  const { header } = useLoaderData<typeof loader>();
  const { qrId } = useParams();
  const hasFiltersToClear = useSearchParamHasValue("category", "tag");
  const clearFilters = useClearValueFromParams("category", "tag");
  const fetcher = useFetcher();

  function handleSelectAsset(assetId: string) {
    fetcher.submit(
      {
        assetId,
      },
      {
        method: "POST",
      }
    );
  }

  return (
    <>
      <div className="flex max-h-full flex-col">
        <header className="mb-3 text-left">
          <h2>{header.title}</h2>
          <p>{header.subHeading}</p>
        </header>

        <Filters
          slots={{
            "left-of-search": <StatusFilter statusItems={AssetStatus} />,
          }}
        >
          <div className="flex w-full items-center justify-around gap-6 md:w-auto md:justify-end">
            {hasFiltersToClear ? (
              <div className="hidden gap-6 md:flex">
                <Button
                  as="button"
                  onClick={clearFilters}
                  variant="link"
                  className="block max-w-none font-normal  text-gray-500 hover:text-gray-600"
                  type="button"
                >
                  Clear all filters
                </Button>
                <div className="text-gray-500"> | </div>
              </div>
            ) : null}

            <div className="flex w-full justify-around gap-2 p-3 md:w-auto md:justify-end md:p-0 lg:gap-4">
              <DynamicDropdown
                trigger={
                  <div className="flex cursor-pointer items-center gap-2">
                    Categories{" "}
                    <ChevronRight className="hidden rotate-90 md:inline" />
                  </div>
                }
                model={{ name: "category", key: "name" }}
                label="Filter by category"
                initialDataKey="categories"
                countKey="totalCategories"
              />
              <DynamicDropdown
                trigger={
                  <div className="flex cursor-pointer items-center gap-2">
                    Tags <ChevronRight className="hidden rotate-90 md:inline" />
                  </div>
                }
                model={{ name: "tag", key: "name" }}
                label="Filter by tags"
                initialDataKey="tags"
                countKey="totalTags"
              />
            </div>
          </div>
        </Filters>

        {/* Body of the modal*/}
        <div
        // className="mx-[-24px]"
        >
          <div className="flex-1 overflow-y-auto pb-4">
            <List
              ItemComponent={RowComponent}
              /** Clicking on the row will add the current asset to the atom of selected assets */
              navigate={handleSelectAsset}
              customEmptyStateContent={{
                title: "You haven't added any assets yet.",
                text: "What are you waiting for? Create your first asset now!",
                newButtonRoute: "/assets/new",
                newButtonContent: "New asset",
              }}
            />
          </div>
        </div>

        {/* Footer of the modal */}
        <footer className="flex justify-between border-t pt-3">
          <Button variant="secondary" to={`/qr/${qrId}/link`} width="full">
            Close
          </Button>
        </footer>
      </div>
    </>
  );
}

const RowComponent = ({ item }: { item: Asset }) => (
  <>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center">
            <AssetImage
              asset={{
                assetId: item.id,
                mainImage: item.mainImage,
                mainImageExpiration: item.mainImageExpiration,
                alt: item.title,
              }}
              className="size-full rounded-[4px] border object-cover"
            />
          </div>
          <div className="flex flex-col">
            <p className="word-break whitespace-break-spaces text-left font-medium">
              {item.title}
            </p>
            <div>
              <AssetStatusBadge
                status={item.status}
                availableToBook={item.availableToBook}
              />
            </div>
          </div>
        </div>
      </div>
    </Td>

    <Td>
      <ChevronRight />
    </Td>
  </>
);
