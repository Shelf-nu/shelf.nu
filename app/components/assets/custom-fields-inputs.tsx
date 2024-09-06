import type { ReactElement } from "react";
import { useRef, useState } from "react";
import type { CustomField, CustomFieldType } from "@prisma/client";
import { Link, useLoaderData, useNavigation } from "@remix-run/react";
import type { Zorm } from "react-zorm";
import type { z } from "zod";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import type { loader } from "~/routes/_layout+/assets.$assetId_.edit";
import { useHints } from "~/utils/client-hints";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { isFormProcessing } from "~/utils/form";
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
import { SearchIcon } from "../icons/library";
import { MarkdownEditor } from "../markdown/markdown-editor";
import { Button } from "../shared/button";

export default function AssetCustomFields({
  zo,
  schema,
}: {
  zo: Zorm<z.ZodObject<any, any, any>>;
  schema: z.ZodObject<any, any, any>;
}) {
  const optionTriggerRef = useRef<HTMLButtonElement>(null);

  /** Get the custom fields from the loader */

  const { customFields, asset } = useLoaderData<typeof loader>();

  const customFieldsValues =
    (asset?.customFields as unknown as ShelfAssetCustomFieldValueType[]) || [];

  const [dateObj, setDateObj] = useState(
    customFieldsValues
      .filter((v) => v.value.valueDate)
      .reduce(
        (res, cur) => {
          res[cur.customFieldId] = new Date(cur.value.valueDate!);
          return res;
        },
        {} as Record<string, Date | null>
      )
  );

  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const hints = useHints();

  const getCustomFieldVal = (id: string) => {
    const value = customFieldsValues?.find((cfv) => cfv.customFieldId === id)
      ?.value;
    return value ? (getCustomFieldDisplayValue(value, hints) as string) : "";
  };

  const fieldTypeToCompMap: {
    [key in CustomFieldType]?: (field: CustomField) => ReactElement;
  } = {
    BOOLEAN: (field) => (
      <div className="flex items-center gap-3">
        <Switch
          name={`cf-${field.id}`}
          disabled={disabled}
          defaultChecked={
            getCustomFieldVal(field.id) === "true" || field.required
          }
        />
        <label className="font-medium text-gray-700 lg:hidden">
          <span className={field.required ? "required-input-label" : ""}>
            {field.name}
          </span>
        </label>
      </div>
    ),
    DATE: (field) => (
      <div className="flex w-full items-end">
        <Input
          className="w-full"
          label={field.name}
          hideLabel
          type="date"
          name={`cf-${field.id}`}
          value={dateObj[field.id]?.toISOString().split("T")[0] || ""}
          onChange={(e) => {
            const selectedDate = new Date(e.target.value);
            setDateObj({ ...dateObj, [field.id]: selectedDate });
          }}
          error={zo.errors[`cf-${field.id}`]()?.message}
          disabled={disabled}
        />
        {dateObj[field.id] ? (
          <Button
            className="ml-2 h-[42px] sm:h-full"
            icon="x"
            variant="secondary"
            type="button"
            onClick={() => {
              setDateObj({ ...dateObj, [field.id]: null });
            }}
          />
        ) : null}
      </div>
    ),
    OPTION: (field) => {
      const val = getCustomFieldVal(field.id);
      const options = field.options.filter((o) => o !== null && o !== "");
      return (
        <>
          <label className="mb-1.5 font-medium text-gray-700 lg:hidden">
            <span className={field.required ? "required-input-label" : ""}>
              {field.name}
            </span>
          </label>
          <Select
            name={`cf-${field.id}`}
            defaultValue={val ? val : undefined}
            disabled={disabled}
          >
            <SelectTrigger className="px-3.5 py-3" ref={optionTriggerRef}>
              <SelectValue placeholder={`Choose ${field.name}`} />
            </SelectTrigger>
            {zo.errors[`cf-${field.id}`]()?.message ? (
              <p className="text-sm text-error-500">
                {zo.errors[`cf-${field.id}`]()?.message}
              </p>
            ) : null}

            <SelectContent
              position="popper"
              className="w-full min-w-[300px] p-0"
              align="center"
              sideOffset={5}
              style={{ width: optionTriggerRef.current?.clientWidth }}
            >
              <div className="max-h-[320px] w-full overflow-auto">
                {options.length ? (
                  options.map((value, index) => (
                    <SelectItem
                      value={value}
                      key={value + index}
                      className="w-full px-6 py-4"
                    >
                      <span className="mr-4 text-[14px] text-gray-700">
                        {value.toLowerCase()}
                      </span>
                    </SelectItem>
                  ))
                ) : (
                  <div className="w-full px-6 py-4">
                    No options available.{" "}
                    <Button
                      target="_blank"
                      variant="link"
                      to={`/settings/custom-fields/${field.id}/edit`}
                    >
                      Edit custom field
                    </Button>
                  </div>
                )}
              </div>
            </SelectContent>
          </Select>
        </>
      );
    },
    MULTILINE_TEXT: (field) => {
      const value = customFieldsValues?.find(
        (cfv) => cfv.customFieldId === field.id
      )?.value?.raw;

      const error = zo.errors[`cf-${field.id}`]()?.message;

      return (
        <>
          <MarkdownEditor
            name={`cf-${field.id}`}
            label={field.name}
            defaultValue={value ? String(value) : ""}
            placeholder={field.helpText ?? field.name}
            disabled={disabled}
            maxLength={5000}
          />
          {error ? (
            <p className="mt-1 text-sm text-error-500">{error}</p>
          ) : null}
        </>
      );
    },
  };

  return (
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
      {customFields.length > 0 ? (
        customFields.map((field, index) => {
          const value = customFieldsValues?.find(
            (cfv) => cfv.customFieldId === field.id
          )?.value;
          const displayVal = value
            ? (getCustomFieldDisplayValue(value) as string)
            : "";
          return (
            <FormRow
              key={field.id + index}
              rowLabel={field.name}
              subHeading={field.helpText ? <p>{field.helpText}</p> : undefined}
              className="border-b-0"
              required={field.required}
            >
              {typeof fieldTypeToCompMap[field.type] === "function" ? (
                fieldTypeToCompMap[field.type]!(field as unknown as CustomField)
              ) : (
                <Input
                  hideLabel
                  placeholder={field.helpText || undefined}
                  type={field.type.toLowerCase()}
                  label={field.name}
                  name={`cf-${field.id}`}
                  error={zo.errors[`cf-${field.id}`]()?.message}
                  disabled={disabled}
                  defaultValue={displayVal}
                  className="w-full"
                  required={zodFieldIsRequired(schema.shape[`cf-${field.id}`])}
                />
              )}
            </FormRow>
          );
        })
      ) : (
        <div>
          <div className=" mx-auto max-w-screen-sm rounded-xl border border-gray-300 bg-white px-5 py-10 text-center">
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
  );
}
