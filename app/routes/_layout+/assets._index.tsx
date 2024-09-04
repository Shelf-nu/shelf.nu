import type { Category, Asset, Tag, Custody, Kit } from "@prisma/client";
import { OrganizationRoles, AssetStatus } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { z } from "zod";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import BulkActionsDropdown from "~/components/assets/bulk-actions-dropdown";
import { ImportButton } from "~/components/assets/import-button";
import { StatusFilter } from "~/components/booking/status-filter";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight, KitIcon } from "~/components/icons/library";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import type { ListProps } from "~/components/list";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import { Image } from "~/components/shared/image";
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
import {
  useClearValueFromParams,
  useSearchParamHasValue,
} from "~/hooks/search-params";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  bulkDeleteAssets,
  getPaginatedAndFilterableAssets,
  updateAssetsWithBookingCustodians,
} from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import assetCss from "~/styles/assets.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import {
  userPrefs,
  getFiltersFromRequest,
  setCookie,
} from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { canImportAssets } from "~/utils/subscription.server";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: assetCss },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
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
    const {
      filters,
      serializedCookie: filtersCookie,
      redirectNeeded,
    } = await getFiltersFromRequest(request, organizationId);

    if (filters && redirectNeeded) {
      const cookieParams = new URLSearchParams(filters);
      return redirect(`/assets?${cookieParams.toString()}`);
    }
    let [
      tierLimit,
      {
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
        teamMembers,
        totalTeamMembers,
        rawTeamMembers,
      },
    ] = await Promise.all([
      getOrganizationTierLimit({
        organizationId,
        organizations,
      }),
      getPaginatedAndFilterableAssets({
        request,
        organizationId,
        filters,
      }),
    ]);

    if (role === OrganizationRoles.SELF_SERVICE) {
      /**
       * For self service users we dont return the assets that are not available to book
       */
      assets = assets.filter((a) => a.availableToBook);
    }

    assets = await updateAssetsWithBookingCustodians(assets);

    const header: HeaderData = {
      title: isPersonalOrg(currentOrganization)
        ? user?.firstName
          ? `${user.firstName}'s inventory`
          : `Your inventory`
        : currentOrganization?.name
        ? `${currentOrganization?.name}'s inventory`
        : "Your inventory",
    };

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const userPrefsCookie = await userPrefs.serialize(cookie);
    const headers = [
      setCookie(userPrefsCookie),
      ...(filtersCookie ? [setCookie(filtersCookie)] : []),
    ];
    return json(
      data({
        header,
        items: assets,
        categories,
        tags,
        search,
        page,
        totalItems: totalAssets,
        perPage,
        totalPages,
        modelName,
        canImportAssets:
          canImportAssets(tierLimit) &&
          (await hasPermission({
            organizationId,
            userId,
            roles: role ? [role] : [],
            entity: PermissionEntity.asset,
            action: PermissionAction.import,
          })),
        searchFieldLabel: "Search assets",
        searchFieldTooltip: {
          title: "Search your asset database",
          text: "Search assets based on asset name or description, category, tag, location, custodian name. Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
        },
        totalCategories,
        totalTags,
        locations,
        totalLocations,
        teamMembers,
        totalTeamMembers,
        rawTeamMembers,
        filters,
        organizationId,
      }),
      {
        headers,
      }
    );
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

  return (
    <>
      <Header>
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
  const searchParams: string[] = ["category", "tag", "location"];
  if (!disableTeamMemberFilter) {
    searchParams.push("teamMember");
  }
  const hasFiltersToClear = useSearchParamHasValue(...searchParams);
  const clearFilters = useClearValueFromParams(...searchParams);
  const { roles } = useUserRoleHelper();

  return (
    <ListContentWrapper>
      <Filters
        slots={{
          "left-of-search": <StatusFilter statusItems={AssetStatus} />,
          "right-of-search": <SortBy />,
        }}
      >
        <div className="flex w-full items-center justify-around gap-6 md:w-auto md:justify-end">
          {hasFiltersToClear ? (
            <div className="hidden gap-6 md:flex">
              <Button
                as="button"
                onClick={clearFilters}
                variant="link"
                className="block min-w-28 max-w-none font-normal text-gray-500 hover:text-gray-600"
                type="button"
              >
                Clear all filters
              </Button>
              <div className="text-gray-500"> | </div>
            </div>
          ) : null}

          <div className="flex w-full items-center justify-around gap-2 p-3 md:w-auto md:justify-end md:p-0 lg:gap-4">
            <DynamicDropdown
              trigger={
                <div className="flex cursor-pointer items-center gap-2">
                  Categories{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "category", queryKey: "name" }}
              label="Filter by category"
              placeholder="Search categories"
              initialDataKey="categories"
              countKey="totalCategories"
              withoutValueItem={{
                id: "uncategorized",
                name: "Uncategorized",
              }}
            />
            <DynamicDropdown
              trigger={
                <div className="flex cursor-pointer items-center gap-2">
                  Tags <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "tag", queryKey: "name" }}
              label="Filter by tag"
              initialDataKey="tags"
              countKey="totalTags"
              withoutValueItem={{
                id: "untagged",
                name: "Without tag",
              }}
            />
            <DynamicDropdown
              trigger={
                <div className="flex cursor-pointer items-center gap-2">
                  Locations{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "location", queryKey: "name" }}
              label="Filter by location"
              initialDataKey="locations"
              countKey="totalLocations"
              withoutValueItem={{
                id: "without-location",
                name: "Without location",
              }}
              renderItem={({ metadata }) => (
                <div className="flex items-center gap-2">
                  <Image
                    imageId={metadata.imageId}
                    alt="img"
                    className={tw(
                      "size-6 rounded-[2px] object-cover",
                      metadata.description ? "rounded-b-none border-b-0" : ""
                    )}
                  />
                  <div>{metadata.name}</div>
                </div>
              )}
            />
            <When
              truthy={
                userHasPermission({
                  roles,
                  entity: PermissionEntity.custody,
                  action: PermissionAction.read,
                }) && !disableTeamMemberFilter
              }
            >
              <DynamicDropdown
                trigger={
                  <div className="flex cursor-pointer items-center gap-2">
                    Custodian{" "}
                    <ChevronRight className="hidden rotate-90 md:inline" />
                  </div>
                }
                model={{
                  name: "teamMember",
                  queryKey: "name",
                  deletedAt: null,
                }}
                transformItem={(item) => ({
                  ...item,
                  id: item.metadata?.userId ? item.metadata.userId : item.id,
                })}
                renderItem={(item) => resolveTeamMemberName(item)}
                label="Filter by custodian"
                placeholder="Search team members"
                initialDataKey="teamMembers"
                countKey="totalTeamMembers"
                withoutValueItem={{
                  id: "without-custody",
                  name: "Without custody",
                }}
              />
            </When>
          </div>
        </div>
      </Filters>
      <List
        title="Assets"
        ItemComponent={ListAssetContent}
        /**
         * Using remix's navigate is the default behaviour, however it can receive also a custom function
         */
        navigate={(itemId) => navigate(`/assets/${itemId}`)}
        bulkActions={disableBulkActions ? undefined : <BulkActionsDropdown />}
        customEmptyStateContent={
          customEmptyState ? customEmptyState : undefined
        }
        headerChildren={
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
        }
      />
    </ListContentWrapper>
  );
};

const ListAssetContent = ({
  item,
}: {
  item: Asset & {
    kit: Kit;
    category?: Category;
    tags?: Tag[];
    custody: Custody & {
      custodian: {
        name: string;
        user?: {
          firstName: string | null;
          lastName: string | null;
          profilePicture: string | null;
          email: string | null;
        };
      };
    };
    location: {
      name: string;
    };
  };
}) => {
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
                {item.title}
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
          <Badge color={"#808080"} withDot={false}>
            {"Uncategorized"}
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

export const ListItemTagsColumn = ({ tags }: { tags: Tag[] | undefined }) => {
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
