import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { getKit } from "~/modules/kit/service.server";
import { getTagsForBookingTagsFilter } from "~/modules/tag/service.server";
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
  const userId = authSession.userId;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const {
      organizationId,
      currentOrganization,
      isSelfServiceOrBase,
      userOrganizations,
    } = await requirePermission({
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

    const kit = await getKit({
      id: kitId,
      organizationId,
      extraInclude: { assets: true },
      userOrganizations,
      request,
    });

    /* We need to fetch the team members to be able to display them in the custodian dropdown. */
    const [teamMembersData, tagsData] = await Promise.all([
      getTeamMemberForCustodianFilter({
        organizationId,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
        filterByUserId: isSelfServiceOrBase, // Self service or Base users can only create bookings for themselves so we always filter by userId
        userId,
      }),
      getTagsForBookingTagsFilter({
        organizationId,
      }),
    ]);

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
        currentOrganization,
        userId,
        showModal: true,
        isSelfServiceOrBase,
        selfServiceOrBaseUser,
        ...teamMembersData,
        assetIds: kit.assets.map((a) => a.id),
        ...tagsData,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action(args: ActionFunctionArgs) {
  return newBookingAction(args);
}

export default function NewBookingWithKit() {
  return <NewBooking />;
}
