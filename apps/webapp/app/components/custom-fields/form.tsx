import { useState } from "react";
import { CustomFieldType, type CustomField } from "@prisma/client";
import { useAtom } from "jotai";
import { Link, useActionData, useNavigation } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { useOrganizationId } from "~/hooks/use-organization-id";
import type { action as editCustomFieldsAction } from "~/routes/_layout+/settings.custom-fields.$fieldId_.edit";
import type { action as newCustomFieldsAction } from "~/routes/_layout+/settings.custom-fields.new";
import { FIELD_TYPE_NAME } from "~/utils/custom-fields";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import { zodFieldIsRequired } from "~/utils/zod";
import { Form } from "../custom-form";
import CategoriesInput from "../forms/categories-input";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import OptionBuilder from "../forms/option-builder";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Switch } from "../forms/switch";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";

export const NewCustomFieldFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  helpText: z
    .string()
    .optional()
    .transform((val) => val || null), // Transforming undefined to fit prismas null constraint
  type: z.nativeEnum(CustomFieldType),
  required: z
    .string()
    .optional()
    .transform((val) => (val === "on" ? true : false)),
  active: z
    .string()
    .optional()
    .transform((val) => (val === "on" ? true : false)),
  organizationId: z.string(),
  options: z.array(z.string()).optional(),
  categories: z
    .array(z.string().min(1, "Please select a category"))
    .optional()
    .default([]),
});

/** Pass props of the values to be used as default for the form fields */
interface Props {
  name?: CustomField["name"];
  helpText?: CustomField["helpText"];
  required?: CustomField["required"];
  type?: CustomField["type"];
  active?: CustomField["active"];
  options?: CustomField["options"];
  isEdit?: boolean;
  categories?: string[];
}

const FIELD_TYPE_DESCRIPTION: { [key in CustomFieldType]: string } = {
  TEXT: "A place to store short information for your asset. For instance: Serial numbers, notes or anything you wish. No input validation. Any text is acceptable.",
  OPTION: "A dropdown list of predefined options.",
  BOOLEAN: "A true/false or yes/no value.",
  DATE: "A date picker for selecting a date.",
  MULTILINE_TEXT:
    "A place to store longer, multiline information for your asset. For instance: Descriptions, comments, or detailed notes.",
  AMOUNT:
    "Enter numerical values to be formatted in your workspace's currency. Supports decimals.",
  NUMBER: "Enter numerical values. Supports decimals.",
};

export const CustomFieldForm = ({
  options: opts,
  name,
  helpText,
  required,
  type,
  active,
  isEdit = false,
  categories = [],
}: Props) => {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewCustomFieldFormSchema);
  const disabled = isFormProcessing(navigation.state);

  const [options, setOptions] = useState<Array<string>>(opts || []);
  const [selectedType, setSelectedType] = useState<CustomFieldType>(
    type || "TEXT"
  );
  const [useCategories, setUseCategories] = useState(categories.length > 0);

  const [, updateTitle] = useAtom(updateDynamicTitleAtom);

  // keeping text field type by default selected
  const organizationId = useOrganizationId();
  const actionData = useActionData<
    typeof newCustomFieldsAction | typeof editCustomFieldsAction
  >();
  const validationErrors = getValidationErrors<typeof NewCustomFieldFormSchema>(
    actionData?.error
  );

  return (
    <Card className="w-full md:w-min">
      <Form
        ref={zo.ref}
        method="post"
        className="flex w-full flex-col gap-2"
        encType="multipart/form-data"
      >
        <FormRow
          rowLabel={"Name"}
          className="border-b-0 pb-[10px] pt-0"
          required={zodFieldIsRequired(NewCustomFieldFormSchema.shape.name)}
        >
          <Input
            label="Name"
            hideLabel
            name={zo.fields.name()}
            disabled={disabled}
            error={validationErrors?.name?.message || zo.errors.name()?.message}
            autoFocus
            onChange={updateTitle}
            className="w-full"
            defaultValue={name || ""}
            placeholder="Choose a field name"
            required={zodFieldIsRequired(NewCustomFieldFormSchema.shape.name)}
          />
        </FormRow>

        <div>
          <label className="lg:hidden" htmlFor="custom-field-type">
            Type
          </label>
          <FormRow
            rowLabel={"Type"}
            className="border-b-0 pb-[10px] pt-[6px]"
            required={zodFieldIsRequired(NewCustomFieldFormSchema.shape.type)}
          >
            <Select
              name="type"
              defaultValue={selectedType}
              disabled={disabled}
              onValueChange={(val: CustomFieldType) => setSelectedType(val)}
            >
              <SelectTrigger
                disabled={isEdit}
                className="px-3.5 py-3"
                id="custom-field-type"
              >
                <SelectValue placeholder="Choose a field type" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="w-full min-w-[300px]"
                align="start"
              >
                <div className=" max-h-[320px] overflow-auto">
                  {Object.keys(FIELD_TYPE_NAME).map((value) => (
                    <SelectItem value={value} key={value}>
                      <span className="mr-4 text-[14px] text-gray-700">
                        {FIELD_TYPE_NAME[value as CustomFieldType]}
                      </span>
                    </SelectItem>
                  ))}
                </div>
              </SelectContent>
            </Select>
            <div className="mt-2 flex-1 grow rounded border px-6 py-4 text-[14px] text-gray-600 ">
              <p>{FIELD_TYPE_DESCRIPTION[selectedType]}</p>
            </div>
          </FormRow>
          {selectedType === "OPTION" ? (
            <>
              <FormRow rowLabel="" className="mt-0 border-b-0 pt-0">
                <OptionBuilder
                  onRemove={(i: number) => {
                    options.splice(i, 1);
                    setOptions([...options]);
                  }}
                  options={options}
                  onAdd={(o: string) => setOptions([...options, o])}
                />
                {options.map((op, i) => (
                  <input
                    key={i}
                    type="hidden"
                    name={zo.fields.options(i)()}
                    value={op}
                  />
                ))}
              </FormRow>
            </>
          ) : null}
        </div>
        <FormRow rowLabel="" className="border-b-0 pt-2">
          <div className="flex items-center gap-3">
            <Switch
              id="custom-field-required"
              name={zo.fields.required()}
              disabled={disabled}
              defaultChecked={required}
            />
            <label
              htmlFor="custom-field-required"
              className="text-base font-medium text-gray-700"
            >
              Required
            </label>
          </div>
        </FormRow>

        <FormRow rowLabel="" className="border-b-0 pt-2">
          <div className="flex items-center gap-3">
            <Switch
              id="custom-field-active"
              name={zo.fields.active()}
              disabled={disabled}
              defaultChecked={active === undefined || active}
            />
            <label htmlFor="custom-field-active">
              <div className="text-base font-medium text-gray-700">Active</div>
              <p className="text-[14px] text-gray-600">
                Deactivating a field will no longer show it on the asset form
                and page
              </p>
            </label>
          </div>
          {validationErrors?.active ? (
            <div className="text-sm text-error-500">
              {validationErrors?.active.message}
            </div>
          ) : null}
        </FormRow>

        <div>
          <FormRow
            rowLabel="Category"
            subHeading={
              <p>
                Select asset categories for which you want to use this custom
                field.{" "}
                <Link
                  to="https://www.shelf.nu/knowledge-base/linking-custom-fields-to-categories"
                  target="_blank"
                >
                  Read more
                </Link>
              </p>
            }
          >
            <div className="mb-3 flex gap-3">
              <Switch
                id="custom-field-use-categories"
                disabled={disabled}
                checked={useCategories}
                onCheckedChange={setUseCategories}
              />
              <label htmlFor="custom-field-use-categories">
                <div className="text-base font-medium text-gray-700">
                  Use for select categories
                </div>
                <p className="text-[14px] text-gray-600">
                  In case you only want to use this custom field for asset with
                  certain categories.
                </p>
              </label>
            </div>

            {useCategories && (
              <CategoriesInput
                categories={categories}
                name={(i) => zo.fields.categories(i)()}
                error={(i) => zo.errors.categories(i)()?.message}
              />
            )}
          </FormRow>
        </div>

        <div>
          <FormRow
            rowLabel="Help Text"
            subHeading={
              <p>
                This text will function as a help text that is visible when
                filling the field
              </p>
            }
            required={zodFieldIsRequired(
              NewCustomFieldFormSchema.shape.helpText
            )}
          >
            <Input
              inputType="textarea"
              label="Help Text"
              name={zo.fields.helpText()}
              defaultValue={helpText || ""}
              placeholder="Add a help text for your custom field."
              disabled={disabled}
              data-test-id="fieldHelpText"
              className="w-full"
              hideLabel
              required={zodFieldIsRequired(
                NewCustomFieldFormSchema.shape.helpText
              )}
            />
          </FormRow>
        </div>

        {/* hidden field organization Id to get the organization Id on each form submission to link custom fields and its value is loaded using useOrganizationId hook */}
        <input
          type="hidden"
          name={zo.fields.organizationId()}
          value={organizationId}
        />

        <div className="text-right">
          <Button
            to={".."}
            variant="secondary"
            disabled={disabled}
            className={"mr-2"}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={disabled}>
            {disabled ? <Spinner /> : "Save"}
          </Button>
        </div>
      </Form>
    </Card>
  );
};
