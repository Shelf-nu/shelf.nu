import { useRef } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useReactToPrint } from "react-to-print";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import { getAgreementByAssetId } from "~/modules/custody-agreement";
import { getDateTimeFormat, useHints } from "~/utils/client-hints";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.custodyAgreement,
      action: PermissionAction.read,
    });

    const { asset, custodyAgreement, custody, custodian } =
      await getAgreementByAssetId({
        assetId,
        organizationId,
      });

    if (!custody.agreementSigned) {
      throw new ShelfError({
        cause: null,
        message:
          "Asset custody has not been signed yet or does not require a signature.",
        label: "Assets",
      });
    }

    const signedOn = getDateTimeFormat(request, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(custody.updatedAt);

    return json(
      data({
        showModal: true,
        asset,
        custodyAgreement,
        custody: {
          ...custody,
          signedOn,
        },
        custodian,
        organization: { name: currentOrganization.name },
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function ViewReceipt() {
  const { asset, custodian, custody, organization, custodyAgreement } =
    useLoaderData<typeof loader>();

  const hints = useHints();

  const receiptRef = useRef<HTMLDivElement>(null);

  const downloadReceipt = useReactToPrint({
    content: () => receiptRef.current,
  });

  return (
    <div className="-m-6">
      <div className="border-b px-6 py-4">
        <h4>Signature receipt - ({custodyAgreement.name})</h4>
        <p className="text-gray-600">
          This document was signed by{" "}
          <span className="font-medium text-black">
            {resolveTeamMemberName(custodian)}
          </span>{" "}
          on <span className="font-medium text-black">{custody.signedOn}</span>.
        </p>
      </div>

      <div ref={receiptRef} className="bg-gray-50 px-10 py-8">
        <div className="border bg-white p-8">
          <div className="mb-10 flex items-center justify-between gap-4">
            <img
              src="/static/images/logo-full-color(x2).png"
              alt="logo"
              className="h-5"
            />

            <p className="text-sm text-gray-500">
              Generated on{" "}
              {new Date().toLocaleString(hints.locale ?? "en-US", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: hints.timeZone,
              })}
            </p>
          </div>

          <div className="mb-4">
            <h3 className="text-gray-600">{organization.name}</h3>
            <h2>Signature receipt ({custodyAgreement.name})</h2>
          </div>

          <div className="grid grid-cols-3 border">
            <p className="p-2 font-medium">Custodian</p>
            <p className="col-span-2 py-2 text-gray-600">
              {resolveTeamMemberName(custodian)}
            </p>
            <Separator className="col-span-3" />

            <p className="p-2 font-medium">Date</p>
            <p className="col-span-2 py-2 text-gray-600">{custody.signedOn}</p>
            <Separator className="col-span-3" />

            <p className="p-2 font-medium">Asset</p>
            <p className="col-span-2 py-2 text-gray-600">{asset.title}</p>
            <Separator className="col-span-3" />

            <p className="p-2 font-medium">Document</p>
            <p className="col-span-2 py-2 text-gray-600">
              {custodyAgreement.name}
            </p>
            <Separator className="col-span-3" />

            <p className="p-2 font-medium">Signature</p>
            <div className="col-span-2 py-2 text-gray-600">
              {custody.signatureText ? (
                custody.signatureText
              ) : (
                <img
                  className="aspect-video w-48"
                  alt="signature"
                  src={custody.signatureImage ?? ""}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t px-6 py-4">
        <Button
          variant="secondary"
          className="w-full"
          onClick={downloadReceipt}
        >
          Download
        </Button>
      </div>
    </div>
  );
}
