import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { type loader } from "~/routes/sign.$custodyId";
import Agreement from "./agreement";
import { Dialog } from "../layout/dialog";
import { Button } from "../shared/button";

type AgreementDialogProps = {
  className?: string;
};

export default function AgreementDialog({ className }: AgreementDialogProps) {
  const { custodyAgreement } = useLoaderData<typeof loader>();
  const [isOpen, setIsOpen] = useState(false);

  function handleOpen() {
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
  }

  return (
    <>
      <Button className={className} onClick={handleOpen}>
        Sign
      </Button>

      <Dialog
        open={isOpen}
        onClose={handleClose}
        title={
          <div>
            <h1 className="mb-1 text-lg font-semibold">
              {custodyAgreement.name}
            </h1>
            <p className="text-gray-600">
              {custodyAgreement.description ?? "No description provided"}
            </p>
          </div>
        }
      >
        <div className="border-y">
          <Agreement />
        </div>
      </Dialog>
    </>
  );
}
