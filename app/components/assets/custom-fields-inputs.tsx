import type { ReactElement } from "react";
import { useState } from "react";
import type { CustomField, CustomFieldType } from "@prisma/client";
import { CalendarIcon } from "@radix-ui/react-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@radix-ui/react-popover";
import { Link, useLoaderData, useNavigation } from "@remix-run/react";
import { format } from "date-fns"
import type { Zorm } from "react-zorm";
import type { z } from "zod";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import type { loader } from "~/routes/_layout+/assets.$assetId_.edit";
import { isFormProcessing, tw } from "~/utils";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { zodFieldIsRequired } from "~/utils/zod";
import { Select, SelectContent, SelectTrigger, SelectValue, SelectItem } from "../forms";
import { Calendar } from "../forms/calender-input";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Switch } from "../forms/switch";
import { SearchIcon } from "../icons";
import { Button } from "../shared";

export default function AssetCustomFields({
  zo,
  schema,
}: {
  zo: Zorm<z.ZodObject<any, any, any>>;
  schema: z.ZodObject<any, any, any>;
}) {
  /** Get the custom fields from the loader */
  const { customFields } = useLoaderData();
  const { asset } =
    useLoaderData<typeof loader>() || {}

  const customFieldsValues = asset?.customFields as unknown as ShelfAssetCustomFieldValueType[] || []

  const [dateObj, setDateObj] = useState(customFieldsValues.filter(v => v.value.valueDate).reduce((res, cur) => {
    res[cur.customFieldId] = new Date(cur.value.valueDate!)
    return res
  }, {} as Record<string, Date>))

  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const getCustomFieldVal = (id: string) => {
    const value = customFieldsValues?.find(
      (cfv) => cfv.customFieldId === id
    )?.value
    return value ? getCustomFieldDisplayValue(value) : ""
  }


  const fieldTypeToCompMap: { [key in CustomFieldType]?: (field: CustomField) => ReactElement } = {
    "BOOLEAN": (field) => <div className="flex items-center gap-3">
      <Switch
        name={`cf-${field.id}`}
        disabled={disabled}
        defaultChecked={
          getCustomFieldVal(field.id) === "true" || field.required}
      />
    </div>,
    "DATE": (field) => <>
      <input name={`cf-${field.id}`} value={dateObj[field.id]?.toISOString() || ""} hidden />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            error={zo.errors[`cf-${field.id}`]()?.message}
            variant="secondary"
            className={tw(
              "w-full min-w-[300px] pl-1 text-left font-normal",
              !dateObj[field.id] && "text-muted-foreground"
            )}
          >
            <div className="flex justify-between">
              {dateObj[field.id] ? (
                <span>{format(new Date(dateObj[field.id]), "PPP")}</span>
              ) : (
                <span>Pick a date</span>
              )}
              <CalendarIcon className="ml-3 h-5 w-5" />

            </div>

          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" className="z-100 w-auto p-0" align="end">
          <Calendar
            name={`cf-${field.id}`}
            mode="single"
            selected={dateObj[field.id]}
            onSelect={(d: Date) => setDateObj({ ...dateObj, [field.id]: d })}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </>,
    "OPTION": (field) => {
      const val = getCustomFieldVal(field.id)
      return <Select
        name={`cf-${field.id}`}
        defaultValue={val ? val : field.required ? field.options[0] : ""}
        disabled={disabled}
      >
        <SelectTrigger
          className="px-3.5 py-3"
          placeholder={`Choose ${field.name}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-full min-w-[300px]"
          align="start"
        >
          <div className=" max-h-[320px] overflow-auto">
            {field.options.map((value) => (
              <SelectItem value={value} key={value}>
                <span className="mr-4 text-[14px] text-gray-700">
                  {value.toLowerCase()}
                </span>
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
    }
  }

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
        customFields.map((field: CustomField) => {
          const value = customFieldsValues?.find(
            (cfv) => cfv.customFieldId === field.id
          )?.value
          const displayVal = value ? getCustomFieldDisplayValue(value) : ""
          return (
            <FormRow
              key={field.id}
              rowLabel={field.name}
              subHeading={field.helpText ? <p>{field.helpText}</p> : undefined}
              className="border-b-0"
              required={field.required}
            >
              {typeof fieldTypeToCompMap[field.type] === "function" ? fieldTypeToCompMap[field.type]!(field) : <Input
                hideLabel
                placeholder={field.helpText || undefined}
                inputType={field.type === "MULTILINE_TEXT" ? "textarea" : "input"}
                type={field.type.toLowerCase()}
                label={field.name}
                name={`cf-${field.id}`}
                error={zo.errors[`cf-${field.id}`]()?.message}
                disabled={disabled}
                defaultValue={displayVal}
                className="w-full"
                required={zodFieldIsRequired(schema.shape[`cf-${field.id}`])}
              />}
            </FormRow>
          )
        })
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
  );
}
