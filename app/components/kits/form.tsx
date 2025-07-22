import { useRef } from "react";
import type { Barcode, Kit } from "@prisma/client";
import { useActionData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, defaultValidateFileAtom } from "~/atoms/file";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import { Form } from "../custom-form";
import DynamicSelect from "../dynamic-select/dynamic-select";
import BarcodesInput, { type BarcodesInputRef } from "../forms/barcodes-input";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { AbsolutePositionedHeaderActions } from "../layout/header/absolute-positioned-header-actions";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import When from "../when/when";

export const NewKitFormSchema = z.object({
  name: z
    .string()
    .min(2, "Name is required")
    .transform((value) => value.trim()),
  description: z
    .string()
    .optional()
    .transform((value) => value?.trim()),
  category: z.string().optional(),
  qrId: z.string().optional(),
});

type KitFormProps = Partial<
  Pick<Kit, "name" | "description" | "categoryId">
> & {
  className?: string;
  saveButtonLabel?: string;
  qrId?: string | null;
  barcodes?: Pick<Barcode, "id" | "value" | "type">[];
};

export default function KitsForm({
  className,
  name,
  description,
  saveButtonLabel = "Add",
  qrId,
  categoryId,
  barcodes,
}: KitFormProps) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const { canUseBarcodes } = useBarcodePermissions();
  const barcodesInputRef = useRef<BarcodesInputRef>(null);

  const fileError = useAtomValue(fileErrorAtom);
  const [, updateDynamicTitle] = useAtom(updateDynamicTitleAtom);
  const [, validateFile] = useAtom(defaultValidateFileAtom);

  const zo = useZorm("NewKitForm", NewKitFormSchema);

  const actionData = useActionData<{ error?: any }>();

  const serverValidationErrors = getValidationErrors(actionData?.error);
  const nameErrorMessage =
    serverValidationErrors?.name?.message ?? zo.errors.name()?.message;

  return (
    <Card className={tw("w-full md:w-min", className)}>
      <Form
        ref={zo.ref}
        method="post"
        className="flex w-full flex-col gap-2"
        encType="multipart/form-data"
        onSubmit={(e) => {
          // Force validation of all barcode fields to show errors
          barcodesInputRef.current?.validateAll();

          // Check for barcode validation errors
          const hasBarcodeErrors = barcodesInputRef.current?.hasErrors();

          // If there are barcode errors, prevent submission
          // Zorm will handle its own validation and prevent submission if needed
          if (hasBarcodeErrors) {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
        }}
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

        <FormRow
          rowLabel="Category"
          subHeading={
            <p>
              Make it unique. Each kit can have 1 category. It will show on your
              index.
            </p>
          }
          className="border-b-0 pb-[10px]"
          required={zodFieldIsRequired(NewKitFormSchema.shape.category)}
        >
          <DynamicSelect
            disabled={disabled}
            defaultValue={categoryId ?? undefined}
            model={{ name: "category", queryKey: "name" }}
            triggerWrapperClassName="flex flex-col !gap-0 justify-start items-start [&_.inner-label]:w-full [&_.inner-label]:text-left "
            contentLabel="Categories"
            label="Category"
            hideLabel
            initialDataKey="categories"
            countKey="totalCategories"
            closeOnSelect
            selectionMode="none"
            allowClear={true}
            extraContent={
              <Button
                to="/categories/new"
                variant="link"
                icon="plus"
                className="w-full justify-start pt-4"
                target="_blank"
              >
                Create new category
              </Button>
            }
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

        <When truthy={canUseBarcodes}>
          <FormRow
            rowLabel={"Barcodes"}
            className="border-b-0"
            subHeading="Add additional barcodes to this kit (Code 128, Code 39, or Data Matrix). Note: Each kit automatically gets a default Shelf QR code for tracking."
          >
            <BarcodesInput
              ref={barcodesInputRef}
              barcodes={barcodes || []}
              typeName={(i) => `barcodes[${i}].type`}
              valueName={(i) => `barcodes[${i}].value`}
              idName={(i) => `barcodes[${i}].id`}
              disabled={disabled}
            />
          </FormRow>
        </When>

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
