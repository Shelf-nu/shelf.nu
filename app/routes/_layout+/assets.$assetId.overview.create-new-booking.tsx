import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import NewBooking, {
  action as newBookingAction,
} from "~/routes/_layout+/bookings.new";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  data,
  error,
  getCurrentSearchParams,
  getParams,
} from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const searchParams = getCurrentSearchParams(request);
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, currentOrganization, isSelfServiceOrBase } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.create,
      });

    if (isPersonalOrg(currentOrganization)) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You can't create bookings for personal workspaces. Please create a Team workspace to create bookings.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    /* We need to fetch the team members to be able to display them in the custodian dropdown. */
    const teamMembersData = await getTeamMemberForCustodianFilter({
      organizationId,
      getAll:
        searchParams.has("getAll") &&
        hasGetAllValue(searchParams, "teamMember"),
      isSelfService: isSelfServiceOrBase, // we can assume this is false because this view is not allowed for
      userId,
    });

    const selfServiceOrBaseUser = isSelfServiceOrBase
      ? teamMembersData.teamMembers.find(
          (member) => member.userId === authSession.userId
        )
      : undefined;

    if (isSelfServiceOrBase && !selfServiceOrBaseUser) {
      throw new ShelfError({
        cause: null,
        message:
          "Seems like something is wrong with your user. Please contact support to get this resolved. Make sure to include the trace id seen below.",
        label: "Booking",
      });
    }

    return json(
      data({
        showModal: true,
        isSelfServiceOrBase,
        selfServiceOrBaseUser,
        ...teamMembersData,
        assetIds: [assetId],
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action(args: ActionFunctionArgs) {
  return newBookingAction(args);
}

export default function NewBookingWithAsset() {
  return <NewBooking />;
}
