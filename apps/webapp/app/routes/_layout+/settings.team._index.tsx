import { data, redirect, type LoaderFunctionArgs } from "react-router";
import { ErrorContent } from "~/components/errors";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  TEAM_LAYOUT_GATES,
  visibleTeamTabs,
} from "~/utils/permissions/settings-tabs";
import { requireAnyPermission } from "~/utils/roles.server";

/**
 * `/settings/team` renders nothing: it sends the member to the first Team tab
 * they may see.
 *
 * @see {@link file://../../utils/permissions/settings-tabs.ts}
 */
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    const { currentOrganization, roles } = await requireAnyPermission({
      userId,
      request,
      anyOf: TEAM_LAYOUT_GATES,
    });
    const [first] = visibleTeamTabs({
      roles,
      isPersonalOrg: currentOrganization.type === "PERSONAL",
    });
    // `requireAnyPermission` already refused a membership with no Team tab,
    // so `first` exists; the fallback keeps the type total.
    return redirect(`/settings/team/${first?.to ?? "nrm"}`);
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
};

export const shouldRevalidate = () => false;
export const ErrorBoundary = () => <ErrorContent />;
