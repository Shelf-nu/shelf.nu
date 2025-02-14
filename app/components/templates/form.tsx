import type { ChangeEvent } from "react";
import { useCallback, useState } from "react";
import type { Template, TemplateFile } from "@prisma/client";
import { TemplateType } from "@prisma/client";
import { Form, useNavigation } from "@remix-run/react";
import { useAtom } from "jotai";
import { FileTypeIcon } from "lucide-react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { validateFileAtom } from "~/atoms/file";
import { isFormProcessing } from "~/utils/form";
import { formatBytes } from "~/utils/format-bytes";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Switch } from "../forms/switch";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";

const MAX_FILE_SIZE = 5_000_000;

export const base = z.object({
  name: z.string().min(2, "Name is required"),
  type: z.nativeEnum(TemplateType),
  description: z.string().optional(),
  signatureRequired: z
    .string()
    .optional()
    .transform((val) => (val === "on" ? true : false)),
});

export const NewTemplateFormSchema = z.discriminatedUnion("isEdit", [
  z
    .object({
      isEdit: z.literal("false"),
      pdf: z
        .any()
        .refine(
          (val: File) => val.type !== "application/octet-stream",
          "A file is required"
        )
        .refine(
          (val: File) => val.size <= MAX_FILE_SIZE,
          "File size is too big"
        )
        .refine(
          (val: File) => val.type === "application/pdf",
          "Only .pdf is accepted"
        ),
    })
    .merge(base),
  z
    .object({
      isEdit: z.literal("true"),
      pdf: z
        .any()
        .refine(
          (val: File) =>
            val.type !== "application/octet-stream" ||
            val.size <= MAX_FILE_SIZE,
          "File size is too big"
        )
        .refine(
          (val: File) =>
            val.type === "application/octet-stream" ||
            val.type === "application/pdf",
          "Only .pdf is accepted"
        ),
    })
    .merge(base),
]);

interface Props {
  name?: Template["name"];
  description?: Template["description"];
  type?: Template["type"];
  signatureRequired?: Template["signatureRequired"];
  pdfUrl?: TemplateFile["url"];
  pdfSize?: TemplateFile["size"];
  pdfName?: TemplateFile["name"];
  version?: TemplateFile["revision"];
  isEdit?: boolean;
}

export const TemplateForm = ({
  name = "",
  description = "",
  type = TemplateType.BOOKINGS,
  signatureRequired = false,
  pdfSize,
  pdfUrl,
  pdfName,
  version,
  isEdit = false,
}: Props) => {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewTemplateFormSchema);
  const disabled = isFormProcessing(navigation.state);
  const [, validateFile] = useAtom(validateFileAtom);

  const [, updateTitle] = useAtom(updateDynamicTitleAtom);
  const [selectedType, setSelectedType] = useState<TemplateType>(
    type || TemplateType.BOOKINGS
  );
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
      className="flex w-full flex-col gap-2"
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
      <FormRow rowLabel="Type" className="border-b-0 pb-0" required={true}>
        <Select
          name={"type"}
          defaultValue={selectedType}
          disabled={disabled}
          onValueChange={(val) =>
            setSelectedType(
              val.toString() === TemplateType.BOOKINGS
                ? TemplateType.BOOKINGS
                : TemplateType.CUSTODY
            )
          }
        >
          <SelectTrigger disabled={isEdit} className="px-3.5 py-3">
            <SelectValue placeholder="Choose a field type" />
          </SelectTrigger>
          <SelectContent
            position="popper"
            className="w-full min-w-[300px]"
            align="start"
          >
            <div className=" max-h-[320px] overflow-auto">
              {[TemplateType.BOOKINGS, TemplateType.CUSTODY].map((value) => (
                <SelectItem value={value} key={value}>
                  <span className="mr-4 block text-[14px] lowercase text-gray-700 first-letter:uppercase">
                    {value}
                  </span>
                </SelectItem>
              ))}
            </div>
          </SelectContent>
        </Select>
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
        {pdfUrl && (
          <Card className="flex w-full items-center gap-x-5">
            <div className={"flex grow gap-x-3"}>
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
            <div>
              <Badge withDot={false} color="#0dec5d">
                Current (revision: {version})
              </Badge>
            </div>
          </Card>
        )}
        {pdf && (
          <Card className="flex w-full items-start justify-between gap-x-3">
            <FileTypeIcon />
            <div className={"flex w-full grow flex-col"}>
              <span className="text-sm font-semibold text-gray-600">
                {pdf.name}
              </span>
              <span className="text-sm font-light text-gray-700">
                {formatBytes(pdf.size as number)}
              </span>
            </div>
            <Button
              variant="text"
              icon="x"
              className="border-0 p-1 text-primary-700 hover:text-primary-800"
              onClick={() => setPdf(null)}
            />
          </Card>
        )}
      </FormRow>
      <input name={"isEdit"} type="hidden" value={isEdit.toString()} />
      <div className="text-right">
        <Button type="submit" disabled={disabled}>
          {disabled ? <Spinner /> : "Save"}
        </Button>
      </div>
    </Form>
  );
};
