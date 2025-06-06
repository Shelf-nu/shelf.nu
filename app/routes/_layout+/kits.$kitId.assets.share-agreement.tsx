import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import ShareAgreementContent from "~/components/custody/share-agreement-content";
import { sendEmail } from "~/emails/mail.server";
import { kitCustodyAssignedWithAgreementEmailText } from "~/modules/kit/emais";
import { getAgreementByKitId } from "~/modules/kit/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, z.object({ kitId: z.string() }));

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    /** Self or base users are not allowed to share agreement */
    if (isSelfServiceOrBase) {
      throw new ShelfError({
        cause: null,
        label: "Kit",
        message: "You are not allowed to share custody agreements.",
      });
    }

    const { custody, custodyAgreement, custodian } = await getAgreementByKitId({
      kitId,
      organizationId,
    });

    const signUrl = `${SERVER_URL}/sign/kit-custody/${custody.id}`;
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
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, z.object({ kitId: z.string() }));

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    const { kit, custodian, custody, custodyAgreement } =
      await getAgreementByKitId({
        kitId,
        organizationId,
      });

    if (!custodian.user) {
      throw new ShelfError({
        cause: null,
        label: "Kit",
        message: "Email cannot be sent to non-registered members",
      });
    }

    sendEmail({
      to: custodian.user.email,
      subject: `You have been assigned custody over ${kit.name}.`,
      text: kitCustodyAssignedWithAgreementEmailText({
        kitName: kit.name,
        assignerName: resolveTeamMemberName(custodian),
        kitId,
        custodyId: custody.id,
        signatureRequired: custodyAgreement.signatureRequired,
      }),
    });

    sendNotification({
      title: "Kit shared",
      message: "An email has been sent to the custodian.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return redirect(`/kits/${kitId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function ShareKitCustodyAgreement() {
  const { custodyAgreement, custodian, isCustodianNrm, signUrl } =
    useLoaderData<typeof loader>();

  return (
    <ShareAgreementContent
      type="kit"
      agreementName={custodyAgreement.name}
      custodian={custodian}
      isCustodianNrm={isCustodianNrm}
      signUrl={signUrl}
    />
  );
}
