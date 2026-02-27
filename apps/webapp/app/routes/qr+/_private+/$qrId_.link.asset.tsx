import { useState } from "react";
import type { Asset } from "@prisma/client";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  LinksFunction,
} from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useParams,
} from "react-router";
import { useHydrated } from "remix-utils/use-hydrated";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image/component";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ErrorContent } from "~/components/errors";
import { ChevronRight, LinkIcon } from "~/components/icons/library";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import { Td } from "~/components/table";
import When from "~/components/when/when";
import {
  useClearValueFromParams,
  useSearchParamHasValue,
} from "~/hooks/search-params";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import {
  getPaginatedAndFilterableAssets,
  updateAssetQrCode,
} from "~/modules/asset/service.server";
import { getQr } from "~/modules/qr/service.server";
import css from "~/styles/link-existing-asset.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie, userPrefs } from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  payload,
  error,
  getActionMethod,
  getParams,
  parseData,
} from "~/utils/http.server";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    const qr = await getQr({ id: qrId });
    if (qr?.assetId || qr?.kitId) {
      throw new ShelfError({
        message: "This QR code is already linked to an asset or a kit.",
        title: "QR already linked",
        label: "QR",
        status: 403,
        cause: null,
        shouldBeCaptured: false,
      });
    }

    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.update,
    });

    const {
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
      locations,
      totalLocations,
    } = await getPaginatedAndFilterableAssets({
      request,
      organizationId,
    });

    if (totalPages !== 0 && page > totalPages) {
      return redirect(".");
    }

    if (!assets) {
      throw new ShelfError({
        title: "Assets not found",
        message:
          "The assets you are trying to access do not exist or you do not have permission to access them.",
        additionalData: { qrId, organizationId, userId },
        cause: null,
        label: "Assets",
      });
    }
    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return data(
      payload({
        header: {
          title: "Link with existing asset",
          subHeading: "Choose an asset to link with this QR tag.",
        },
        qrId,
        items: assets,
        categories,
        tags,
        locations,
        totalLocations,
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
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, qrId });
    throw data(error(reason), { status: reason.status });
  }
};

export const action = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    const method = getActionMethod(request);
    if (method !== "POST") throw notAllowedMethod(method);

    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.update,
    });
    const { assetId } = parseData(
      await request.formData(),
      z.object({ assetId: z.string() })
    );

    await updateAssetQrCode({
      newQrId: qrId,
      assetId,
      organizationId,
    });

    return redirect(`/qr/${qrId}/successful-link?type=asset`);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export const links: LinksFunction = () => [{ rel: "stylesheet", href: css }];

export default function QrLinkExisting() {
  const { header } = useLoaderData<typeof loader>();
  const { qrId } = useParams();
  const hasFiltersToClear = useSearchParamHasValue("category", "tag");
  const clearFilters = useClearValueFromParams("category", "tag");
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);

  /** The id of the asset the user selected to update */
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");

  function handleSelectAsset(assetId: string) {
    setConfirmOpen(true);
    setSelectedAssetId(assetId);
  }

  const isHydrated = useHydrated();
  const { vh } = useViewportHeight();
  const maxHeight = isHydrated ? vh - 12 - 45 + "px" : "100%"; // We need to handle SSR and we are also substracting 12px to properly handle spacing on the bottom and 45px to handle the horizontal tabs

  return (
    <div className="flex flex-1 flex-col" style={{ maxHeight }}>
      <Header {...header} hideBreadcrumbs={true} classNames="text-left" />

      <Filters className="-mx-4 border-b px-4 py-3">
        <div className="flex w-full items-center justify-around gap-6 md:w-auto md:justify-end">
          <When truthy={hasFiltersToClear}>
            <div className="hidden gap-6 md:flex">
              <Button
                as="button"
                onClick={clearFilters}
                variant="link"
                className="block max-w-none font-normal  text-color-500 hover:text-color-600"
                type="button"
              >
                Clear all filters
              </Button>
              <div className="text-color-500"> | </div>
            </div>
          </When>

          <div className="flex w-full justify-around gap-2 p-3 md:w-auto md:justify-end md:p-0 lg:gap-4">
            <DynamicDropdown
              trigger={
                <div className="flex cursor-pointer items-center gap-2">
                  Categories{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "category", queryKey: "name" }}
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
              model={{ name: "tag", queryKey: "name" }}
              label="Filter by tags"
              initialDataKey="tags"
              countKey="totalTags"
            />
            <DynamicDropdown
              trigger={
                <div className="flex cursor-pointer items-center gap-2">
                  Locations{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "location", queryKey: "name" }}
              label="Filter by Location"
              initialDataKey="locations"
              countKey="totalLocations"
              renderItem={({ metadata }) => (
                <div className="flex items-center gap-2">
                  <ImageWithPreview
                    thumbnailUrl={metadata.thumbnailUrl}
                    alt={metadata.name}
                    className="size-6 rounded-[2px]"
                  />
                  <div>{metadata.name}</div>
                </div>
              )}
            />
          </div>
        </div>
      </Filters>

      {/* Body of the modal*/}

      <div className="-mx-4 flex-1 overflow-y-auto px-4 pb-4">
        <List
          ItemComponent={RowComponent}
          /** Clicking on the row will add the current asset to the atom of selected assets */
          navigate={handleSelectAsset}
          customEmptyStateContent={{
            title: "You haven't added any assets yet.",
            text: "What are you waiting for? Create your first asset now!",
            newButtonRoute: `/assets/new?qrId=${qrId}`,
            newButtonContent: "Create new asset and link",
          }}
          className="h-full border-t-0"
        />
      </div>
      <ConfirmLinkingAssetModal
        open={confirmOpen}
        assetId={selectedAssetId}
        onCancel={() => {
          // Reset the selected asset id and close the modal
          setSelectedAssetId("");
          setConfirmOpen(false);
        }}
      />

      {/* Footer of the modal */}
      <footer className="-mx-4 flex justify-between border-t px-4 pt-3">
        <Button variant="secondary" to={`/qr/${qrId}/link`} width="full">
          Close
        </Button>
      </footer>
    </div>
  );
}

const RowComponent = ({ item }: { item: Asset }) => (
  <>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center">
            <AssetImage
              asset={{
                id: item.id,
                mainImage: item.mainImage,
                thumbnailImage: item.thumbnailImage,
                mainImageExpiration: item.mainImageExpiration,
              }}
              alt={`Image of ${item.title}`}
              className="size-full rounded-[4px] border object-cover"
            />
          </div>
          <div className="flex flex-col">
            <p className="word-break whitespace-break-spaces text-left font-medium">
              {item.title}
            </p>
          </div>
        </div>
      </div>
    </Td>

    <Td>
      <ChevronRight />
    </Td>
  </>
);

export const ConfirmLinkingAssetModal = ({
  assetId,
  open = false,
  onCancel,
}: {
  assetId: string;
  open: boolean;
  /**
   * Runs when the modal is closed
   */
  onCancel: () => void;
}) => {
  const { items: assets } = useLoaderData<typeof loader>();
  const asset = assets.find((a) => a.id === assetId);
  const fetcher = useFetcher<typeof action>();
  const { data, state } = fetcher;
  const disabled = isFormProcessing(state);

  return asset ? (
    <AlertDialog
      open={open}
      /**
       * When the modal is closed, we want to set the state to false by using the callback
       */
      onOpenChange={(v) => (!v ? onCancel() : null)}
    >
      <AlertDialogContent className="w-[calc(100vw-32px)]">
        <AlertDialogHeader>
          <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 p-2 text-primary-600">
            <LinkIcon />
          </span>
          <AlertDialogTitle className="text-left">
            Link QR code with ‘{asset.title}’
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            Are you sure that you want to do this? The current QR code that is
            linked to this asset will be unlinked. You can always re-link it
            with the old QR code.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={disabled}>
              Cancel
            </Button>
          </AlertDialogCancel>

          <fetcher.Form method="post">
            <input type="hidden" name="assetId" value={asset.id} />
            <Button
              type="submit"
              data-test-id="confirmLinkAssetButton"
              width="full"
              disabled={disabled}
            >
              Confirm
            </Button>
          </fetcher.Form>
          {data?.error ? (
            <div className="flex flex-col items-center">
              <div className={tw(`mb-2 h-6 text-center text-red-600`)}>
                {data.error.message}
              </div>
            </div>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;
};

export const ErrorBoundary = () => <ErrorContent />;
