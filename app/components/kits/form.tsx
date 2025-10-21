import { useRef } from "react";
import type { Barcode, Kit } from "@prisma/client";
import { useActionData } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, defaultValidateFileAtom } from "~/atoms/file";
import { useDisabled } from "~/hooks/use-disabled";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { getValidationErrors } from "~/utils/http";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import { Form } from "../custom-form";
import DynamicSelect from "../dynamic-select/dynamic-select";
import BarcodesInput, { type BarcodesInputRef } from "../forms/barcodes-input";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { RefererRedirectInput } from "../forms/referer-redirect-input";
import ImageWithPreview from "../image-with-preview/image-with-preview";
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
  locationId: z.string().optional(),
  redirectTo: z.string().optional(),
});

type KitFormProps = Partial<
  Pick<Kit, "name" | "description" | "categoryId" | "locationId">
> & {
  className?: string;
  qrId?: string | null;
  barcodes?: Pick<Barcode, "id" | "value" | "type">[];
  referer?: string | null;
};

export default function KitsForm({
  className,
  name,
  description,
  qrId,
  categoryId,
  barcodes,
  locationId,
  referer,
}: KitFormProps) {
  const disabled = useDisabled();
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
        {qrId ? (
          <input type="hidden" name={zo.fields.qrId()} value={qrId} />
        ) : null}
        <RefererRedirectInput
          fieldName={zo.fields.redirectTo()}
          referer={referer}
        />

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
              index.{" "}
              <Button
                to="/categories/new"
                variant="link-gray"
                className="text-gray-600 underline"
                target="_blank"
              >
                Create categories
              </Button>
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

        <FormRow
          rowLabel="Location"
          subHeading={
            <p>
              A location is a place where an item is supposed to be located.
              This is different than the last scanned location{" "}
              <Button
                to="/locations/new"
                className="text-gray-600 underline"
                target="_blank"
                variant="link-gray"
              >
                Create locations
              </Button>
            </p>
          }
          className="border-b-0 py-[10px]"
          required={zodFieldIsRequired(NewKitFormSchema.shape.locationId)}
        >
          <DynamicSelect
            disabled={disabled}
            fieldName="locationId"
            triggerWrapperClassName="flex flex-col !gap-0 justify-start items-start [&_.inner-label]:w-full [&_.inner-label]:text-left "
            defaultValue={locationId ?? undefined}
            model={{ name: "location", queryKey: "name" }}
            contentLabel="Locations"
            label="Location"
            hideLabel
            initialDataKey="locations"
            countKey="totalLocations"
            closeOnSelect
            allowClear
            extraContent={
              <Button
                to="/locations/new"
                variant="link"
                icon="plus"
                className="w-full justify-start pt-4"
                target="_blank"
              >
                Create new location
              </Button>
            }
            renderItem={({ name, metadata }) => (
              <div className="flex items-center gap-2">
                {metadata?.thumbnailUrl ? (
                  <ImageWithPreview
                    thumbnailUrl={metadata.thumbnailUrl}
                    alt={metadata.name}
                    className="size-6 rounded-[2px]"
                  />
                ) : null}
                <div>{name}</div>
              </div>
            )}
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
          <div className="ml-auto flex gap-2">
            <Button to={referer} variant="secondary" disabled={disabled}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {disabled ? "Saving..." : "Save"}
            </Button>
          </div>
        </FormRow>
      </Form>
    </Card>
  );
}
