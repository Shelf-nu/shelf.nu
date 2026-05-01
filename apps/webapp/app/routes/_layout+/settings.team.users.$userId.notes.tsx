/**
 * User Notes Tab Route — `/settings/team/users/:userId/notes`
 *
 * Renders the "Notes" tab on the admin user profile page.
 * This tab is only visible to ADMIN and OWNER roles.
 *
 * The loader resolves the target user's TeamMember in the current workspace,
 * then fetches all workspace-scoped notes for that team member.
 * The component performs client-side permission checks to conditionally
 * render the create form and delete actions.
 *
 * @see {@link file://./settings.team.users.$userId.note.tsx} for the create/delete action route
 * @see {@link file://./../../components/user/notes/index.tsx} for the UserNotes container component
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData } from "react-router";
import { z } from "zod";
import { NoPermissionsIcon } from "~/components/icons/library";
import type { HeaderData } from "~/components/layout/header/types";
import TextualDivider from "~/components/shared/textual-divider";
import { UserNotes } from "~/components/user/notes";
import { db } from "~/database/db.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getTeamMemberNotes } from "~/modules/team-member-note/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ userId: z.string() });

/**
 * Loads user notes scoped to the current workspace.
 * Resolves User ID → TeamMember ID, then fetches notes for that team member.
 * Server-side permission check ensures only ADMIN/OWNER can access.
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  /** The user whose notes we're loading — NOT the authenticated admin */
  const { userId: targetUserId } = getParams(params, paramsSchema, {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMemberNote,
      action: PermissionAction.read,
    });

    /* Resolve User → TeamMember for workspace-scoped note querying.
     * Filter out soft-deleted team members to prevent stale lookups. */
    const teamMember = await db.teamMember.findFirst({
      where: { userId: targetUserId, organizationId, deletedAt: null },
      select: { id: true },
    });

    if (!teamMember) {
      throw new ShelfError({
        cause: null,
        message: "User not found in this workspace",
        status: 404,
        additionalData: { targetUserId, organizationId },
        label: "Team Member Note",
        shouldBeCaptured: false,
      });
    }

    const notes = await getTeamMemberNotes({
      teamMemberId: teamMember.id,
      organizationId,
    });

    const header: HeaderData = {
      title: "Notes",
    };

    return payload({
      notes,
      header,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { targetUserId, userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  name: "$userId.notes",
};

/**
 * User Notes tab page component.
 * Checks client-side permissions to determine which actions (create/delete)
 * the current admin can perform, then renders the UserNotes container.
 */
export default function UserNotesPage() {
  const { notes } = useLoaderData<typeof loader>();
  const { roles } = useUserRoleHelper();
  const canReadNotes = userHasPermission({
    roles,
    entity: PermissionEntity.teamMemberNote,
    action: PermissionAction.read,
  });
  const canCreateNotes = userHasPermission({
    roles,
    entity: PermissionEntity.teamMemberNote,
    action: PermissionAction.create,
  });
  const canDeleteNotes = userHasPermission({
    roles,
    entity: PermissionEntity.teamMemberNote,
    action: PermissionAction.delete,
  });

  return (
    <div className="mt-4 w-full">
      {canReadNotes ? (
        <>
          <TextualDivider text="Notes" className="mb-8 lg:hidden" />
          <UserNotes
            notes={notes}
            canCreate={canCreateNotes}
            canDelete={canDeleteNotes}
          />
        </>
      ) : (
        <div className="flex h-full flex-col justify-center">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="mb-4 inline-flex size-8 items-center justify-center rounded-full bg-primary-100 p-2 text-primary-600">
              <NoPermissionsIcon />
            </div>
            <h5>Insufficient permissions</h5>
            <p>You are not allowed to view user notes</p>
          </div>
        </div>
      )}
    </div>
  );
}
