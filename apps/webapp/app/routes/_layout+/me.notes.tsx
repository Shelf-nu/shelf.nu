/**
 * My Notes Tab Route — `/me/notes`
 *
 * Renders the "Notes" tab on the authenticated user's own profile page.
 * This tab is only visible to ADMIN and OWNER roles, showing notes
 * that other admins (or they themselves) have placed on their profile.
 *
 * Unlike the user profile route (`settings.team.users.$userId.notes.tsx`),
 * this route uses the authenticated user's ID directly — no URL param needed.
 *
 * @see {@link file://./me.note.tsx} for the create/delete action route
 * @see {@link file://./../../components/user/notes/index.tsx} for the UserNotes container component
 */
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData } from "react-router";
import { NoPermissionsIcon } from "~/components/icons/library";
import type { HeaderData } from "~/components/layout/header/types";
import TextualDivider from "~/components/shared/textual-divider";
import { UserNotes } from "~/components/user/notes";
import { db } from "~/database/db.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getTeamMemberNotes } from "~/modules/team-member-note/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

/**
 * Loads notes for the authenticated user's own profile in the current workspace.
 * Resolves the user's TeamMember, then fetches workspace-scoped notes.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMemberNote,
      action: PermissionAction.read,
    });

    /* Resolve the authenticated user's TeamMember in this workspace.
     * Filter out soft-deleted team members to prevent stale lookups. */
    const teamMember = await db.teamMember.findFirst({
      where: { userId, organizationId, deletedAt: null },
      select: { id: true },
    });

    if (!teamMember) {
      throw new ShelfError({
        cause: null,
        message: "You are not a member of this workspace",
        status: 404,
        additionalData: { userId, organizationId },
        label: "Team Member Note",
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
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  name: "me.notes",
};

/**
 * My Notes tab page component.
 * Shows notes on the current user's own profile, with permission-gated actions.
 */
export default function MyNotesPage() {
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
            actionUrl="/me/note"
          />
        </>
      ) : (
        <div className="flex h-full flex-col justify-center">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="mb-4 inline-flex size-8 items-center justify-center rounded-full bg-primary-100 p-2 text-primary-600">
              <NoPermissionsIcon />
            </div>
            <h5>Insufficient permissions</h5>
            <p>You are not allowed to view notes</p>
          </div>
        </div>
      )}
    </div>
  );
}
