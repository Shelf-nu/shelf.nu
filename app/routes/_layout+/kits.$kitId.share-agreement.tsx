import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import ShareAgreementContent from "~/components/custody/share-agreement-content";
import { getAgreementByKitId } from "~/modules/kit/service.server";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, z.object({ kitId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

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
