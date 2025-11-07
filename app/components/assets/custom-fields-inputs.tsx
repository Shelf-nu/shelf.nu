import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomFieldType, Currency, CustomField } from "@prisma/client";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { Search } from "lucide-react";
import type { Zorm } from "react-zorm";
import type { z } from "zod";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import type { loader } from "~/routes/_layout+/assets.$assetId_.edit";
import { useHints } from "~/utils/client-hints";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Switch } from "../forms/switch";
import { CheckIcon, SearchIcon } from "../icons/library";
import { MarkdownEditor } from "../markdown/markdown-editor";
import { Button } from "../shared/button";

export default function AssetCustomFields({
  zo,
  schema,
  currency,
}: {
  zo: Zorm<z.ZodObject<any, any, any>>;
  schema: z.ZodObject<any, any, any>;
  currency: Currency;
}) {
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
            getCustomFieldVal(field.id) === "Yes" || field.required
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
          className="w-full placeholder:text-gray-500"
          label={field.name}
          hideLabel
          type="date"
          name={`cf-${field.id}`}
          value={dateObj[field.id]?.toISOString().split("T")[0] || ""}
          onChange={(e) => {
            let selectedDate = new Date(e.target.value);

            /**
             * While typing, user can enter invalid date
             * so we have to make sure that we are saving a valid date
             * to avoid any errors
             * */
            const isDateInvalid = isNaN(selectedDate.valueOf());
            if (isDateInvalid) {
              selectedDate = new Date();
            }

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
    OPTION: (field) => (
      <>
        <label className="mb-1.5 font-medium text-gray-700 lg:hidden">
          <span className={field.required ? "required-input-label" : ""}>
            {field.name}
          </span>
        </label>

        <OptionSelect field={field} getCustomFieldVal={getCustomFieldVal} />
      </>
    ),
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
    AMOUNT: (field) => (
      <div className="relative w-full">
        <Input
          hideLabel
          type="number"
          label={field.name}
          name={`cf-${field.id}`}
          placeholder={field.helpText || undefined}
          error={zo.errors[`cf-${field.id}`]()?.message}
          defaultValue={getCustomFieldVal(field.id)}
          inputClassName="pl-[70px] valuation-input"
          disabled={disabled}
          step="any"
          min={0}
          className="w-full"
          required={zodFieldIsRequired(schema.shape[`cf-${field.id}`])}
        />
        <span className="absolute bottom-0 border-r px-3 py-2.5  text-gray-600 ">
          {currency}
        </span>
      </div>
    ),
    NUMBER: (field) => (
      <Input
        hideLabel
        type="number"
        label={field.name}
        name={`cf-${field.id}`}
        placeholder={field.helpText || undefined}
        error={zo.errors[`cf-${field.id}`]()?.message}
        defaultValue={getCustomFieldVal(field.id)}
        disabled={disabled}
        step="any"
        className="w-full"
        required={zodFieldIsRequired(schema.shape[`cf-${field.id}`])}
      />
    ),
  };

  const requiredFields = customFields.filter((field) => field.required);

  const optionalFields = customFields.filter((field) => !field.required);

  return (
    <div className="border-b pb-6">
      <div className=" border-t py-5">
        <h2 className="mb-1 text-[18px] font-semibold">Custom Fields</h2>
        <Button
          to="/settings/custom-fields"
          className="font-medium text-primary-600"
          target="_blank"
          variant="link"
        >
          Manage custom fields
        </Button>
      </div>
      {customFields.length > 0 ? (
        <>
          {requiredFields.length > 0 && (
            <div className="border-t pt-4">
              <h5>Required Fields</h5>
              {requiredFields.map((field, index) => (
                <FormRow
                  key={field.id + index}
                  rowLabel={field.name}
                  subHeading={
                    field.helpText ? <p>{field.helpText}</p> : undefined
                  }
                  className="border-b-0"
                  required={field.required}
                >
                  {fieldTypeToCompMap[field.type]?.(field) ?? (
                    <Input
                      hideLabel
                      placeholder={field.helpText || undefined}
                      type={field.type.toLowerCase()}
                      label={field.name}
                      name={`cf-${field.id}`}
                      error={zo.errors[`cf-${field.id}`]()?.message}
                      disabled={disabled}
                      defaultValue={getCustomFieldVal(field.id)}
                      className="w-full"
                      required={zodFieldIsRequired(
                        schema.shape[`cf-${field.id}`]
                      )}
                    />
                  )}
                </FormRow>
              ))}
            </div>
          )}
          {optionalFields.length > 0 && (
            <div className="border-t pt-4">
              <h5>Optional Fields</h5>
              {optionalFields.map((field, index) => (
                <FormRow
                  key={field.id + index}
                  rowLabel={field.name}
                  subHeading={
                    field.helpText ? <p>{field.helpText}</p> : undefined
                  }
                  className="border-b-0"
                  required={field.required}
                >
                  {fieldTypeToCompMap[field.type]?.(field) ?? (
                    <Input
                      hideLabel
                      placeholder={field.helpText || undefined}
                      type={field.type.toLowerCase()}
                      label={field.name}
                      name={`cf-${field.id}`}
                      error={zo.errors[`cf-${field.id}`]()?.message}
                      disabled={disabled}
                      defaultValue={getCustomFieldVal(field.id)}
                      className="w-full"
                      required={zodFieldIsRequired(
                        schema.shape[`cf-${field.id}`]
                      )}
                    />
                  )}
                </FormRow>
              ))}
            </div>
          )}
        </>
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

/** Component that renders select for CustomField OPTION fields */
function OptionSelect({
  field,
  getCustomFieldVal,
}: {
  field: CustomField;
  getCustomFieldVal: (id: string) => string;
}) {
  // State for popover, search, selection
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [value, setValue] = useState(getCustomFieldVal(field.id) || "");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Refs for elements
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter options based on search
  const filteredOptions = useMemo(() => {
    const options = field.options.filter((o) => o !== null && o !== "");
    if (!searchQuery) return options;

    return options.filter((option) =>
      option.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [field.options, searchQuery]);

  const displayValue = value || `Choose ${field.name}`;

  // Handle option selection
  function handleOptionClick(option: string) {
    if (value === option) {
      setValue("");
    } else {
      setValue(option);
    }
    setIsPopoverOpen(false);
    setSearchQuery("");
  }

  // Keyboard navigation handler
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case "Enter":
        event.preventDefault();
        if (filteredOptions[selectedIndex]) {
          handleOptionClick(filteredOptions[selectedIndex]);
        }
        break;
    }
  };

  // Ensure selected option is visible
  useEffect(() => {
    const selectedElement = document.getElementById(`option-${selectedIndex}`);
    selectedElement?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <>
      <input type="hidden" value={value} name={`cf-${field.id}`} />
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="w-full justify-start truncate whitespace-nowrap font-normal [&_span]:w-full [&_span]:max-w-full [&_span]:truncate [&_span]:text-left"
            ref={triggerRef}
          >
            <div className="flex w-full items-center justify-between">
              <span className={value === "" ? "text-gray-500" : ""}>
                {displayValue}
              </span>
              <ChevronDownIcon />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className="z-[999999] mt-2 max-h-[400px] min-w-[250px] overflow-scroll rounded-md border border-gray-200 bg-white"
          >
            {/* Search input */}
            <div className="flex items-center border-b">
              <Search className="ml-4 size-4 text-gray-500" />
              <input
                ref={searchInputRef}
                placeholder={`Search ${field.name}...`}
                className="border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            {/* Options list */}
            {filteredOptions.length === 0 ? (
              <div className="max-w-[400px] p-4">No options found</div>
            ) : (
              filteredOptions.map((option, index) => {
                const isSelected = value === option;
                const isHighlighted = index === selectedIndex;

                return (
                  <div
                    id={`option-${index}`}
                    key={option}
                    className={tw(
                      "flex items-center justify-between px-4 py-3 text-[14px] text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                      isHighlighted && [
                        "bg-gray-50",
                        "relative",
                        index !== 0 &&
                          "before:absolute before:inset-x-0 before:top-0 before:border-t before:border-gray-200",
                        index !== filteredOptions.length - 1 &&
                          "after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-gray-200",
                      ]
                    )}
                    onClick={() => handleOptionClick(option)}
                    style={{
                      width: triggerRef.current?.clientWidth || "auto",
                    }}
                  >
                    <span>{option}</span>
                    {isSelected && (
                      <span className="h-auto w-[14px] text-primary">
                        <CheckIcon />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}
