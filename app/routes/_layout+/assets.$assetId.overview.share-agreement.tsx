import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import ShareAgreementContent from "~/components/custody/share-agreement-content";
import { sendEmail } from "~/emails/mail.server";
import { getAgreementByAssetId } from "~/modules/custody-agreement";
import { assetCustodyAssignedWithAgreementEmailText } from "~/modules/invite/helpers";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    const { custody, custodyAgreement, custodian, asset } =
      await getAgreementByAssetId({
        assetId,
        organizationId,
      });

    const isInsideKit = !!asset.kit;

    const signUrl = `${SERVER_URL}/sign${isInsideKit ? "/kit-custody" : ""}/${
      isInsideKit ? asset.kit?.custody?.id : custody.id
    }`;
    const isCustodianNrm = !custodian.user;

    const header = {
      title: "Share custody agreement",
    };

    return json(
      data({
        header,
        showModal: true,
        custodyAgreement,
        custodian,
        signUrl,
        isCustodianNrm,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    const { asset, custodian, custody, custodyAgreement } =
      await getAgreementByAssetId({
        assetId,
        organizationId,
      });

    if (!custodian.user) {
      throw new ShelfError({
        cause: null,
        message: "Email cannot be send to non-registered members.",
        label: "Custody Agreement",
      });
    }

    sendNotification({
      title: "Sending email...",
      message: "Sending a link to the custodian to sign the agreement.",
      icon: { name: "spinner", variant: "primary" },
      senderId: userId,
    });

    sendEmail({
      to: custodian?.user?.email ?? "",
      subject: `You have been assigned custody over ${asset.title}.`,
      text: assetCustodyAssignedWithAgreementEmailText({
        assetName: asset.title,
        assignerName: resolveTeamMemberName(custodian),
        assetId: asset.id,
        custodyId: custody.id,
        signatureRequired: custodyAgreement.signatureRequired,
      }),
    });

    sendNotification({
      title: "Asset shared",
      message: "An email has been sent to the custodian.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/assets/${assetId}/overview`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function ShareAgreement() {
  const { custodyAgreement, custodian, signUrl, isCustodianNrm } =
    useLoaderData<typeof loader>();

  return (
    <ShareAgreementContent
      type="asset"
      agreementName={custodyAgreement.name}
      custodian={custodian}
      isCustodianNrm={isCustodianNrm}
      signUrl={signUrl}
    />
  );
}
