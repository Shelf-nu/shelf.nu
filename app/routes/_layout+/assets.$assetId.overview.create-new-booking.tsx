import { ActionFunctionArgs, json, LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import NewBooking from "./bookings.new";
import { z } from "zod";
import { action as newBookingAction } from "~/routes/_layout+/bookings.new";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
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
    const teamMembers = await db.teamMember.findMany({
      where: {
        deletedAt: null,
        organizationId,
      },
      include: { user: true },
      orderBy: { userId: "asc" },
    });

    const selfServiceOrBaseUser = isSelfServiceOrBase
      ? teamMembers.find((member) => member.userId === authSession.userId)
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
        teamMembers,
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
