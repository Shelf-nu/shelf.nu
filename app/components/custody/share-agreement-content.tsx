import { useState } from "react";
import type { User } from "@prisma/client";
import { Form, useNavigation } from "@remix-run/react";
import { CopyIcon, CheckIcon } from "lucide-react";
import { isFormProcessing } from "~/utils/form";
import { resolveTeamMemberName } from "~/utils/user";
import Input from "../forms/input";
import { SendRotatedIcon, ShareAssetIcon } from "../icons/library";
import { Button } from "../shared/button";
import When from "../when/when";

type ShareAgreementContentProps = {
  agreementName: string;
  custodian: {
    name: string;
    user?: Partial<Pick<User, "firstName" | "lastName" | "email">> | null;
  };
  isCustodianNrm: boolean;
  signUrl: string;
  type: "asset" | "kit";
};

export default function ShareAgreementContent({
  agreementName,
  custodian,
  isCustodianNrm,
  signUrl,
  type,
}: ShareAgreementContentProps) {
  const [isCopied, setIsCopied] = useState(false);

  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  async function handleCopy() {
    await navigator.clipboard.writeText(signUrl).then(() => {
      setIsCopied(true);

      setTimeout(() => {
        setIsCopied(false);
      }, 1000);
    });
  }

  return (
    <div className="modal-content-wrapper">
      <ShareAssetIcon className="mb-3" />

      <h4 className="mb-1">{agreementName}</h4>
      <p className="mb-5 text-gray-600">
        This PDF agreement page has been published.{" "}
        <span className="font-semibold">
          {resolveTeamMemberName(custodian)}
        </span>{" "}
        {isCustodianNrm
          ? `will be able to visit this page to read (and sign) the document. Make sure
        you send them the link. You can visit the ${type} page to open this modal in
        case you need to acquire the share link again.`
          : `will receive an email and will be able to visit this page to read (and
      sign) the document. You can visit the ${type} page to open this modal in
      case you need to acquire the share link or re-send the email.`}
      </p>
      <div className="font-semibold text-gray-600">Share link</div>

      <div className="mb-5 flex items-end gap-x-2">
        <Input
          readOnly
          className="flex-1 cursor-text"
          value={signUrl}
          disabled
          label=""
        />

        <Button onClick={handleCopy} variant="secondary" className="h-fit p-3">
          {isCopied ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
        </Button>

        <When truthy={!isCustodianNrm}>
          <Form method="post">
            <Button
              disabled={disabled}
              type="submit"
              variant="secondary"
              className="h-fit p-[9px]"
            >
              <SendRotatedIcon />
            </Button>
          </Form>
        </When>
      </div>

      <Button to=".." variant="secondary" className="h-fit w-full">
        Close
      </Button>
    </div>
  );
}
