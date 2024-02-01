import { useRef, useState } from "react";
import { Form, useNavigation } from "@remix-run/react";
import SignatureCanvas from "react-signature-canvas";
import { isFormProcessing } from "~/utils";
import Input from "../forms/input";
import { PenIcon } from "../icons";
import { Button } from "../shared";
import { Checkbox } from "../shared/checkbox";

export default function Agreement() {
  const [canvasClicked, setCanvasClicked] = useState(false);
  const signatureRef = useRef<null | SignatureCanvas>(null);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const [signatureText, setSignatureText] = useState("");
  const [signatureImage, setSignatureImage] = useState("");

  return (
    <>
      <div className={`flex gap-x-2 border-b-[1px] border-b-gray-200 p-4`}>
        <div className="flex h-fit space-x-2">
          <Checkbox id="terms1" />
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
      </div>
      <div
        onClick={() => setCanvasClicked(true)}
        className={`flex h-full min-h-[400px] w-[400px] grow items-center justify-center border-b-[1px] border-b-gray-200 p-4`}
      >
        {!canvasClicked && (
          <div className="flex text-gray-300">
            <PenIcon />
            <div>draw your signature here</div>
          </div>
        )}
        {canvasClicked && (
          <SignatureCanvas
            onEnd={() => setSignatureImage(signatureRef.current!.toDataURL())}
            ref={signatureRef}
            penColor="gray"
            canvasProps={{
              className: "sigCanvas",
              width: 400,
              height: 400,
            }}
          />
        )}
      </div>
      <div
        className={`flex items-center justify-between gap-x-2 border-b-[1px] border-b-gray-200 p-4`}
      >
        <Input
          // disabled={disabled}
          onChange={(e) => setSignatureText(e.target.value)}
          className="border-0"
          label={""}
          placeholder="or type your name here..."
        />
        <Form method="post">
          <input type="hidden" name="signatureImage" value={signatureImage} />
          <input type="hidden" name="signatureText" value={signatureText} />
          <Button
            type={"submit"}
            disabled={(!signatureImage && !signatureText) || disabled}
            variant="primary"
          >
            Sign
          </Button>
        </Form>
      </div>
    </>
  );
}
