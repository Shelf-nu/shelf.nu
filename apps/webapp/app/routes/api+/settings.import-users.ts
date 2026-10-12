import { data, type ActionFunctionArgs } from "react-router";
import { bulkInviteUsers } from "~/modules/invite/service.server";
import { IMPORT_USERS_CSV_HEADERS } from "~/modules/invite/utils.server";
import { csvDataFromRequest } from "~/utils/csv.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error } from "~/utils/http.server";
import { extractCSVDataFromContentImport } from "~/utils/import.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { assertCanAssignRoles } from "~/utils/permissions/role-assignment.server";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanInviteUsersToWorkspace } from "~/utils/subscription.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.create,
    });

    await assertUserCanInviteUsersToWorkspace({ organizationId });

    const formData = await request.clone().formData();

    const csvData = await csvDataFromRequest({ request });
    if (csvData.length < 2) {
      throw new ShelfError({
        cause: null,
        message: "CSV file is empty",
        additionalData: { userId },
        label: "Team Member",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const users = extractCSVDataFromContentImport(
      csvData,
      IMPORT_USERS_CSV_HEADERS
    );

    /**
     * The CSV is untrusted input. `bulkInviteUsers` validates every row (role,
     * email, team member, SSO) before writing anything and refuses the file
     * with a 400 listing each problem row, which the dialog renders.
     */
    const response = await bulkInviteUsers({
      organizationId,
      userId,
      users,
      extraMessage: formData.get("message") as string,
      actorOwnsWorkspace: access.ownsWorkspace,
    });

    if (!response) {
      return data(payload({ success: true }));
    }

    return data(payload({ success: true, ...response }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
