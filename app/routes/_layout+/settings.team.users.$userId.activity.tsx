import { NoteType } from "@prisma/client";
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Notes, NotesList } from "~/components/assets/notes";
import { NoteWithDate } from "~/components/assets/notes/note";
import { NoPermissionsIcon } from "~/components/icons/library";
import TextualDivider from "~/components/shared/textual-divider";
import { db } from "~/database/db.server";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getDateTimeFormat } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import { parseMarkdownToReact } from "~/utils/md";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMemberProfile,
      action: PermissionAction.read,
    });

    const _notes = await db.note.findMany({
      where: {
        userId,
        type: NoteType.UPDATE,
        asset: {
          organizationId,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return json(
      data({
        notes: _notes.map((note) => ({
          ...note,
          dateDisplay: getDateTimeFormat(request, {
            dateStyle: "short",
            timeStyle: "short",
          }).format(note.createdAt),
          content: parseMarkdownToReact(note.content),
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function UserActivity() {
  const { roles } = useUserRoleHelper();
  const { notes } = useLoaderData<typeof loader>();
  const canReadNotes = userHasPermission({
    roles,
    entity: PermissionEntity.note,
    action: PermissionAction.read,
  });

  return (
    <div className="w-full">
      {canReadNotes ? (
        <>
          {notes?.length > 0 ? (
            <>
              <TextualDivider text="Notes" className="mb-8 lg:hidden" />
              <NotesList notes={notes as NoteWithDate[]} />
            </>
          ) : (
            <div>No notes</div>
          )}
        </>
      ) : (
        <div className="flex h-full flex-col justify-center">
          <div className="flex flex-col items-center justify-center  text-center">
            <div className="mb-4 inline-flex size-8 items-center justify-center  rounded-full bg-primary-100 p-2 text-primary-600">
              <NoPermissionsIcon />
            </div>
            <h5>Insufficient permissions</h5>
            <p>You are not allowed to view asset notes</p>
          </div>
        </div>
      )}
    </div>
  );
}
