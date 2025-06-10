import { OrganizationRoles } from "@prisma/client";
import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { BulkAssignCustodySchema } from "~/components/assets/bulk-assign-custody-dialog";
import { db } from "~/database/db.server";
import { bulkCheckOutAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export type BulkAssignCustodySuccessMessageType =
  | "user-with-sign"
  | "user-without-sign"
  | "nrm-with-sign"
  | "nrm-without-sign";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const { organizationId, role, currentOrganization } =
      await requirePermission({
        request,
        userId,
        entity: PermissionEntity.asset,
        action: PermissionAction.custody,
      });

    const formData = await request.formData();

    const { assetIds, custodian, currentSearchParams, agreement } = parseData(
      formData,
      BulkAssignCustodySchema.and(CurrentSearchParamsSchema)
    );

    const teamMember = await db.teamMember.findUnique({
      where: { id: custodian.id },
      select: {
        id: true,
        userId: true,
        user: {
          select: { userOrganizations: true },
        },
      },
    });

    if (role === OrganizationRoles.SELF_SERVICE) {
      if (teamMember?.userId !== userId) {
        throw new ShelfError({
          cause: null,
          title: "Action not allowed",
          message: "Self user can only assign custody to themselves only.",
          additionalData: { userId, assetIds, custodian },
          label: "Assets",
        });
      }
    }

    const isCustodianNRM = !teamMember?.userId;
    const isCustodianUser = teamMember?.userId;

    const { custodies, agreementFound } = await bulkCheckOutAssets({
      userId,
      assetIds,
      custodianId: custodian.id,
      custodianName: custodian.name,
      custodianEmail: custodian.email,
      organizationId,
      currentSearchParams,
      custodyAgreement: agreement,
      orgName: currentOrganization.name,
    });

    sendNotification({
      title: `Assets are now in custody of ${custodian.name}`,
      message:
        "Remember, these assets will be unavailable until it is manually checked in.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    /**
     * If user assigned custody to single asset and the custody has an agreement associated
     * then we navigate the user to the Share Agreement dialog
     */
    if (custodies.length === 1 && agreementFound?.id) {
      return redirect(
        `/assets/${custodies[0].asset.id}/overview/share-agreement`
      );
    }
    const agreementWithSign =
      agreementFound && agreementFound.signatureRequired;
    const agreementWithoutSign =
      agreementFound && !agreementFound.signatureRequired;

    /** We use `successMessageType` in our dialog to show the success message accordingly. */
    let successMessageType: BulkAssignCustodySuccessMessageType | undefined =
      undefined;

    let assetsCount = custodies.length;

    if (isCustodianUser && agreementWithSign) {
      successMessageType = "user-with-sign";
    } else if (isCustodianUser && agreementWithoutSign) {
      successMessageType = "user-without-sign";
    } else if (isCustodianNRM && agreementWithSign) {
      successMessageType = "nrm-with-sign";
    } else if (isCustodianNRM && agreementWithoutSign) {
      successMessageType = "nrm-without-sign";
    }

    return json(data({ success: true, successMessageType, assetsCount }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
