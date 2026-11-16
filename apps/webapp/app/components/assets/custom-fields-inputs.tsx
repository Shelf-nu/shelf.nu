import type { ComponentProps, ReactElement, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomFieldType, Currency, CustomField } from "@prisma/client";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { Search } from "lucide-react";
import { useLoaderData, useNavigation } from "react-router";
import { linkInputProps } from "~/components/links/link-input-props";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import { useInlineCreatePermissions } from "~/hooks/use-inline-create-permissions";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import type { loader } from "~/routes/_layout+/assets.$assetId_.edit";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { isFormProcessing } from "~/utils/form";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import type { ModelPrefill } from "./model-default-prefill";
import {
  EMPTY_MODEL_PREFILL,
  getUsablePrefill,
  prefillVersion,
} from "./model-default-prefill";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Switch } from "../forms/switch";
import { CheckIcon, SearchIcon } from "../icons/library";
import { MarkdownEditor } from "../markdown/markdown-editor";
import { Button } from "../shared/button";
import { DateTimePicker } from "../shared/date-time-picker";

/**
 * The custom field inputs of the asset form.
 *
 * Inputs are uncontrolled: each starts from the value a picked model
 * pre-filled (`modelPrefill`) or else the asset's saved value. An input
 * remounts only when the model changes its pre-filled value, so whatever the
 * user typed elsewhere stays.
 *
 * @param props.currency - Workspace currency, shown on amount fields
 * @param props.fieldErrors - Validation message per custom field id
 * @param props.modelPrefill - Values the picked asset model filled in
 */
export default function AssetCustomFields({
  currency,
  fieldErrors,
  modelPrefill = EMPTY_MODEL_PREFILL,
}: {
  currency: Currency;
  fieldErrors: Record<string, string | undefined>;
  modelPrefill?: ModelPrefill;
}) {
  const { customFields, asset } = useLoaderData<typeof loader>();

  const customFieldsValues =
    (asset?.customFields as unknown as ShelfAssetCustomFieldValueType[]) || [];

  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const { prefs } = useDateFormatter();
  /** Managing the definitions is for members who may create custom fields. */
  const canManageCustomFields = useInlineCreatePermissions().customField;

  const getSavedValue = (id: string) =>
    customFieldsValues?.find((cfv) => cfv.customFieldId === id)?.value;

  /** The value a picked model pre-filled into this field, when usable. */
  const getPrefill = (id: string) => {
    const field = customFields.find((f) => f.id === id);
    return field ? getUsablePrefill(modelPrefill, field) : undefined;
  };

  const getCustomFieldVal = (id: string) => {
    const prefilled = getPrefill(id);
    if (prefilled !== undefined) {
      return prefilled;
    }
    const value = getSavedValue(id);
    return value ? (getCustomFieldDisplayValue(value, prefs) as string) : "";
  };

  /** Initial `YYYY-MM-DD` value of a date field. */
  const getDateVal = (id: string) => {
    const prefilled = getPrefill(id);
    if (prefilled !== undefined) {
      return prefilled;
    }
    const valueDate = getSavedValue(id)?.valueDate;
    return valueDate ? new Date(valueDate).toISOString().split("T")[0] : "";
  };

  /**
   * React key of a field's input: it changes only when a picked model
   * changes the field's pre-filled value, which remounts the uncontrolled
   * input with that value.
   */
  const inputKey = (id: string) => `${id}-${prefillVersion(modelPrefill, id)}`;

  // Get field errors from the plain object passed from parent
  // This avoids react-zorm + React 19 incompatibility
  const getFieldError = (fieldId: string) => fieldErrors[fieldId];

  // Get required status from the custom field definition itself
  const isFieldRequired = (fieldId: string) => {
    const field = customFields.find((f) => f.id === fieldId);
    return field?.required ?? false;
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
        <DateTimePicker
          key={inputKey(field.id)}
          mode="date"
          className="w-full"
          label={field.name}
          hideLabel
          name={`cf-${field.id}`}
          defaultValue={getDateVal(field.id)}
          clearable
          error={getFieldError(field.id)}
          disabled={disabled}
        />
      </div>
    ),
    OPTION: (field) => (
      <>
        <label className="mb-1.5 font-medium text-gray-700 lg:hidden">
          <span className={field.required ? "required-input-label" : ""}>
            {field.name}
          </span>
        </label>

        <OptionSelect
          key={inputKey(field.id)}
          field={field}
          getCustomFieldVal={getCustomFieldVal}
          error={getFieldError(field.id)}
          disabled={disabled}
        />
      </>
    ),
    MULTILINE_TEXT: (field) => {
      const value = getPrefill(field.id) ?? getSavedValue(field.id)?.raw;

      const error = getFieldError(field.id);

      return (
        <>
          <MultilineCustomFieldEditor
            key={inputKey(field.id)}
            name={`cf-${field.id}`}
            label={field.name}
            defaultValue={value ? String(value) : ""}
            placeholder={field.helpText ?? field.name}
            disabled={disabled}
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
          key={inputKey(field.id)}
          hideLabel
          type="number"
          label={field.name}
          name={`cf-${field.id}`}
          placeholder={field.helpText || undefined}
          error={getFieldError(field.id)}
          defaultValue={getCustomFieldVal(field.id)}
          inputClassName="pl-[70px] valuation-input"
          disabled={disabled}
          step="any"
          min={0}
          className="w-full"
          required={isFieldRequired(field.id)}
        />
        <span className="absolute bottom-0 border-r px-3 py-2.5  text-gray-600 ">
          {currency}
        </span>
      </div>
    ),
    NUMBER: (field) => (
      <Input
        key={inputKey(field.id)}
        hideLabel
        type="number"
        label={field.name}
        name={`cf-${field.id}`}
        placeholder={field.helpText || undefined}
        error={getFieldError(field.id)}
        defaultValue={getCustomFieldVal(field.id)}
        disabled={disabled}
        step="any"
        className="w-full"
        required={isFieldRequired(field.id)}
      />
    ),
  };

  const requiredFields = customFields.filter((field) => field.required);

  const optionalFields = customFields.filter((field) => !field.required);

  return (
    <div className="border-b pb-6">
      <div className=" border-t py-5">
        <h2 className="mb-1 text-[18px] font-semibold">Custom Fields</h2>
        {canManageCustomFields ? (
          <Button
            to="/settings/custom-fields"
            className="font-medium text-primary-600"
            target="_blank"
            variant="link"
          >
            Manage custom fields
          </Button>
        ) : null}
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
                      key={inputKey(field.id)}
                      hideLabel
                      placeholder={field.helpText || undefined}
                      type={field.type.toLowerCase()}
                      label={field.name}
                      name={`cf-${field.id}`}
                      error={getFieldError(field.id)}
                      disabled={disabled}
                      defaultValue={getCustomFieldVal(field.id)}
                      className="w-full"
                      required={isFieldRequired(field.id)}
                      {...linkInputProps(field)}
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
                      key={inputKey(field.id)}
                      hideLabel
                      placeholder={field.helpText || undefined}
                      type={field.type.toLowerCase()}
                      label={field.name}
                      name={`cf-${field.id}`}
                      error={getFieldError(field.id)}
                      disabled={disabled}
                      defaultValue={getCustomFieldVal(field.id)}
                      className="w-full"
                      required={isFieldRequired(field.id)}
                      {...linkInputProps(field)}
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
              {canManageCustomFields ? (
                <Button to="/settings/custom-fields/new" variant="primary">
                  Create custom fields
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The multiline custom field editor of the asset form.
 *
 * The editor rebuilds its text whenever its `defaultValue` changes, so it is
 * handed the value it mounted with and never a later one: a re-render that
 * computes a different initial value would otherwise wipe what the user
 * typed. A picked model's pre-fill reaches it by remounting it through `key`.
 *
 * @param props.defaultValue - The text the editor starts from
 */
function MultilineCustomFieldEditor({
  defaultValue,
  ...props
}: Omit<ComponentProps<typeof MarkdownEditor>, "maxLength" | "ref">) {
  const [initialValue] = useState(defaultValue);
  return (
    <MarkdownEditor {...props} defaultValue={initialValue} maxLength={5000} />
  );
}

/**
 * Component that renders select for CustomField OPTION fields. Shared by the
 * asset form and the asset model form's default values.
 *
 * The value travels in a hidden input, so the browser never flags it as
 * invalid on its own: the validation message has to be rendered here,
 * under the trigger, or a required option field that is left empty blocks
 * the save with nothing on screen to explain why.
 *
 * @param error - Validation message for this field, shown under the trigger
 * @param disabled - Disables the trigger so no option can be picked
 */
export function OptionSelect({
  field,
  getCustomFieldVal,
  error,
  disabled = false,
}: {
  field: Pick<CustomField, "id" | "name" | "options">;
  getCustomFieldVal: (id: string) => string;
  error?: string;
  /** Disables the trigger, e.g. while the form submits. */
  disabled?: boolean;
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

  /**
   * Picking an option only updates the hidden input, which fires no form
   * `change` event, so Zorm keeps reporting the error from the last submit.
   * The option schema has exactly two errors, an empty required value and a
   * value missing from `field.options`, and a value in that list satisfies
   * both. Hide the error only then: a stored value that was removed from the
   * options must keep its message.
   */
  const shownError =
    value !== "" && field.options.includes(value) ? undefined : error;

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
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
            type="button"
            variant="secondary"
            className={tw(
              "w-full justify-start truncate whitespace-nowrap font-normal [&_span]:w-full [&_span]:max-w-full [&_span]:truncate [&_span]:text-left",
              shownError && "border-error-300 focus:border-error-300"
            )}
            ref={triggerRef}
            disabled={disabled}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? `cf-${field.id}-error` : undefined}
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
                    // Legacy fields can hold the same option twice.
                    key={`${index}-${option}`}
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
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => handleOptionClick(option)}
                    onKeyDown={handleActivationKeyPress(() =>
                      handleOptionClick(option)
                    )}
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
      {shownError ? (
        <div id={`cf-${field.id}-error`} className="text-sm text-error-500">
          {shownError}
        </div>
      ) : null}
    </>
  );
}
