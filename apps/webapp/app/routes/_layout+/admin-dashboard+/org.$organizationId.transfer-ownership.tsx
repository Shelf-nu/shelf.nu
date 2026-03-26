import { OrganizationType } from "@prisma/client";
import {
  data,
  redirect,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import z from "zod";
import TransferOwnershipCard, {
  TransferOwnershipSchema,
} from "~/components/settings/transfer-ownership-card";
import { db } from "~/database/db.server";
import {
  getOrganizationAdmins,
  getOrganizationById,
  transferOwnership,
} from "~/modules/organization/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams, parseData, payload } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";
import {
  getOwnerSubscriptionInfo,
  premiumIsEnabled,
} from "~/utils/stripe.server";
import { resolveUserDisplayName } from "~/utils/user";

export const meta = () => [
  { title: appendToMetaTitle("Transfer organization ownership") },
];

export async function loader({ context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() })
  );

  try {
    await requireAdmin(userId);

    // Fetch admins for the select dropdown and organization for the confirmation input
    const [admins, organization] = await Promise.all([
      getOrganizationAdmins({ organizationId }),
      getOrganizationById(organizationId),
    ]);

    // Get subscription info for the workspace owner
    const ownerSubscriptionInfo = await getOwnerSubscriptionInfo(
      organization.userId,
      organizationId
    );

    // Count owner's other team workspaces (for warning about tier downgrade)
    const ownerOtherTeamWorkspacesCount = await db.organization.count({
      where: {
        userId: organization.userId,
        type: OrganizationType.TEAM,
        id: { not: organizationId },
      },
    });

    return payload({
      admins,
      organizationId,
      organizationName: organization.name,
      ownerSubscriptionInfo,
      ownerOtherTeamWorkspacesCount,
      premiumIsEnabled,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * Handles the transfer ownership form submission.
 *
 * This action allows Shelf admins to transfer ownership of any organization
 * to one of its existing admins. The flow:
 * 1. Validates that the current user is a Shelf admin
 * 2. Parses and validates the form data (new owner ID + confirmation checkbox)
 * 3. Fetches the organization to get its details for the transfer
 * 4. Calls transferOwnership which updates the org owner and swaps user roles
 * 5. Sends a success notification and redirects back to the org page
 */
export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() })
  );

  try {
    await requireAdmin(userId);

    const formData = await request.formData();
    const parsedData = parseData(formData, TransferOwnershipSchema, {
      additionalData: { userId, organizationId },
    });

    // Fetch the organization to pass to transferOwnership
    const currentOrganization = await getOrganizationById(organizationId);

    // Transfer ownership: updates org owner and swaps roles between old and new owner
    const { newOwner } = await transferOwnership({
      currentOrganization,
      newOwnerId: parsedData.newOwner,
      userId,
      transferSubscription: parsedData.transferSubscription,
    });

    sendNotification({
      title: "Ownership transferred",
      message: `You have successfully transferred ownership of ${
        currentOrganization.name
      } to ${resolveUserDisplayName(newOwner)}`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/admin-dashboard/org/${organizationId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, organizationId });
    return data(error(reason), { status: reason.status });
  }
}

export default function TransferOwnership() {
  const {
    organizationId,
    organizationName,
    admins,
    ownerSubscriptionInfo,
    ownerOtherTeamWorkspacesCount,
    premiumIsEnabled: premiumEnabled,
  } = useLoaderData<typeof loader>();

  return (
    <div>
      <TransferOwnershipCard
        action={`/admin-dashboard/org/${organizationId}/transfer-ownership`}
        organizationName={organizationName}
        admins={admins}
        ownerSubscriptionInfo={ownerSubscriptionInfo}
        ownerOtherTeamWorkspacesCount={ownerOtherTeamWorkspacesCount}
        premiumIsEnabled={premiumEnabled}
      />
    </div>
  );
}
