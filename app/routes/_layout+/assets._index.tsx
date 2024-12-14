import { type Tag } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import {
  useFetcher,
  useFetchers,
  useLoaderData,
  useNavigate,
} from "@remix-run/react";
import { motion } from "framer-motion";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
// eslint-disable-next-line import/no-cycle
import { AdvancedAssetRow } from "~/components/assets/assets-index/advanced-asset-row";
import { AdvancedTableHeader } from "~/components/assets/assets-index/advanced-table-header";
import { AssetIndexPagination } from "~/components/assets/assets-index/asset-index-pagination";
// eslint-disable-next-line import/no-cycle
import { AssetIndexFilters } from "~/components/assets/assets-index/filters";
import BulkActionsDropdown from "~/components/assets/bulk-actions-dropdown";
import { ImportButton } from "~/components/assets/import-button";
import { KitIcon } from "~/components/icons/library";
import Header from "~/components/layout/header";
import type { ListProps } from "~/components/list";
import { List } from "~/components/list";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import { Spinner } from "~/components/shared/spinner";
import { Tag as TagBadge } from "~/components/shared/tag";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { db } from "~/database/db.server";

import { useAssetIndexColumns } from "~/hooks/use-asset-index-columns";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { useDisabled } from "~/hooks/use-disabled";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  advancedModeLoader,
  simpleModeLoader,
} from "~/modules/asset/data.server";
import { bulkDeleteAssets } from "~/modules/asset/service.server";
import type { AssetsFromViewItem } from "~/modules/asset/types";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import {
  changeMode,
  getAssetIndexSettings,
} from "~/modules/asset-index-settings/service.server";
import assetCss from "~/styles/assets.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";

import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { markSubstring } from "~/utils/mark-substring";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";

export type AssetIndexLoaderData = typeof loader;

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: assetCss },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    /** Validate permissions and fetch user */
    const [{ organizationId, organizations, currentOrganization, role }, user] =
      await Promise.all([
        requirePermission({
          userId,
          request,
          entity: PermissionEntity.asset,
          action: PermissionAction.read,
        }),
        db.user
          .findUniqueOrThrow({
            where: {
              id: userId,
            },
            select: {
              firstName: true,
            },
          })
          .catch((cause) => {
            throw new ShelfError({
              cause,
              message:
                "We can't find your user data. Please try again or contact support.",
              additionalData: { userId },
              label: "Assets",
            });
          }),
      ]);

    const settings = await getAssetIndexSettings({ userId, organizationId });
    const mode = settings.mode;

    /** For base and self service users, we dont allow to view the advanced index */
    if (mode === "ADVANCED" && ["BASE", "SELF_SERVICE"].includes(role)) {
      await changeMode({
        userId,
        organizationId,
        mode: "SIMPLE",
      });
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You don't have permission to access the advanced mode. We will automatically switch you back to 'simple' mode. Please reload the page.",
        label: "Assets",
        status: 403,
      });
    }

    return mode === "SIMPLE"
      ? await simpleModeLoader({
          request,
          userId,
          organizationId,
          organizations,
          role,
          currentOrganization,
          user,
          settings,
        })
      : await advancedModeLoader({
          request,
          userId,
          organizationId,
          organizations,
          role,
          currentOrganization,
          user,
          settings,
        });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({ intent: z.enum(["bulk-delete"]) })
    );

    const intent2ActionMap: { [K in typeof intent]: PermissionAction } = {
      "bulk-delete": PermissionAction.delete,
    };

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: intent2ActionMap[intent],
    });

    switch (intent) {
      case "bulk-delete": {
        const { assetIds, currentSearchParams } = parseData(
          formData,
          z
            .object({ assetIds: z.array(z.string()).min(1) })
            .and(CurrentSearchParamsSchema)
        );

        await bulkDeleteAssets({
          assetIds,
          organizationId,
          userId,
          currentSearchParams,
        });

        sendNotification({
          title: "Assets deleted",
          message: "Your assets has been deleted successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  /**
   * If we are toggliong the sidebar, no need to revalidate this loader.
   * Revalidation happens in _layout
   */
  if (actionResult?.isTogglingSidebar) {
    return false;
  }

  return defaultShouldRevalidate;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function AssetIndexPage() {
  const { roles } = useUserRoleHelper();
  const { canImportAssets } = useLoaderData<typeof loader>();
  const { modeIsAdvanced } = useAssetIndexViewState();

  return (
    <>
      <Header hidePageDescription={modeIsAdvanced}>
        <When
          truthy={userHasPermission({
            roles,
            entity: PermissionEntity.asset,
            action: PermissionAction.create,
          })}
        >
          <>
            <ImportButton canImportAssets={canImportAssets} />
            <Button
              to="new"
              role="link"
              aria-label={`new asset`}
              icon="asset"
              data-test-id="createNewAsset"
            >
              New asset
            </Button>
          </>
        </When>
      </Header>
      <AssetsList />
    </>
  );
}

export const AssetsList = ({
  customEmptyState,
  disableTeamMemberFilter,
  disableBulkActions,
}: {
  customEmptyState?: ListProps["customEmptyStateContent"];
  disableTeamMemberFilter?: boolean;
  disableBulkActions?: boolean;
}) => {
  const navigate = useNavigate();
  // We use the hook because it handles optimistic UI
  const { modeIsSimple } = useAssetIndexViewState();
  const { isMd } = useViewportHeight();
  const fetchers = useFetchers();
  /** Find the fetcher used for toggling between asset index modes */
  const modeFetcher = fetchers.find(
    (fetcher) => fetcher.key === "asset-index-settings-mode"
  );

  // const isSwappingMode = modeFetcher?.state === "loading";
  const isSwappingMode = modeFetcher?.formData;

  const columns = useAssetIndexColumns();
  const { roles, isBase } = useUserRoleHelper();

  const searchParams: string[] = ["category", "tag", "location"];
  if (!disableTeamMemberFilter) {
    searchParams.push("teamMember");
  }

  const headerChildren = modeIsSimple ? (
    <>
      <Th>Category</Th>
      <Th>Tags</Th>
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.custody,
          action: PermissionAction.read,
        })}
      >
        <Th>Custodian</Th>
      </When>
      <Th>Location</Th>
    </>
  ) : (
    <AdvancedTableHeader columns={columns} />
  );

  return (
    <div
      className={tw(
        "flex flex-col",
        modeIsSimple ? "gap-4 pb-5 pt-4" : "gap-2 py-2"
      )}
    >
      <When truthy={!!isSwappingMode}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.2 }}
          className="absolute inset-0 z-[11] flex flex-col items-center justify-center border border-gray-200 bg-gray-25/95 pt-[200px]"
        >
          <Spinner />
          <p className="mt-2">Changing mode...</p>
        </motion.div>
      </When>

      {!isMd && !modeIsSimple ? (
        <AdvancedModeMobileFallback />
      ) : (
        <>
          <AssetIndexFilters
            disableTeamMemberFilter={disableTeamMemberFilter}
          />
          <List
            title="Assets"
            ItemComponent={modeIsSimple ? ListAssetContent : AdvancedAssetRow}
            customPagination={<AssetIndexPagination />}
            /**
             * Using remix's navigate is the default behaviour, however it can also receive a custom function
             */
            navigate={
              modeIsSimple
                ? (itemId) => navigate(`/assets/${itemId}`)
                : undefined
            }
            bulkActions={
              disableBulkActions || isBase ? undefined : <BulkActionsDropdown />
            }
            customEmptyStateContent={
              customEmptyState ? customEmptyState : undefined
            }
            headerChildren={headerChildren}
          />
        </>
      )}
    </div>
  );
};

const ListAssetContent = ({ item }: { item: AssetsFromViewItem }) => {
  const { category, tags, custody, location, kit } = item;
  const { roles } = useUserRoleHelper();
  return (
    <>
      {/* Item */}
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4  md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex size-12 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="size-full rounded-[4px] border object-cover"
              />

              {kit?.id ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-white bg-gray-200">
                        <KitIcon className="size-2" />
                      </div>
                    </TooltipTrigger>

                    <TooltipContent side="top">
                      <p className="text-sm">{kit.name}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </div>
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block font-medium">
                {markSubstring(item.title)}
              </span>
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

      {/* Category */}
      <Td>
        {category ? (
          <Badge color={category.color} withDot={false}>
            {category.name}
          </Badge>
        ) : (
          <Badge color="#575757" withDot={false}>
            Uncategorized
          </Badge>
        )}
      </Td>

      {/* Tags */}
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>

      {/* Custodian */}
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.custody,
          action: PermissionAction.read,
        })}
      >
        <Td>
          {custody ? (
            <GrayBadge>
              <>
                {custody.custodian?.user ? (
                  <img
                    src={
                      custody.custodian?.user?.profilePicture ||
                      "/static/images/default_pfp.jpg"
                    }
                    className="mr-1 size-4 rounded-full"
                    alt=""
                  />
                ) : null}
                <span className="mt-px">
                  {resolveTeamMemberName({
                    name: custody.custodian.name,
                    user: custody.custodian?.user
                      ? {
                          firstName: custody.custodian?.user?.firstName || null,
                          lastName: custody.custodian?.user?.lastName || null,
                          profilePicture:
                            custody.custodian?.user?.profilePicture || null,
                          email: custody.custodian?.user?.email || "",
                        }
                      : undefined,
                  })}
                </span>
              </>
            </GrayBadge>
          ) : null}
        </Td>
      </When>

      {/* Location */}
      <Td>{location?.name ? <GrayBadge>{location.name}</GrayBadge> : null}</Td>
    </>
  );
};

export const ListItemTagsColumn = ({
  tags,
}: {
  tags: Pick<Tag, "id" | "name">[] | undefined;
}) => {
  const visibleTags = tags?.slice(0, 2);
  const remainingTags = tags?.slice(2);

  return tags && tags?.length > 0 ? (
    <div className="">
      {visibleTags?.map((tag) => (
        <TagBadge key={tag.id} className="mr-2">
          {tag.name}
        </TagBadge>
      ))}
      {remainingTags && remainingTags?.length > 0 ? (
        <TagBadge
          className="mr-2 w-6 text-center"
          title={`${remainingTags?.map((t) => t.name).join(", ")}`}
        >
          {`+${tags.length - 2}`}
        </TagBadge>
      ) : null}
    </div>
  ) : null;
};

function AdvancedModeMobileFallback() {
  const fetcher = useFetcher();
  const disabled = useDisabled(fetcher);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <p className="text-center">
        Advanced mode is currently not available on mobile.
      </p>
      <fetcher.Form
        method="post"
        action="/api/asset-index-settings"
        onSubmit={() => {
          window.scrollTo({
            top: 0,
            behavior: "smooth",
          });
        }}
      >
        <input type="hidden" name="intent" value="changeMode" />

        <Button name="mode" value="SIMPLE" disabled={disabled}>
          Change to simple mode
        </Button>
      </fetcher.Form>
    </div>
  );
}
