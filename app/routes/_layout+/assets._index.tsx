import type { Category, Asset, Tag, Custody } from "@prisma/client";
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
import { ChevronRight } from "~/components/icons";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import type { ListItemData } from "~/components/list/list-item";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Tag as TagBadge } from "~/components/shared/tag";
import { Td, Th } from "~/components/table";
import { db } from "~/database";
import { useClearValueFromParams, useSearchParamHasValue } from "~/hooks";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import {
  getPaginatedAndFilterableAssets,
  updateAssetsWithBookingCustodians,
} from "~/modules/asset";
import { getOrganizationTierLimit } from "~/modules/tier";
import assetCss from "~/styles/assets.css";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { userPrefs } from "~/utils/cookies.server";
import { ShelfError } from "~/utils/error";
import { isPersonalOrg } from "~/utils/organization";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermission } from "~/utils/roles.server";
import { canImportAssets } from "~/utils/subscription";

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

  const { organizationId, organizations, currentOrganization, role } =
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });
  // @TODO we shouldnt have to do this. We can combine it with the requirePermission
  const user = await db.user.findUnique({
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
  });
  const tierLimit = await getOrganizationTierLimit({
    organizationId,
    organizations,
  });
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
    return redirect("/assets");
  }
  if (!assets) {
    // @TODO Solve error handling
    throw new ShelfError({
      cause: null,
      title: "Hey!",
      message: `No assets found`,
      status: 404,
      label: "Unknown",
    });
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
    {
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
    },
    {
      headers: [["Set-Cookie", await userPrefs.serialize(cookie)]],
    }
  );
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
  const hasFiltersToClear = useSearchParamHasValue("category", "tag");
  const clearFilters = useClearValueFromParams("category", "tag");
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
              New Asset
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
  const { category, tags, custody, location } = item;
  const isSelfService = useUserIsSelfService();
  return (
    <>
      {/* Item */}
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
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
                <span className="mt-[1px]">{custody.custodian.name}</span>
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

const GrayBadge = ({
  children,
}: {
  children: string | JSX.Element | JSX.Element[];
}) => (
  <span className="inline-flex w-max items-center justify-center rounded-2xl bg-gray-100 px-2 py-[2px] text-center text-[12px] font-medium text-gray-700">
    {children}
  </span>
);
