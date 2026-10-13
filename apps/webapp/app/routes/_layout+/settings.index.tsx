/**
 * `/settings` renders nothing: it sends the member to the first settings tab
 * they may see.
 *
 * @see {@link file://../../utils/permissions/settings-tabs.ts}
 */
import { data, redirect, type LoaderFunctionArgs } from "react-router";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  SETTINGS_LAYOUT_GATES,
  visibleSettingsTabs,
} from "~/utils/permissions/settings-tabs";
import { requireAnyPermission } from "~/utils/roles.server";

/**
 * Redirects to the first settings tab the member may see.
 *
 * @throws 403 when the member may see no settings tab
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  try {
    const { currentOrganization, roles } = await requireAnyPermission({
      userId,
      request,
      anyOf: SETTINGS_LAYOUT_GATES,
    });
    const [first] = visibleSettingsTabs({
      roles,
      isPersonalOrg: isPersonalOrg(currentOrganization),
    });
    if (!first) {
      throw new ShelfError({
        cause: null,
        title: "Unauthorized",
        message: "You have no permission to perform this action",
        additionalData: { userId },
        status: 403,
        label: "Permission",
        shouldBeCaptured: false,
      });
    }
    return redirect(`/settings/${first.to}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const shouldRevalidate = () => false;
