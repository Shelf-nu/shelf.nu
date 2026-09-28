import type { Prisma } from "@prisma/client";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import ContextualModal from "~/components/layout/contextual-modal";

import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import BulkActionsDropdown from "~/components/nrm/bulk-actions-dropdown";
import { ExportNrmButton } from "~/components/nrm/export-nrm-button";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import { ImportNrmButton } from "~/components/workspace/import-nrm-button";
import { TeamMembersActionsDropdown } from "~/components/workspace/nrm-actions-dropdown";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { getPaginatedAndFilterableSettingTeamMembers } from "~/modules/settings/service.server";
import { getHeldCustodyCount } from "~/modules/team-member/custody-count";
import { deleteNRM } from "~/modules/team-member/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, parseData, payload } from "~/utils/http.server";
import { isPersonalOrg as checkIsPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { canImportNRM } from "~/utils/subscription.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations, currentOrganization } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.nonRegisteredMember,
        action: PermissionAction.read,
      });

    const [
      tierLimit,
      { page, perPage, search, totalPages, teamMembers, totalTeamMembers },
    ] = await Promise.all([
      getOrganizationTierLimit({
        organizationId,
        organizations,
      }),
      getPaginatedAndFilterableSettingTeamMembers({
        organizationId,
        request,
      }),
    ]);

    const header: HeaderData = {
      title: `Settings - Manage Team Members`,
    };

    const modelName = {
      singular: "non-registered member",
      plural: "non-registered members",
    };

    return payload({
      header,
      modelName,
      page,
      perPage,
      search,
      totalPages,
      items: teamMembers,
      totalItems: totalTeamMembers,
      canImportNRM: canImportNRM(tierLimit),
      isPersonalOrg: checkIsPersonalOrg(currentOrganization),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // The only intent is `delete`, so the whole action is gated on it.
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.nonRegisteredMember,
      action: PermissionAction.delete,
    });

    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum(["delete"]),
      }),
      {
        additionalData: {
          organizationId,
        },
      }
    );

    switch (intent) {
      case "delete": {
        const { teamMemberId } = parseData(
          formData,
          z.object({
            teamMemberId: z.string(),
          }),
          {
            additionalData: {
              organizationId,
              intent,
            },
          }
        );

        await deleteNRM({ nrmId: teamMemberId, organizationId });

        return redirect(`/settings/team/nrm`);
      }
      default: {
        throw new ShelfError({
          cause: null,
          message: "Invalid action",
          additionalData: { intent },
          label: "Team",
        });
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * The Non-registered members tab: the list, its toolbar and its row actions.
 *
 * Each control shows with the `nonRegisteredMember` grant of the action it
 * performs. The routes behind them keep their own gates.
 */
export default function NrmSettings() {
  const { canImportNRM } = useLoaderData<typeof loader>();
  const roles = useOrganizationRoles();
  const can = (action: PermissionAction) =>
    userHasPermission({
      roles,
      entity: PermissionEntity.nonRegisteredMember,
      action,
    });
  const rowPermissions: TeamMemberRowPermissions = {
    canEdit: can(PermissionAction.update),
    canDelete: can(PermissionAction.delete),
  };

  return (
    <div>
      <p className="mb-6 text-xs text-gray-600">
        Non-registered members can be given custody of an asset. If you want
        them to get reminders, invite them via email.
      </p>

      <ListContentWrapper>
        <Filters>
          <div className="flex items-center justify-end gap-2">
            {can(PermissionAction.export) ? <ExportNrmButton /> : null}
            {can(PermissionAction.import) ? (
              <ImportNrmButton canImportNRM={canImportNRM} />
            ) : null}

            {can(PermissionAction.create) ? (
              <Button
                variant="primary"
                to="add-member"
                className="mt-2 w-full md:mt-0 md:w-max"
              >
                <span className=" whitespace-nowrap">Add NRM</span>
              </Button>
            ) : null}
          </div>
        </Filters>

        <List
          bulkActions={
            can(PermissionAction.delete) ? <BulkActionsDropdown /> : undefined
          }
          className="overflow-x-visible md:overflow-x-auto"
          ItemComponent={TeamMemberRow}
          extraItemComponentProps={rowPermissions}
          customEmptyStateContent={{
            title: "No non-registered members yet",
            text: "Non-registered members are name-only records for assigning custody. They can't log in.",
            newButtonRoute: "add-member",
            newButtonContent: "Add NRM",
          }}
          hideFirstHeaderColumn
          headerChildren={
            <>
              <Th>ID</Th>
              <Th>Name</Th>
              <Th>Custodies</Th>
              <Th>Actions</Th>
            </>
          }
        />
      </ListContentWrapper>

      <ContextualModal />
    </div>
  );
}

/** Which row actions the caller may use, computed once for the whole list. */
type TeamMemberRowPermissions = {
  /** Holds `nonRegisteredMember:update`: shows the Edit item. */
  canEdit: boolean;
  /** Holds `nonRegisteredMember:delete`: shows the Delete item. */
  canDelete: boolean;
};

/**
 * One NRM row of the list.
 *
 * @param props.item - The member, with its custody counts
 * @param props.extraProps - The caller's row permissions, passed by `List`
 */
function TeamMemberRow({
  item,
  extraProps,
}: {
  extraProps: TeamMemberRowPermissions;
  item: Prisma.TeamMemberGetPayload<{
    include: {
      _count: {
        select: {
          custodies: true;
          kitCustodies: true;
        };
      };
    };
  }>;
}) {
  return (
    <>
      <Td>
        <div>
          <div className="pl-4 md:pl-6">{item.id}</div>
        </div>
      </Td>
      <Td className="w-full whitespace-normal">{item.name}</Td>
      <Td className="text-right">{getHeldCustodyCount(item._count)}</Td>
      <Td className="text-right">
        <TeamMembersActionsDropdown
          teamMember={item}
          canEdit={extraProps.canEdit}
          canDelete={extraProps.canDelete}
        />
      </Td>
    </>
  );
}
