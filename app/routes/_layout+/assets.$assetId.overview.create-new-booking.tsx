import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { newBookingHeader } from "~/components/booking/new-booking-header";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { getTagsForBookingTagsFilter } from "~/modules/tag/service.server";
import { getTeamMemberForForm } from "~/modules/team-member/service.server";
import NewBooking, {
  action as newBookingAction,
} from "~/routes/_layout+/bookings.new";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  payload,
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

export const meta = () => [{ title: appendToMetaTitle("Create new booking") }];

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
    const [teamMembersData, tagsData] = await Promise.all([
      getTeamMemberForForm({
        organizationId,
        userId,
        isSelfServiceOrBase,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
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

    return payload({
      header: newBookingHeader,
      currentOrganization,
      userId,
      showModal: true,
      isSelfServiceOrBase,
      selfServiceOrBaseUser,
      ...teamMembersData,
      // For consistency, also provide teamMembersForForm
      teamMembersForForm: teamMembersData.teamMembers,
      assetIds: [assetId],
      ...tagsData,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action(args: ActionFunctionArgs) {
  return newBookingAction(args);
}

export default function NewBookingWithAsset() {
  return <NewBooking />;
}
