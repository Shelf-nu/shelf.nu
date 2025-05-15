import { useState } from "react";
import type { CustodyAgreement, CustodyAgreementFile } from "@prisma/client";
import PdfViewer from "~/components/pdf-viewer/pdf-viewer";
import Agreement from "./agreement";
import AgreementDialog from "./agreement-dialog";
import Icon from "../icons/icon";
import { Button } from "../shared/button";
import When from "../when/when";

type SignCustodyPageProps = {
  custodyAgreement: Pick<
    CustodyAgreement,
    "id" | "name" | "description" | "signatureRequired"
  >;
  custodyAgreementFile: CustodyAgreementFile;
  isAgreementSigned: boolean;
  isLoggedIn: boolean;
  overviewButton: {
    label: string;
    url: string;
  };
};

export default function SignCustodyPage({
  custodyAgreement,
  custodyAgreementFile,
  isAgreementSigned,
  isLoggedIn,
  overviewButton,
}: SignCustodyPageProps) {
  const [isClosed, setIsClosed] = useState(false);

  if (isAgreementSigned || isClosed) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex w-[450px] flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex items-center justify-center rounded-full bg-green-50 p-1">
            <div className="flex items-center justify-center rounded-full bg-green-100 p-2">
              <Icon icon="sign" className="text-green-600" />
            </div>
          </div>

          <div>
            <h4 className="mb-1">
              {isClosed ? "Thank you" : "Successfully signed document."}
            </h4>
            <p>
              Thank you for {isClosed ? "reading" : "signing"} the document. You
              can close this page or visit your dashboard.
            </p>
          </div>

          <When
            truthy={isLoggedIn}
            fallback={
              <Button className="w-full" to="/login">
                Login now
              </Button>
            }
          >
            <div className="flex w-full flex-col items-center gap-4 md:flex-row">
              <Button className="w-full" variant="secondary" to="/dashboard">
                To Dashboard
              </Button>

              <Button
                className="w-full break-keep"
                to={overviewButton.url}
                // to={`/assets/${asset.id}/overview`}
              >
                {overviewButton.label}
              </Button>
            </div>
          </When>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[url('/static/images/bg-overlay1.png')] p-4 md:p-14">
      <div className="size-full border bg-gray-25">
        <div className="flex h-full flex-col md:flex-row">
          <div className="relative order-2 flex h-full grow overflow-y-auto md:order-1">
            <PdfViewer url={custodyAgreementFile.url} />
          </div>

          <div className="order-1 flex size-full flex-col overflow-y-auto overflow-x-clip border-l scrollbar-thin md:order-2 md:w-[400px]">
            <div className="flex items-center justify-between border-b p-4">
              <img
                src="/static/images/logo-full-color(x2).png"
                alt="logo"
                className="h-8"
              />

              <When truthy={custodyAgreement.signatureRequired}>
                <AgreementDialog className="md:hidden" />
              </When>
            </div>

            <div className="border-b p-4">
              <h1 className="mb-1 text-lg font-semibold">
                {custodyAgreement.name}
              </h1>
              <p className="text-gray-600">
                {custodyAgreement.description ?? "No description provided"}
              </p>
            </div>

            <When
              truthy={custodyAgreement.signatureRequired}
              fallback={
                <div className="flex items-center justify-end border-b p-2">
                  <Button
                    type="button"
                    onClick={() => {
                      setIsClosed(true);
                    }}
                  >
                    Close
                  </Button>
                </div>
              }
            >
              <Agreement className="hidden md:block" />
            </When>
          </div>
        </div>
      </div>
    </div>
  );
}
