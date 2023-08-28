import type { Asset, Qr } from "@prisma/client";
import { Form, Link, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import type { Tag } from "react-tag-autocomplete";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateTitleAtom } from "~/atoms/assets.new";
import { fileErrorAtom, validateFileAtom } from "~/atoms/file";
import { isFormProcessing } from "~/utils";
import { CategorySelect } from "../category/category-select";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { SearchIcon } from "../icons";
import { LocationSelect } from "../location/location-select";
import { Button } from "../shared";
import { Spinner } from "../shared/spinner";
import { TagsAutocomplete } from "../tag/tags-autocomplete";

export const NewAssetFormSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string(),
  category: z.string(),
  newLocationId: z.string().optional(),
  /** This holds the value of the current location. We need it for comparison reasons on the server.
   * We send it as part of the form data and compare it with the current location of the asset and prevent querying the database if it's the same.
   */
  currentLocationId: z.string().optional(),
  qrId: z.string().optional(),
  tags: z.string().optional(),
});

/** Pass props of the values to be used as default for the form fields */
interface Props {
  title?: Asset["title"];
  category?: Asset["categoryId"];
  location?: Asset["locationId"];
  description?: Asset["description"];
  qrId?: Qr["id"] | null;
  tags?: Tag[];
}

export const AssetForm = ({
  title,
  category,
  description,
  qrId,
  tags,
}: Props) => {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewAssetFormSchema);
  const disabled = isFormProcessing(navigation.state);

  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(validateFileAtom);
  const [, updateTitle] = useAtom(updateTitleAtom);

  const fields = [
    {
      id: 1,
      name: "Field1",
      type: "text",
      helpText: "To which brand is this asset related to",
    },
    {
      id: 2,
      name: "Field2",
      type: "text",
      helpText: "To which brand is this asset related to",
    },
  ];

  return (
    <Form
      ref={zo.ref}
      method="post"
      className="flex w-full flex-col gap-2"
      encType="multipart/form-data"
    >
      {qrId ? (
        <input type="hidden" name={zo.fields.qrId()} value={qrId} />
      ) : null}
      <FormRow rowLabel={"Name"} className="border-b-0 pb-[10px]">
        <Input
          label="Name"
          hideLabel
          name={zo.fields.title()}
          disabled={disabled}
          error={zo.errors.title()?.message}
          autoFocus
          onChange={updateTitle}
          className="w-full"
          defaultValue={title || ""}
        />
      </FormRow>

      <FormRow rowLabel={"Main image"} className="pt-[10px]">
        <div>
          <p className="hidden lg:block">Accepts PNG, JPG or JPEG (max.4 MB)</p>
          <Input
            disabled={disabled}
            accept="image/png,.png,image/jpeg,.jpg,.jpeg"
            name="mainImage"
            type="file"
            onChange={validateFile}
            label={"Main image"}
            hideLabel
            error={fileError}
            className="mt-2"
            inputClassName="border-0 shadow-none p-0 rounded-none"
          />
          <p className="mt-2 lg:hidden">Accepts PNG, JPG or JPEG (max.4 MB)</p>
        </div>
      </FormRow>

      <FormRow
        rowLabel={"Category"}
        subHeading={
          <p>
            Make it unique. Each asset can have 1 category. It will show on your
            index.
          </p>
        }
        className="border-b-0 pb-[10px]"
      >
        <CategorySelect defaultValue={category || undefined} />
      </FormRow>

      <FormRow
        rowLabel={"Tags"}
        subHeading={
          <p>
            Tags can help you organise your database. They can be combined.{" "}
            <Link to="/tags/new" className="text-gray-600 underline">
              Create tags
            </Link>
          </p>
        }
        className="border-b-0 py-[10px]"
      >
        <TagsAutocomplete existingTags={tags || []} />
      </FormRow>

      <FormRow
        rowLabel={"Location"}
        subHeading={
          <p>
            A location is a place where an item is supposed to be located. This
            is different than the last scanned location{" "}
            <Link to="/locations/new" className="text-gray-600 underline">
              Create locations
            </Link>
          </p>
        }
        className="pt-[10px]"
      >
        <LocationSelect />
      </FormRow>

      <div>
        <FormRow
          rowLabel="Description"
          subHeading={
            <p>
              This is the initial object description. It will be shown on the
              asset’s overview page. You can always change it.
            </p>
          }
          className="border-b-0"
        >
          <Input
            inputType="textarea"
            label={zo.fields.description()}
            name={zo.fields.description()}
            defaultValue={description || ""}
            placeholder="Add a description for your asset."
            disabled={disabled}
            data-test-id="assetDescription"
            className="w-full"
          />
        </FormRow>
      </div>

      <div className="border-b pb-6">
        <div className="mb-6 border-b pb-5">
          <h2 className="mb-1 text-[18px] font-semibold">Custom Fields</h2>
          <Link
            to="/settings/custom-fields"
            className="font-medium text-primary-600"
          >
            Manage custom fields
          </Link>
        </div>
        {fields.length > 0 ? (
          fields.map((field) => (
            <FormRow
              key={field.id}
              rowLabel={field.name}
              subHeading={field.helpText && <p>{field.helpText}</p>}
              className="border-b-0"
            >
              <Input
                hideLabel
                type={field.type}
                label={field.name}
                name={field.name}
                className="w-full"
              />
            </FormRow>
          ))
        ) : (
          <div>
            <div className=" mx-auto max-w-[640px] rounded-xl border border-gray-300 bg-white px-5 py-10 text-center">
              <div>
                <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-gray-50 bg-gray-100 p-2 text-gray-600">
                  <SearchIcon />
                </div>
                <h4 className="mb-6 text-base">No active custom fields</h4>
                <Button to="/settings/custom-fields/new" variant="primary">
                  Create custom fields
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="pt-6 text-right">
        <Button type="submit" disabled={disabled}>
          {disabled ? <Spinner /> : "Save"}
        </Button>
      </div>
    </Form>
  );
};
