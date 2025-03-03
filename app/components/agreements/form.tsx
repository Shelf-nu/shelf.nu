import type { ChangeEvent } from "react";
import { useCallback, useState } from "react";
import type { CustodyAgreement, CustodyAgreementFile } from "@prisma/client";
import { Form, useNavigation } from "@remix-run/react";
import { useAtom } from "jotai";
import { FileTypeIcon } from "lucide-react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { validateFileAtom } from "~/atoms/file";
import { isFormProcessing } from "~/utils/form";
import { formatBytes } from "~/utils/format-bytes";
import { tw } from "~/utils/tw";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Switch } from "../forms/switch";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

const MAX_FILE_SIZE = 5_000_000;

export const base = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string().optional(),
  signatureRequired: z
    .string()
    .optional()
    .transform((val) => (val === "on" ? true : false)),
});

export const NewAgreementFormSchema = z.discriminatedUnion("isEdit", [
  base.extend({
    isEdit: z.literal("false"),
    pdf: z
      .custom<File>()
      .refine(
        (val) => val.type !== "application/octet-stream",
        "A file is required"
      )
      .refine((val) => val.size <= MAX_FILE_SIZE, "File size is too big")
      .refine((val) => val.type === "application/pdf", "Only .pdf is accepted"),
  }),
  base.extend({
    isEdit: z.literal("true"),
    pdf: z
      .custom<File>()
      .refine(
        (val) =>
          val.type !== "application/octet-stream" || val.size <= MAX_FILE_SIZE,
        "File size is too big"
      )
      .refine(
        (val) =>
          val.type === "application/octet-stream" ||
          val.type === "application/pdf",
        "Only .pdf is accepted"
      ),
  }),
]);

interface Props {
  name?: CustodyAgreement["name"];
  description?: CustodyAgreement["description"];
  type?: CustodyAgreement["type"];
  signatureRequired?: CustodyAgreement["signatureRequired"];
  pdfUrl?: CustodyAgreementFile["url"];
  pdfSize?: CustodyAgreementFile["size"];
  pdfName?: CustodyAgreementFile["name"];
  version?: CustodyAgreementFile["revision"];
  isEdit?: boolean;
  className?: string;
}

export const AgreementForm = ({
  name = "",
  description = "",
  signatureRequired = false,
  pdfSize,
  pdfUrl,
  pdfName,
  version,
  isEdit = false,
  className,
}: Props) => {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewAgreementFormSchema);
  const disabled = isFormProcessing(navigation.state);
  const [, validateFile] = useAtom(validateFileAtom);

  const [, updateTitle] = useAtom(updateDynamicTitleAtom);
  const [pdf, setPdf] = useState<File | null>(null);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const file = files[0];

      // We don't want to update the state if the file is
      // more than 5 MB
      if (file.size > MAX_FILE_SIZE) return;

      setPdf(files[0]);
      validateFile(e);
    },
    [validateFile]
  );

  return (
    <Form
      ref={zo.ref}
      method="post"
      className={tw("flex w-full flex-col gap-2", className)}
      encType="multipart/form-data"
    >
      <FormRow rowLabel="Name" className="border-b-0 pb-0" required={true}>
        <Input
          label="Name"
          hideLabel
          name={"name"}
          disabled={disabled}
          error={zo.errors.name()?.message}
          autoFocus
          onChange={updateTitle}
          className="w-full"
          defaultValue={name || ""}
          placeholder="Booking Arrangement 2023"
          required={true}
        />
      </FormRow>

      <FormRow
        required={false}
        rowLabel="Ask for signature"
        subHeading={<p>Users will be asked to sign document</p>}
        className="border-b-0 pb-0"
      >
        <Switch
          name="signatureRequired"
          required={false}
          disabled={disabled}
          defaultChecked={signatureRequired}
        />
      </FormRow>
      <FormRow
        className="border-0 pb-0"
        rowLabel="Description"
        required={false}
      >
        <Input
          label="Description"
          hideLabel
          inputType="textarea"
          name={"description"}
          disabled={disabled}
          error={zo.errors.description()?.message}
          className="w-full border-b-0 pb-0"
          defaultValue={description || ""}
          placeholder="Store the booking arrangement for 2023"
          required={false}
        />
      </FormRow>
      <FormRow required={!isEdit} rowLabel="Upload PDF">
        <div>
          <p className="hidden lg:block">Accepts PDF (max. 5 MB)</p>
          <Input
            required={!isEdit}
            disabled={disabled}
            accept="application/pdf,.pdf"
            name={"pdf"}
            type="file"
            onChange={handleFileChange}
            label={""}
            hideLabel
            error={zo.errors.pdf()?.message}
            className="mt-2"
            inputClassName="border-0 shadow-none p-0 rounded-none"
          />
        </div>

        <When truthy={!!pdfUrl}>
          <Card className="flex w-full items-center gap-x-5">
            <div className="flex grow gap-x-3">
              <FileTypeIcon />

              <div className="flex flex-col">
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="grow text-sm font-semibold text-gray-600"
                >
                  {pdfName}
                </a>
                <span className="text-sm font-light text-gray-700">
                  {formatBytes(pdfSize! as number)}
                </span>
              </div>
            </div>
            <Badge
              className="min-w-36 justify-center"
              withDot={false}
              color="#0dec5d"
            >
              Current (revision: {version})
            </Badge>
          </Card>
        </When>

        <When truthy={!!pdf}>
          <Card className="flex w-full items-start justify-between gap-x-3">
            <FileTypeIcon />
            <div className={"flex w-full grow flex-col"}>
              <span className="text-sm font-semibold text-gray-600">
                {pdf?.name}
              </span>
              <span className="text-sm font-light text-gray-700">
                {formatBytes(pdf?.size as number)}
              </span>
            </div>
            <Button
              variant="text"
              icon="x"
              className="border-0 p-1 text-primary-700 hover:text-primary-800"
              onClick={() => setPdf(null)}
            />
          </Card>
        </When>
      </FormRow>
      <input name="isEdit" type="hidden" value={isEdit.toString()} />

      <div className="text-right">
        <Button type="submit" disabled={disabled}>
          {disabled ? <Spinner /> : "Save"}
        </Button>
      </div>
    </Form>
  );
};
