import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { type loader } from "~/routes/sign.$templateId";
import Agreement from "./agreement";
import { Dialog } from "../layout/dialog";
import { Button } from "../shared/button";

type AgreementDialogProps = {
  className?: string;
};

export default function AgreementDialog({ className }: AgreementDialogProps) {
  const { template } = useLoaderData<typeof loader>();
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
            <h1 className="mb-1 text-lg font-semibold">{template.name}</h1>
            <p className="text-gray-600">
              {template.description ?? "No description provided"}
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
