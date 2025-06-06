import { useRef } from "react";
import { useLoaderData } from "@remix-run/react";
import { useReactToPrint } from "react-to-print";
import { useSearchParams } from "~/hooks/search-params";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { type loader } from "~/routes/_layout+/receipts.index";
import { useHints } from "~/utils/client-hints";
import { formatEnum } from "~/utils/misc";
import { resolveTeamMemberName } from "~/utils/user";
import { Dialog } from "../layout/dialog";
import { Button } from "../shared/button";
import { Separator } from "../shared/separator";
import When from "../when/when";

export default function CustodyReceiptDialog() {
  const [searchParams, setSearchParams] = useSearchParams();

  const { items, organization } = useLoaderData<typeof loader>();
  const receiptRef = useRef<HTMLDivElement>(null);
  const hints = useHints();

  const { isBaseOrSelfService } = useUserRoleHelper();

  const receiptId = searchParams.get("receiptId");
  const receipt = items.find((item) => item.id === receiptId);
  const custodyAgreement = receipt?.agreement;
  const custodian = receipt?.custodian;
  const asset = receipt?.asset;
  const kit = receipt?.kit;
  const agreementFile = custodyAgreement?.custodyAgreementFiles[0];

  const handlePrint = useReactToPrint({
    content: () => receiptRef.current,
    documentTitle: asset?.title ?? "",
  });

  if (!receipt || !custodyAgreement || !custodian || !agreementFile) {
    return null;
  }

  if (!kit && !asset) {
    return null;
  }

  function handleClose() {
    setSearchParams((prev) => {
      prev.delete("receiptId");
      return prev;
    });
  }

  return (
    <Dialog
      open
      onClose={handleClose}
      title={
        <When
          truthy={receipt.agreementSigned}
          fallback={
            <div className="text-gray-500">
              <h4>Receipt not available</h4>
              <p>
                The receipt is not generated yet because the signature is{" "}
                {formatEnum(receipt.signatureStatus).toLowerCase()}.
              </p>
            </div>
          }
        >
          <div className="px-4 py-2">
            <h4>Signature receipt - ({custodyAgreement.name})</h4>
            <p className="text-gray-600">
              This document was signed by{" "}
              <span className="font-medium text-black">
                {resolveTeamMemberName(custodian)}
              </span>{" "}
              on{" "}
              <span className="font-medium text-black">{receipt.signedOn}</span>
              .
            </p>
          </div>
        </When>
      }
      className="w-full md:max-w-screen-md"
      contentClassName="overflow-hidden z-10 size-full md:max-h-[85vh] md:rounded"
    >
      <When truthy={receipt.agreementSigned}>
        <div ref={receiptRef} className="border-t bg-gray-50 px-10 py-8">
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
                {custodian.user ? (
                  <Button
                    to={
                      isBaseOrSelfService
                        ? "/me/assets"
                        : `/settings/team/users/${custodian.user.id}`
                    }
                    variant="link-gray"
                    target="_blank"
                  >
                    {resolveTeamMemberName(custodian)}
                  </Button>
                ) : (
                  custodian.name
                )}
              </p>
              <Separator className="col-span-3" />

              <p className="p-2 font-medium">Signed Date</p>
              <p className="col-span-2 py-2 text-gray-600">
                {receipt.signedOn}
              </p>
              <Separator className="col-span-3" />

              <p className="p-2 font-medium">{asset ? "Asset" : "Kit"}</p>
              <p className="col-span-2 py-2 text-gray-600">
                <Button
                  className="mb-1 items-start text-start"
                  to={
                    asset ? `/assets/${asset.id}/overview` : `/kits/${kit?.id}`
                  }
                  target="_blank"
                  variant="link-gray"
                >
                  <p>{asset ? asset.title : kit?.name}</p>
                </Button>
              </p>
              <Separator className="col-span-3" />

              <p className="p-2 font-medium">Document</p>
              <p className="col-span-2 py-2 text-gray-600">
                <Button
                  to={agreementFile.url}
                  target="_blank"
                  variant="link-gray"
                >
                  {custodyAgreement.name}
                </Button>
              </p>
              <Separator className="col-span-3" />

              <p className="p-2 font-medium">Signature</p>
              <div className="col-span-2 py-2 font-caveat text-2xl text-gray-600">
                {receipt.signatureText ? (
                  receipt.signatureText
                ) : (
                  <img
                    className="aspect-video w-48"
                    alt="signature"
                    src={receipt.signatureImage ?? ""}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="w-full border-t px-6 py-4">
          <Button
            variant="secondary"
            className="w-full max-w-full"
            onClick={handlePrint}
          >
            Download
          </Button>
        </div>
      </When>
    </Dialog>
  );
}
