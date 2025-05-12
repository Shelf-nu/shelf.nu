import type { Asset, Qr } from "@prisma/client";
import {
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useParams,
} from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import type { Tag } from "react-tag-autocomplete";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, assetImageValidateFileAtom } from "~/atoms/file";
import type { loader } from "~/routes/_layout+/assets.$assetId_.edit";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import type { CustomFieldZodSchema } from "~/utils/custom-fields";
import { mergedSchema } from "~/utils/custom-fields";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";

import { zodFieldIsRequired } from "~/utils/zod";
import { AssetImage } from "./asset-image";
import AssetCustomFields from "./custom-fields-inputs";
import { Form } from "../custom-form";
import DynamicSelect from "../dynamic-select/dynamic-select";
import FormRow from "../forms/form-row";
import { InnerLabel } from "../forms/inner-label";
import Input from "../forms/input";
import { AbsolutePositionedHeaderActions } from "../layout/header/absolute-positioned-header-actions";
import { Button } from "../shared/button";
import { ButtonGroup } from "../shared/button-group";
import { Card } from "../shared/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";
import { Image } from "../shared/image";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
import { TagsAutocomplete } from "../tag/tags-autocomplete";

export const NewAssetFormSchema = z.object({
  title: z
    .string()
    .min(2, "Name is required")
    .transform((val) => val.trim()), // We trim to avoid white spaces at start and end

  description: z.string().transform((val) => val.trim()),
  category: z.string(),
  newLocationId: z.string().optional(),
  /** This holds the value of the current location. We need it for comparison reasons on the server.
   * We send it as part of the form data and compare it with the current location of the asset and prevent querying the database if it's the same.
   */
  currentLocationId: z.string().optional(),
  qrId: z.string().optional(),
  tags: z.string().optional(),
  valuation: z
    .string()
    .optional()
    .transform((val) => (val ? +val : null)),
  addAnother: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

/** Pass props of the values to be used as default for the form fields */

type Props = Partial<
  Pick<
    Asset,
    | "id"
    | "title"
    | "thumbnailImage"
    | "mainImage"
    | "mainImageExpiration"
    | "categoryId"
    | "locationId"
    | "description"
    | "valuation"
  >
> & {
  qrId?: Qr["id"] | null;
  tags?: Tag[];
};

export const AssetForm = ({
  id,
  title,
  thumbnailImage,
  mainImage,
  mainImageExpiration,
  categoryId,
  locationId,
  description,
  valuation,
  qrId,
  tags,
}: Props) => {
  const navigation = useNavigation();

  const customFields = useLoaderData<typeof loader>().customFields.map(
    (cf) =>
      cf.active && {
        id: cf.id,
        name: cf.name,
        helpText: cf?.helpText || "",
        required: cf.required,
        type: cf.type.toLowerCase() as "text" | "number" | "date" | "boolean",
        options: cf.options,
      }
  ) as CustomFieldZodSchema[];

  const FormSchema = mergedSchema({
    baseSchema: NewAssetFormSchema,
    customFields,
  });

  const zo = useZorm("NewQuestionWizardScreen", FormSchema);
  const disabled = isFormProcessing(navigation.state);

  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(assetImageValidateFileAtom);
  const [, updateDynamicTitle] = useAtom(updateDynamicTitleAtom);

  const { currency } = useLoaderData<typeof loader>();
  const actionData = useActionData<{
    errors?: {
      title?: {
        message: string;
      };
    };
  }>();

  /** Get the tags from the loader */
  const tagsSuggestions = useLoaderData<typeof loader>().tags.map((tag) => ({
    label: tag.name,
    value: tag.id,
  }));

  return (
    <Card className="w-full lg:w-min">
      <Form
        ref={zo.ref}
        method="post"
        className="flex w-full flex-col gap-2"
        encType="multipart/form-data"
      >
        <AbsolutePositionedHeaderActions className="hidden md:flex">
          <Actions disabled={disabled} />
        </AbsolutePositionedHeaderActions>
        {qrId ? (
          <input type="hidden" name={zo.fields.qrId()} value={qrId} />
        ) : null}

        <div className="flex items-start justify-between border-b pb-5">
          <div className=" ">
            <h2 className="mb-1 text-[18px] font-semibold">Basic fields</h2>
            <p>Basic information about your asset.</p>
          </div>
          <div className="hidden flex-1 justify-end gap-2 md:flex">
            <Actions disabled={disabled} />
          </div>
        </div>

        <FormRow
          rowLabel={"Name"}
          className="border-b-0 pb-[10px]"
          required={true}
        >
          <Input
            label="Name"
            hideLabel
            name={zo.fields.title()}
            disabled={disabled}
            error={
              actionData?.errors?.title?.message || zo.errors.title()?.message
            }
            autoFocus
            onChange={updateDynamicTitle}
            className="w-full"
            defaultValue={title || ""}
            required={true}
          />
        </FormRow>

        <FormRow rowLabel={"Main image"} className="pt-[10px]">
          <div className="flex items-center gap-2">
            {id && thumbnailImage && mainImageExpiration ? (
              <AssetImage
                className="size-16"
                asset={{
                  id,
                  thumbnailImage: thumbnailImage,
                  mainImage: mainImage,
                  mainImageExpiration: new Date(mainImageExpiration),
                }}
                alt={`${title} main image`}
              />
            ) : null}
            <div>
              <p className="hidden lg:block">
                <HoverCard openDelay={50} closeDelay={50}>
                  <HoverCardTrigger className={tw("inline-flex w-full  ")}>
                    Accepts PNG, JPG or JPEG (max.8 MB)
                  </HoverCardTrigger>
                  <HoverCardContent side="left">
                    Images will be automatically resized on upload. Width will
                    be set at 1200px and height will be adjusted accordingly to
                    keep the aspect ratio.
                  </HoverCardContent>
                </HoverCard>
              </p>
              <Input
                disabled={disabled}
                accept={ACCEPT_SUPPORTED_IMAGES}
                name="mainImage"
                type="file"
                onChange={validateFile}
                label={"Main image"}
                hideLabel
                error={fileError}
                className="mt-2"
                inputClassName="border-0 shadow-none p-0 rounded-none"
              />
              <p className="mt-2 lg:hidden">
                Accepts PNG, JPG or JPEG (max.8 MB)
              </p>
            </div>
          </div>
        </FormRow>

        <div>
          <FormRow
            rowLabel={"Description"}
            subHeading={
              <p>
                This is the initial object description. It will be shown on the
                asset’s overview page. You can always change it. Maximum 1000
                characters.
              </p>
            }
            className="border-b-0"
            required={zodFieldIsRequired(FormSchema.shape.description)}
          >
            <Input
              inputType="textarea"
              maxLength={1000}
              label={"Description"}
              name={zo.fields.description()}
              defaultValue={description || ""}
              hideLabel
              placeholder="Add a description for your asset."
              disabled={disabled}
              data-test-id="assetDescription"
              className="w-full"
              required={zodFieldIsRequired(FormSchema.shape.description)}
            />
          </FormRow>
        </div>

        <FormRow
          rowLabel="Category"
          subHeading={
            <p>
              Make it unique. Each asset can have 1 category. It will show on
              your index.
            </p>
          }
          className="border-b-0 pb-[10px]"
          required={zodFieldIsRequired(FormSchema.shape.category)}
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
            selectionMode="set"
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
          rowLabel="Tags"
          subHeading={
            <p>
              Tags can help you organise your database. They can be combined.{" "}
              <Link to="/tags/new" className="text-gray-600 underline">
                Create tags
              </Link>
            </p>
          }
          className="border-b-0 py-[10px]"
          required={zodFieldIsRequired(FormSchema.shape.tags)}
        >
          <InnerLabel hideLg={true}>Tags</InnerLabel>
          <TagsAutocomplete
            existingTags={tags ?? []}
            suggestions={tagsSuggestions}
          />
        </FormRow>

        <FormRow
          rowLabel="Location"
          subHeading={
            <p>
              A location is a place where an item is supposed to be located.
              This is different than the last scanned location{" "}
              <Link to="/locations/new" className="text-gray-600 underline">
                Create locations
              </Link>
            </p>
          }
          className="border-b-0 py-[10px]"
          required={zodFieldIsRequired(FormSchema.shape.newLocationId)}
        >
          <input
            type="hidden"
            name="currentLocationId"
            value={locationId || ""}
          />
          <DynamicSelect
            disabled={disabled}
            selectionMode="set"
            fieldName="newLocationId"
            triggerWrapperClassName="flex flex-col !gap-0 justify-start items-start [&_.inner-label]:w-full [&_.inner-label]:text-left "
            defaultValue={locationId || undefined}
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
                <Image
                  imageId={metadata.imageId}
                  alt="img"
                  className={tw(
                    "size-6 rounded-[2px] object-cover",
                    metadata.description ? "rounded-b-none border-b-0" : ""
                  )}
                />
                <div>{name}</div>
              </div>
            )}
          />
        </FormRow>

        <FormRow
          rowLabel={"Value"}
          subHeading={
            <p>
              Specify the value of assets to get an idea of the total value of
              your inventory.
            </p>
          }
          className="border-b-0 py-[10px]"
          required={zodFieldIsRequired(FormSchema.shape.valuation)}
        >
          <div className="relative w-full">
            <Input
              type="number"
              label="Value"
              inputClassName="pl-[70px] valuation-input"
              hideLabel
              name={zo.fields.valuation()}
              disabled={disabled}
              error={zo.errors.valuation()?.message}
              step="any"
              min={0}
              className="w-full"
              defaultValue={valuation || ""}
              required={zodFieldIsRequired(FormSchema.shape.valuation)}
            />
            <span className="absolute bottom-0 border-r px-3 py-2.5 text-[16px] text-gray-600 lg:bottom-[11px]">
              {currency}
            </span>
          </div>
        </FormRow>

        <AssetCustomFields zo={zo} schema={FormSchema} currency={currency} />

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
};

const Actions = ({ disabled }: { disabled: boolean }) => {
  const { assetId } = useParams<{ assetId?: string }>();

  return (
    <>
      <ButtonGroup>
        <Button
          to={assetId ? `/assets/${assetId}/overview` : ".."}
          variant="secondary"
          disabled={disabled}
        >
          Cancel
        </Button>
        <AddAnother disabled={disabled} />
      </ButtonGroup>

      <Button type="submit" disabled={disabled}>
        Save
      </Button>
    </>
  );
};

const AddAnother = ({ disabled }: { disabled: boolean }) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="submit"
          variant="secondary"
          disabled={disabled}
          name="addAnother"
          value="true"
        >
          Add another
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-sm">Save the asset and add a new one</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
