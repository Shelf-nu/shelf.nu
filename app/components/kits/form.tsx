import type { Kit } from "@prisma/client";
import { useActionData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, defaultValidateFileAtom } from "~/atoms/file";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import { Form } from "../custom-form";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { AbsolutePositionedHeaderActions } from "../layout/header/absolute-positioned-header-actions";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

export const NewKitFormSchema = z.object({
  name: z
    .string()
    .min(2, "Name is required")
    .transform((value) => value.trim()),
  description: z
    .string()
    .optional()
    .transform((value) => value?.trim()),
  qrId: z.string().optional(),
});

type KitFormProps = {
  className?: string;
  name?: Kit["name"];
  description?: Kit["description"];
  saveButtonLabel?: string;
  qrId?: string | null;
};

export default function KitsForm({
  className,
  name,
  description,
  saveButtonLabel = "Add",
  qrId,
}: KitFormProps) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const fileError = useAtomValue(fileErrorAtom);
  const [, updateDynamicTitle] = useAtom(updateDynamicTitleAtom);
  const [, validateFile] = useAtom(defaultValidateFileAtom);

  const zo = useZorm("NewKitForm", NewKitFormSchema);

  const actionData = useActionData<{
    errors?: { name?: { message: string } };
  }>();

  const nameErrorMessage =
    actionData?.errors?.name?.message ?? zo.errors.name()?.message;

  return (
    <Card className={tw("w-full md:w-min", className)}>
      <Form
        ref={zo.ref}
        method="post"
        className="flex w-full flex-col gap-2"
        encType="multipart/form-data"
      >
        <AbsolutePositionedHeaderActions className="hidden md:mr-4 md:flex">
          <Button type="submit" disabled={disabled || nameErrorMessage}>
            {saveButtonLabel}
          </Button>
        </AbsolutePositionedHeaderActions>
        {qrId ? (
          <input type="hidden" name={zo.fields.qrId()} value={qrId} />
        ) : null}

        <FormRow rowLabel="Name" className="border-b-0 pb-[10px]" required>
          <Input
            label="Name"
            hideLabel
            name={zo.fields.name()}
            disabled={disabled}
            error={nameErrorMessage}
            autoFocus
            onChange={updateDynamicTitle}
            className="w-full"
            defaultValue={name || ""}
            required
          />
        </FormRow>

        <FormRow
          rowLabel="Description"
          subHeading={
            <p>
              Briefly describe what is included and/or what is will be used for.
              It will be shown on the kit’s overview page.
            </p>
          }
          className="border-b-0"
          required={zodFieldIsRequired(NewKitFormSchema.shape.description)}
        >
          <Input
            inputType="textarea"
            maxLength={1000}
            label={"Description"}
            name={zo.fields.description()}
            defaultValue={description || ""}
            hideLabel
            placeholder="Write your description here..."
            disabled={disabled}
            className="w-full"
            required={zodFieldIsRequired(NewKitFormSchema.shape.description)}
          />
        </FormRow>

        <FormRow rowLabel="Image" className="border-b-0 pt-[10px]">
          <div>
            <p className="hidden lg:block">
              Accepts PNG, JPG or JPEG (max.4 MB)
            </p>
            <Input
              disabled={disabled}
              accept={ACCEPT_SUPPORTED_IMAGES}
              name="image"
              type="file"
              onChange={validateFile}
              label="Image"
              hideLabel
              error={fileError}
              className="mt-2"
              inputClassName="border-0 shadow-none p-0 rounded-none"
            />
            <p className="mt-2 lg:hidden">
              Accepts PNG, JPG or JPEG (max.4 MB)
            </p>
          </div>
        </FormRow>

        <FormRow className="border-y-0 pb-0 pt-5" rowLabel="">
          <div className="ml-auto">
            <Button type="submit" disabled={disabled}>
              Save
            </Button>
          </div>
        </FormRow>
      </Form>
    </Card>
  );
}
