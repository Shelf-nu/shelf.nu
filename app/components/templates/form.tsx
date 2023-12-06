import type { ChangeEvent } from "react";
import { useCallback, useState } from "react";
import type { Template } from "@prisma/client";
import { TemplateType } from "@prisma/client";
import { Form, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, validateFileAtom } from "~/atoms/file";
import { Badge, Button } from "~/components/shared";
import { formatBytes, isFormProcessing } from "~/utils";
import { zodFieldIsRequired } from "~/utils/zod";
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
import { Card } from "../shared/card";
import iconsMap from "../shared/icons-map";
import { Spinner } from "../shared/spinner";

const MAX_FILE_SIZE = 5_000_000;

export const NewTemplateFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  type: z.nativeEnum(TemplateType),
  description: z.string().optional(),
  signatureRequired: z
    .string()
    .optional()
    .transform((val) => (val === "on" ? true : false)),
  pdf: z.any(),
});

interface Props {
  name?: Template["name"];
  description?: Template["description"];
  type?: Template["type"];
  signatureRequired?: Template["signatureRequired"];
  pdfUrl?: Template["pdfUrl"];
  pdfSize?: Template["pdfSize"];
  pdfName?: Template["pdfName"];
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
  isEdit = false,
}: Props) => {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewTemplateFormSchema);
  const disabled = isFormProcessing(navigation.state);
  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(validateFileAtom);

  const [, updateTitle] = useAtom(updateDynamicTitleAtom);
  const [selectedType, setSelectedType] = useState<TemplateType>(
    type || TemplateType.BOOKINGS
  );
  const [pdf, setPdf] = useState<File | null>(null);
  const [size, setSize] = useState<number>(pdfSize || 0);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const file = files[0];

      // We don't want to update the state if the file is
      // more than 5 MB
      if (file.size > MAX_FILE_SIZE) return;

      setPdf(files[0]);
      setSize(files[0].size);
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
      <FormRow
        rowLabel="Name"
        className="border-b-0 pb-0"
        required={zodFieldIsRequired(NewTemplateFormSchema.shape.name)}
      >
        <Input
          label="Name"
          hideLabel
          name={zo.fields.name()}
          disabled={disabled}
          error={zo.errors.name()?.message}
          autoFocus
          onChange={updateTitle}
          className="w-full"
          defaultValue={name || ""}
          placeholder="Booking Arrangement 2023"
          required={zodFieldIsRequired(NewTemplateFormSchema.shape.name)}
        />
      </FormRow>
      <FormRow
        rowLabel="Type"
        className="border-b-0 pb-0"
        required={zodFieldIsRequired(NewTemplateFormSchema.shape.type)}
      >
        <Select
          name={zo.fields.type()}
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
          <SelectTrigger
            disabled={isEdit}
            className="px-3.5 py-3"
            placeholder="Choose a field type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            position="popper"
            className="w-full min-w-[300px]"
            align="start"
          >
            <div className=" max-h-[320px] overflow-auto">
              {[TemplateType.BOOKINGS, TemplateType.CUSTODY].map((value) => (
                <SelectItem value={value} key={value}>
                  <span className="mr-4 text-[14px] text-gray-700">
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
          name={zo.fields.description()}
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
            size={MAX_FILE_SIZE}
            onChange={handleFileChange}
            label={""}
            hideLabel
            error={fileError}
            className="mt-2"
            inputClassName="border-0 shadow-none p-0 rounded-none"
          />
        </div>
        {pdfUrl && (
          <Card className="flex w-full items-center gap-x-5">
            <div className={"flex grow gap-x-3"}>
              {iconsMap["pdf"]}
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
                Current
              </Badge>
            </div>
          </Card>
        )}
        {pdf && (
          <Card className="flex w-full items-start justify-between gap-x-3">
            {iconsMap["pdf"]}
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
              onClick={() => {
                setPdf(null);
                setSize(0);
              }}
            />
          </Card>
        )}
      </FormRow>
      <input type="hidden" name={"pdfSize"} value={size} />
      <div className="text-right">
        <Button type="submit" disabled={disabled}>
          {disabled ? <Spinner /> : "Save"}
        </Button>
      </div>
    </Form>
  );
};
