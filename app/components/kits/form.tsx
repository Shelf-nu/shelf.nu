import type { Kit } from "@prisma/client";
import { CubeIcon } from "@radix-ui/react-icons";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, validateFileAtom } from "~/atoms/file";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { AbsolutePositionedHeaderActions } from "../layout/header/absolute-positioned-header-actions";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

export const NewKitFormSchema = z.object({
  name: z
    .string()
    .min(2, "Name is required!")
    .transform((value) => value.trim()),
  description: z
    .string()
    .optional()
    .transform((value) => value?.trim()),
});

type KitFormProps = {
  className?: string;
  name?: Kit["name"];
  description?: Kit["description"];
  saveButtonLabel?: string;
};

export default function KitsForm({
  className,
  name,
  description,
  saveButtonLabel = "Add",
}: KitFormProps) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const fileError = useAtomValue(fileErrorAtom);
  const [, updateDynamicTitle] = useAtom(updateDynamicTitleAtom);
  const [, validateFile] = useAtom(validateFileAtom);

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
        <AbsolutePositionedHeaderActions className="hidden md:flex">
          <Button type="submit" disabled={disabled || nameErrorMessage}>
            {saveButtonLabel}
          </Button>
        </AbsolutePositionedHeaderActions>

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
            label={zo.fields.description()}
            name={zo.fields.description()}
            defaultValue={description || ""}
            hideLabel
            placeholder="Write your description here..."
            disabled={disabled}
            className="w-full"
            required={zodFieldIsRequired(NewKitFormSchema.shape.description)}
          />
        </FormRow>

        <FormRow rowLabel="Image" className="border-b-0 pb-[10px]">
          <div className="w-full">
            <div className="mb-4 flex w-full gap-x-4">
              <div className="flex size-16 items-center justify-center rounded border-[0.75px] border-gray-900/5 bg-gray-100">
                <CubeIcon className="size-8" />
              </div>

              <label
                htmlFor="kit-image"
                className="flex h-32 flex-1 cursor-pointer flex-col items-center justify-center gap-y-3 rounded border border-gray-200 text-center"
              >
                <img
                  src="/static/images/upload-icon.svg"
                  alt="Upload"
                  className="size-10"
                />
                <p className="text-xs text-gray-600">
                  <span className="text-sm font-semibold text-primary-700">
                    Click to upload
                  </span>{" "}
                  or drag and drop <br />
                  SVG, PNG, JPG or GIF (max. 800x400px)
                </p>
              </label>
            </div>
            {!!fileError && (
              <div className="text-sm text-error-500">{fileError}</div>
            )}

            <input
              id="kit-image"
              className="sr-only"
              disabled={disabled}
              accept="image/png,.png,image/jpeg,.jpg,.jpeg"
              name="image"
              type="file"
              onChange={validateFile}
            />
          </div>
        </FormRow>
      </Form>
    </Card>
  );
}
