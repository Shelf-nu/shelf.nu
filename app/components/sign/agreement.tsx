import { useRef, useState } from "react";
import { Form, useNavigation } from "@remix-run/react";
import SignatureCanvas from "react-signature-canvas";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { isFormProcessing } from "~/utils/form";
import { PenIcon } from "../icons/library";
import { Button } from "../shared/button";
import { Checkbox } from "../shared/checkbox";
import When from "../when/when";

type AgreementProps = {
  className?: string;
};

const SignValidationSchema = z.object({
  terms: z
    .string({ required_error: "Please accept the terms." })
    .transform((value) => value === "on"),
});

export default function Agreement({ className }: AgreementProps) {
  const [canvasClicked, setCanvasClicked] = useState(false);
  const signatureRef = useRef<null | SignatureCanvas>(null);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const [signatureText, setSignatureText] = useState("");
  const [signatureImage, setSignatureImage] = useState("");

  const zo = useZorm("SignAgreement", SignValidationSchema);

  return (
    <Form className={className} ref={zo.ref} method="POST">
      <div className="border-b p-4">
        <div className="flex h-fit space-x-2">
          <Checkbox id="terms1" name={zo.fields.terms()} />
          <div className="grid gap-1.5 leading-none">
            <label
              htmlFor="terms1"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              I agree to everything stated in the document
            </label>
            <p className="text-muted-foreground text-sm text-gray-600">
              I have read the document and hereby agree to the terms and
              conditions described in the document.
            </p>
          </div>
        </div>

        <When truthy={Boolean(zo.errors.terms()?.message)}>
          <p className="text-sm text-error-500">{zo.errors.terms()?.message}</p>
        </When>
      </div>

      <div
        onClick={() => setCanvasClicked(true)}
        className="flex size-full min-h-80 grow items-center justify-center border-b"
      >
        {!canvasClicked && (
          <div className="flex gap-1 text-gray-300">
            <PenIcon />
            <div>draw your signature here</div>
          </div>
        )}
        {canvasClicked && (
          <SignatureCanvas
            ref={signatureRef}
            onEnd={() => setSignatureImage(signatureRef.current!.toDataURL())}
            penColor="gray"
            canvasProps={{
              className: "sigCanvas",
              width: 400,
              height: 320,
            }}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-x-2 p-4">
        <input
          className="flex-1 border-none px-0 py-1 outline-none ring-0 focus-within:ring-0"
          placeholder="or type your name here..."
          onChange={(event) => {
            setSignatureText(event.target.value);
          }}
        />

        <input type="hidden" name="signatureImage" value={signatureImage} />
        <input type="hidden" name="signatureText" value={signatureText} />

        <Button
          disabled={(!signatureImage && !signatureText) || disabled}
          variant="primary"
        >
          Sign
        </Button>
      </div>
    </Form>
  );
}
