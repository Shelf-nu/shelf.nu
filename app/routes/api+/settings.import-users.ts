import { json, type ActionFunctionArgs } from "@remix-run/node";
import { InviteUserFormSchema } from "~/components/settings/invite-user-dialog";
import { bulkInviteUsers } from "~/modules/invite/service.server";
import { csvDataFromRequest } from "~/utils/csv.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, data, error } from "~/utils/http.server";
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
      InviteUserFormSchema.array()
    );

    const response = await bulkInviteUsers({
      organizationId,
      userId,
      users,
      extraMessage: formData.get("message") as string,
    });

    if (!response) {
      return json(data({ success: true }));
    }

    return json(data({ success: true, ...response }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
