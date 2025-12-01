import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useParams } from "react-router";
import z from "zod";
import { CategoryBadge } from "~/components/assets/category-badge";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import TextualDivider from "~/components/shared/textual-divider";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getLocationKits } from "~/modules/location/service.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import {
  payload,
  error,
  getCurrentSearchParams,
  getParams,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

const paramsSchema = z.object({ locationId: z.string() });

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: loaderData ? appendToMetaTitle(loaderData.header.title) : "" },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { locationId } = getParams(params, paramsSchema);

  try {
    const { organizationId, canSeeAllCustody } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const {
      page,
      perPageParam,
      search,
      orderBy,
      orderDirection,
      teamMemberIds,
    } = getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const [{ kits, totalKits }, { teamMembers, totalTeamMembers }] =
      await Promise.all([
        getLocationKits({
          organizationId,
          id: locationId,
          page,
          perPage,
          search,
          orderBy,
          orderDirection,
          teamMemberIds,
        }),
        getTeamMemberForCustodianFilter({
          organizationId,
          getAll:
            searchParams.has("getAll") &&
            hasGetAllValue(searchParams, "teamMember"),
          selectedTeamMembers: teamMemberIds,
          filterByUserId: !canSeeAllCustody, // When the user cannot see all custody, only return their own team member
          userId,
        }),
      ]);

    const modelName = {
      singular: "kit",
      plural: "kits",
    };

    const totalPages = Math.ceil(totalKits / perPage);

    const header: HeaderData = {
      title: `Kits in ${locationId}`,
      subHeading: locationId,
    };

    return payload({
      modelName,
      items: kits,
      page,
      totalItems: totalKits,
      perPage,
      totalPages,
      header,
      teamMembers,
      totalTeamMembers,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function LocationKits() {
  const { roles } = useUserRoleHelper();
  const { locationId } = useParams<z.infer<typeof paramsSchema>>();
  const userRoleCanManageKits = userHasPermission({
    roles,
    entity: PermissionEntity.location,
    action: PermissionAction.manageKits,
  });

  const organization = useCurrentOrganization();
  const canReadCustody = userHasCustodyViewPermission({
    roles,
    organization: organization as OrganizationPermissionSettings, // Here we can be sure as TeamMemberBadge is only used in the context of an organization/logged in route
  });

  return (
    <>
      <ContextualSidebar />
      <ContextualModal />

      <TextualDivider text="Kits" className="mb-4 lg:hidden" />
      <div className="flex flex-col md:gap-2">
        <Filters className="responsive-filters mb-2 lg:mb-0">
          <div className="mt-2 flex w-full items-center gap-2  md:mt-0">
            <When truthy={userRoleCanManageKits}>
              <div className="mt-2 flex w-full items-center gap-2  md:mt-0">
                <Button
                  icon="scan"
                  variant="secondary"
                  to={`/locations/${locationId}/scan-assets-kits`}
                  width="full"
                >
                  Scan
                </Button>
                <Button
                  to="manage-kits"
                  variant="primary"
                  width="full"
                  className="whitespace-nowrap"
                >
                  Add kits
                </Button>
              </div>
            </When>
            <When truthy={canReadCustody}>
              <DynamicDropdown
                trigger={
                  <div className="flex cursor-pointer items-center gap-2">
                    Custodian
                    <ChevronRight className="hidden rotate-90 md:inline" />
                  </div>
                }
                model={{
                  name: "teamMember",
                  queryKey: "name",
                  deletedAt: null,
                }}
                label="Filter by custodian"
                placeholder="Search team members"
                initialDataKey="teamMembers"
                countKey="totalTeamMembers"
                renderItem={(item) => resolveTeamMemberName(item, true)}
              />
            </When>
          </div>
        </Filters>

        <List
          className=""
          ItemComponent={Row}
          headerChildren={
            <>
              <Th>Category</Th>
            </>
          }
          customEmptyStateContent={{
            title: "You haven't added any kits yet.",
            text: "What are you waiting for? Add your first kit now!",
            newButtonRoute: "manage-kits",
            newButtonContent: "Add kit",
          }}
        />
      </div>
    </>
  );
}

const Row = ({
  item,
}: {
  item: Prisma.KitGetPayload<{ include: { category: true } }>;
}) => {
  const { category } = item;

  return (
    <>
      {/* Name */}
      <Td className="w-full min-w-[330px] p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center">
              <KitImage
                kit={{
                  kitId: item.id,
                  image: item.image,
                  imageExpiration: item.imageExpiration,
                  alt: item.name,
                }}
                alt={item.name}
                className="size-full rounded border object-cover"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <span className="word-break whitespace-break-spaces font-medium">
                <Button
                  to={`/kits/${item.id}`}
                  variant="link"
                  className="text-left text-gray-900 hover:text-gray-700"
                  target="_blank"
                  onlyNewTabIconOnHover={true}
                >
                  {item.name}
                </Button>
              </span>
              <KitStatusBadge status={item.status} availableToBook />
            </div>
          </div>
        </div>
      </Td>

      {/* Category*/}
      <Td>
        <CategoryBadge category={category} />
      </Td>
    </>
  );
};
