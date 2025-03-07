import { useRef } from "react";
import { useLoaderData } from "@remix-run/react";
import { changeDpiDataUrl } from "changedpi";
import { toJpeg } from "html-to-image";
import { useSearchParams } from "~/hooks/search-params";
import { type loader } from "~/routes/_layout+/receipts.index";
import { useHints } from "~/utils/client-hints";
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

  const receiptId = searchParams.get("receiptId");
  if (!receiptId) {
    return null;
  }

  function downloadReceipt() {
    const receipt = receiptRef.current;
    if (!receipt) {
      return;
    }

    toJpeg(receipt, {
      height: receipt.offsetHeight * 2,
      width: receipt.offsetWidth * 2,
      style: {
        transform: `scale(${2})`,
        transformOrigin: "top left",
        width: `${receipt.offsetWidth}px`,
        height: `${receipt.offsetHeight}px`,
      },
    })
      .then((dataUrl) => {
        const filename = `${asset?.title}`;
        const downloadLink = document.createElement("a");
        downloadLink.href = changeDpiDataUrl(dataUrl, 300);
        downloadLink.download = filename;
        downloadLink.click();
        URL.revokeObjectURL(downloadLink.href);
      })
      // eslint-disable-next-line no-console
      .catch(console.error);
  }

  function handleClose() {
    setSearchParams((prev) => {
      prev.delete("receiptId");
      return prev;
    });
  }

  const receipt = items.find((item) => item.id === receiptId);
  const custodyAgreement = receipt?.agreement;
  const custodian = receipt?.custodian;
  const asset = receipt?.asset;
  const agreementFile = custodyAgreement?.custodyAgreementFiles[0];

  if (!receipt || !custodyAgreement || !custodian || !asset || !agreementFile) {
    return null;
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
                {receipt.signatureStatus.toLowerCase()}.
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
                    to={`/settings/team/users/${custodian.user.id}`}
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

              <p className="p-2 font-medium">Asset</p>
              <p className="col-span-2 py-2 text-gray-600">
                <Button
                  to={`/assets/${asset.id}/overview`}
                  target="_blank"
                  variant="link-gray"
                >
                  {asset.title}
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
              <div className="col-span-2 py-2 text-gray-600">
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
            onClick={downloadReceipt}
          >
            Download
          </Button>
        </div>
      </When>
    </Dialog>
  );
}
