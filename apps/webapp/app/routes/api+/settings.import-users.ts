import { data, type ActionFunctionArgs } from "react-router";
import { INVITABLE_ROLES, isInvitableRole } from "~/modules/invite/roles";
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
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanInviteUsersToWorkspace } from "~/utils/subscription.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
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
        shouldBeCaptured: false,
      });
    }

    const users = extractCSVDataFromContentImport(
      csvData,
      IMPORT_USERS_CSV_HEADERS
    );

    /**
     * The CSV is untrusted input and its `role` column reaches the invite
     * verbatim. The single-invite endpoint validates against the same list via
     * `InviteUserFormSchema`; without this, an ADMIN could upload a row with
     * `role=OWNER` and mint an OWNER invite — which `changeUserRole` and the
     * invite dialog both refuse.
     *
     * Rows are reported rather than silently dropped: an admin who lists ten
     * users and is told "invited 9" has no way to tell which row was ignored.
     * Fully blank rows never get here — `csvDataFromRequest` strips them.
     */
    const invalidRoleRows = users
      .map((user, index) => ({ user, index }))
      .filter(({ user }) => !isInvitableRole(user.role))
      // +2 converts a 0-based data index to the spreadsheet row the user sees
      // (1 for the header row, 1 because spreadsheets are 1-based).
      .map(({ user, index }) => `row ${index + 2} ("${user.role ?? ""}")`);

    if (invalidRoleRows.length > 0) {
      throw new ShelfError({
        cause: null,
        title: "Invalid role in CSV",
        message: `Roles must be one of ${INVITABLE_ROLES.join(
          ", "
        )}. Ownership cannot be granted by invite — use ownership transfer instead. Problem rows: ${invalidRoleRows.join(
          ", "
        )}.`,
        additionalData: { userId, organizationId },
        label: "Team Member",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const response = await bulkInviteUsers({
      organizationId,
      userId,
      users,
      extraMessage: formData.get("message") as string,
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
