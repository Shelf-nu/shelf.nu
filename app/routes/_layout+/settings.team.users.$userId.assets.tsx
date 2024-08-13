import type { Asset, Kit, Category, Custody, Tag } from "@prisma/client";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@radix-ui/react-tooltip";
import { json, redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight, KitIcon } from "~/components/icons/library";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import { Image } from "~/components/shared/image";
import { Th, Td } from "~/components/table";
import When from "~/components/when/when";
import {
  useSearchParamHasValue,
  useClearValueFromParams,
} from "~/hooks/search-params";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import {
  getFiltersFromRequest,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { ListItemTagsColumn } from "./assets._index";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMemberProfile,
      action: PermissionAction.read,
    });

    const { userId: selectedUserId } = params;
    const { filters, redirectNeeded } = await getFiltersFromRequest(
      request,
      organizationId
    );

    if (filters && redirectNeeded) {
      const cookieParams = new URLSearchParams(filters);
      return redirect(`/assets?${cookieParams.toString()}`);
    }

    /**
     * We have to protect against bad actors adding teamMember param in the url and getting the assets from another team member
     * In this view there could only be 1 team member this is scoped to and that is the user we are currently viewing: selectedUserId
     * */
    const filtersSearchParams = new URLSearchParams(filters);
    filtersSearchParams.set("teamMember", selectedUserId as string);

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
      teamMembers,
      totalTeamMembers,
      rawTeamMembers,
    } = await getPaginatedAndFilterableAssets({
      request,
      organizationId,
      filters: filtersSearchParams.toString(),
    });

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const userPrefsCookie = await userPrefs.serialize(cookie);
    const headers = [setCookie(userPrefsCookie)];

    return json(
      data({
        search,
        totalItems: totalAssets,
        perPage,
        page,
        categories,
        tags,
        items: assets,
        totalPages,
        cookie,
        totalCategories,
        totalTags,
        locations,
        totalLocations,
        teamMembers,
        totalTeamMembers,
        rawTeamMembers,
        modelName,
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

export default function UserAssetsPage() {
  return <AssetsList />;
}

export const handle = {
  name: "$userId.assets",
};

const AssetsList = () => {
  const navigate = useNavigate();
  const hasFiltersToClear = useSearchParamHasValue(
    "category",
    "tag",
    "location"
  );
  const clearFilters = useClearValueFromParams("category", "tag", "location");
  const { roles } = useUserRoleHelper();

  return (
    <ListContentWrapper>
      <Filters>
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
          </div>
        </div>
      </Filters>
      <List
        title="Assets"
        ItemComponent={ListAssetContent}
        navigate={(itemId) => navigate(`/assets/${itemId}`)}
        className=" overflow-x-visible md:overflow-x-auto"
        customEmptyStateContent={{
          title: "No assets in custody",
          text: "This user currently has no assets in their custody.",
        }}
        headerChildren={
          <>
            <Th className="hidden md:table-cell">Category</Th>
            <Th className="hidden md:table-cell">Tags</Th>
            <When
              truthy={userHasPermission({
                roles,
                entity: PermissionEntity.custody,
                action: PermissionAction.read,
              })}
            >
              <Th className="hidden md:table-cell">Custodian</Th>
            </When>
            <Th className="hidden md:table-cell">Location</Th>
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
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.custody,
          action: PermissionAction.read,
        })}
      >
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
      <Td className="hidden md:table-cell">
        {location?.name ? <GrayBadge>{location.name}</GrayBadge> : null}
      </Td>
    </>
  );
};
