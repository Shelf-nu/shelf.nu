import type { Category, Asset, Tag, Custody, Kit } from "@prisma/client";
import { OrganizationRoles, AssetStatus } from "@prisma/client";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { redirect } from "react-router";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ImportButton } from "~/components/assets/import-button";
import { StatusFilter } from "~/components/booking/status-filter";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight, KitIcon } from "~/components/icons/library";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import type { ListItemData } from "~/components/list/list-item";
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
import { db } from "~/database/db.server";
import {
  useClearValueFromParams,
  useSearchParamHasValue,
} from "~/hooks/use-search-param-utils";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import {
  getPaginatedAndFilterableAssets,
  updateAssetsWithBookingCustodians,
} from "~/modules/asset/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import assetCss from "~/styles/assets.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie, userPrefs } from "~/utils/cookies.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { canImportAssets } from "~/utils/subscription";
import { tw } from "~/utils/tw";

export interface IndexResponse {
  /** Page number. Starts at 1 */
  page: number;

  /** Items to be loaded per page */
  perPage: number;

  /** Items to be rendered in the list */
  items: ListItemData[];

  categoriesIds?: string[];

  /** Total items - before filtering */
  totalItems: number;

  /** Total pages */
  totalPages: number;

  /** Search string */
  search: string | null;

  /** Used so all the default actions can be generate such as empty state, creating and so on */
  modelName: {
    singular: string;
    plural: string;
  };
}
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
              tier: {
                include: { tierLimit: true },
              },
              userOrganizations: {
                where: {
                  userId,
                },
                select: {
                  organization: {
                    select: {
                      id: true,
                      name: true,
                      type: true,
                      owner: {
                        select: {
                          tier: {
                            include: { tierLimit: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
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
      },
    ] = await Promise.all([
      getOrganizationTierLimit({
        organizationId,
        organizations,
      }),
      getPaginatedAndFilterableAssets({
        request,
        organizationId,
      }),
    ]);

    if (totalPages !== 0 && page > totalPages) {
      return redirect("/assets");
    }

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
        canImportAssets: canImportAssets(tierLimit),
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
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
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
  { title: appendToMetaTitle(data.header.title) },
];

export default function AssetIndexPage() {
  const navigate = useNavigate();
  const hasFiltersToClear = useSearchParamHasValue(
    "category",
    "tag",
    "location",
    "teamMember"
  );
  const clearFilters = useClearValueFromParams(
    "category",
    "tag",
    "location",
    "teamMember"
  );
  const { canImportAssets } = useLoaderData<typeof loader>();
  const isSelfService = useUserIsSelfService();

  return (
    <>
      <Header>
        {!isSelfService ? (
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
        ) : null}
      </Header>
      <ListContentWrapper>
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
                label="Filter by custodian"
                placeholder="Search team members"
                initialDataKey="teamMembers"
                countKey="totalTeamMembers"
              />
            </div>
          </div>
        </Filters>
        <List
          ItemComponent={ListAssetContent}
          navigate={(itemId) => navigate(itemId)}
          className=" overflow-x-visible md:overflow-x-auto"
          headerChildren={
            <>
              <Th className="hidden md:table-cell">Category</Th>
              <Th className="hidden md:table-cell">Tags</Th>
              {!isSelfService ? (
                <Th className="hidden md:table-cell">Custodian</Th>
              ) : null}
              <Th className="hidden md:table-cell">Location</Th>
            </>
          }
        />
      </ListContentWrapper>
    </>
  );
}

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
          profilePicture: string | null;
        };
      };
    };
    location: {
      name: string;
    };
  };
}) => {
  const { category, tags, custody, location, kit } = item;
  const isSelfService = useUserIsSelfService();
  return (
    <>
      {/* Item */}
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
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

          <button className="block md:hidden">
            <ChevronRight />
          </button>
        </div>
      </Td>

      {/* Category */}
      <Td className="hidden md:table-cell">
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
      <Td className="hidden text-left md:table-cell">
        <ListItemTagsColumn tags={tags} />
      </Td>

      {/* Custodian */}
      {!isSelfService ? (
        <Td className="hidden md:table-cell">
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
                <span className="mt-px">{custody.custodian.name}</span>
              </>
            </GrayBadge>
          ) : null}
        </Td>
      ) : null}

      {/* Location */}
      <Td className="hidden md:table-cell">
        {location?.name ? <GrayBadge>{location.name}</GrayBadge> : null}
      </Td>
    </>
  );
};

const ListItemTagsColumn = ({ tags }: { tags: Tag[] | undefined }) => {
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
