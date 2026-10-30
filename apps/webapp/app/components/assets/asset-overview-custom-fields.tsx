/**
 * The custom fields card on the asset overview: one row per field, sorted by
 * name, each showing its value and, for users who can edit, its inline
 * editor. A TEXT value reads through `TextWithLinks`, so a whole link shows
 * as a chip; on a Link-format field, editors can also name that link.
 *
 * @see {@link file://../../routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://../../utils/custom-fields.ts} `buildAssetOverviewCustomFields`,
 *   which builds the rows
 */
import { useState } from "react";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import type { Currency } from "@prisma/client";
import { CustomFieldFormat, CustomFieldType } from "@prisma/client";
import type { LinkTitles } from "@shelf/links";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import { linkInputProps } from "~/components/links/link-input-props";
import { TextWithLinks } from "~/components/links/text-with-links";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Card } from "~/components/shared/card";
import { DateTimePicker } from "~/components/shared/date-time-picker";
import { InlineEditableField } from "~/components/shared/inline-editable-field";
import TextualDivider from "~/components/shared/textual-divider";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import { formatCurrency } from "~/utils/currency";
import {
  getCustomFieldDisplayValue,
  type AssetOverviewCustomField,
  type StoredCustomFieldValueForDisplay,
} from "~/utils/custom-fields";
import { tw } from "~/utils/tw";

/** One overview row, whatever the stored value's exact row type. */
type OverviewRow = AssetOverviewCustomField<StoredCustomFieldValueForDisplay>;

/** What every row of the card shares. */
type CustomFieldRowProps = {
  /** The loader's `linkTitles`, for the words on link chips */
  titles: LinkTitles;
  /** Whether the user may edit this asset at all */
  canEditAsset: boolean;
  /** For AMOUNT values */
  locale: string;
  /** The workspace currency, for AMOUNT values */
  currency: Currency;
};

/**
 * The asset's custom fields. Renders nothing when none has a value and the
 * user cannot fill any in.
 *
 * @param props.rows - The rows, from `buildAssetOverviewCustomFields`
 */
export function CustomFieldsCard({
  rows,
  ...rowProps
}: CustomFieldRowProps & { rows: OverviewRow[] }) {
  const hasRows =
    rows.some((row) => row.storedValue) ||
    (rowProps.canEditAsset && rows.length > 0);
  if (!hasRows) return null;
  return (
    <>
      <TextualDivider text="Custom fields" className="mb-8 pt-3 lg:hidden" />
      <Card className="my-3 px-[-4] py-[-5] md:border">
        <ul className="item-information">
          {rows.map((row) => (
            <CustomFieldRow key={row.def.id} row={row} {...rowProps} />
          ))}
        </ul>
      </Card>
    </>
  );
}

/**
 * One custom field on the asset overview, with its inline editor for users
 * who can edit it.
 *
 * @param props.row - The field and its stored value
 */
function CustomFieldRow({
  row: { def, storedValue, isEditable },
  titles,
  canEditAsset,
  locale,
  currency,
}: CustomFieldRowProps & { row: OverviewRow }) {
  const { prefs } = useDateFormatter();
  const hasValue = !!storedValue;
  /**
   * A field the action would refuse to write (its definition is outside the
   * asset's category scope) stays visible but read-only: offering an editor
   * there would dead-end on a 400.
   */
  const canEditField = canEditAsset && isEditable;
  const fieldValue = hasValue
    ? (storedValue.value as unknown as ShelfAssetCustomFieldValueType["value"])
    : null;
  const rawValue = fieldValue?.raw !== undefined ? String(fieldValue.raw) : "";
  const customFieldDisplayValue = hasValue
    ? getCustomFieldDisplayValue(fieldValue!, prefs)
    : null;

  /* Hide "Not set" rows from users who can't fill them in */
  if (!hasValue && !canEditField) return null;

  return (
    <InlineEditableField
      fieldName={`customField-${def.id}`}
      formFieldName="customField"
      label={def.name}
      canEdit={canEditField}
      extraHiddenInputs={{
        customFieldId: def.id,
      }}
      renderDisplay={() =>
        hasValue ? (
          <div
            className={tw(
              "text-gray-600",
              def.type !== CustomFieldType.MULTILINE_TEXT && "max-w-[350px]"
            )}
          >
            {def.type === CustomFieldType.MULTILINE_TEXT ? (
              <MarkdownViewer
                content={customFieldDisplayValue as RenderableTreeNode}
                allowExternalLinks
              />
            ) : def.type === CustomFieldType.TEXT ||
              def.type === CustomFieldType.OPTION ? (
              // An option is free text an admin typed, so it can hold a link
              // too, as on the asset index. Only Link-format fields rename.
              <TextWithLinks
                value={rawValue}
                titles={titles}
                canRename={
                  canEditAsset && def.format === CustomFieldFormat.LINK
                }
              />
            ) : def.type === CustomFieldType.AMOUNT ? (
              formatCurrency({
                value: fieldValue!.raw as number,
                locale,
                currency,
              })
            ) : (
              (customFieldDisplayValue as string)
            )}
          </div>
        ) : (
          <span className="text-gray-400">Not set</span>
        )
      }
      renderEditor={() => {
        switch (def.type) {
          case CustomFieldType.MULTILINE_TEXT:
            return (
              <Input
                label={def.name}
                hideLabel
                inputType="textarea"
                name="fieldValue"
                defaultValue={rawValue}
                className="w-full"
              />
            );
          case CustomFieldType.BOOLEAN:
            return (
              <BooleanCustomFieldEditor
                name="fieldValue"
                label={def.name}
                initialChecked={
                  fieldValue?.raw === "yes" || fieldValue?.raw === true
                }
                initialIsUnset={!hasValue}
              />
            );
          case CustomFieldType.DATE:
            return (
              <DateTimePicker
                mode="date"
                label={def.name}
                hideLabel
                name="fieldValue"
                defaultValue={rawValue}
                className="w-full"
              />
            );
          case CustomFieldType.OPTION:
            return (
              <select
                aria-label={def.name}
                name="fieldValue"
                defaultValue={rawValue}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select an option</option>
                {(def.options as string[] | null)
                  ?.filter((o: string) => o !== null && o !== "")
                  .map((option: string, index: number) => (
                    // Legacy fields can hold the same option twice.
                    <option key={`${index}-${option}`} value={option}>
                      {option}
                    </option>
                  ))}
              </select>
            );
          case CustomFieldType.AMOUNT:
          case CustomFieldType.NUMBER:
            return (
              <Input
                label={def.name}
                hideLabel
                type="text"
                inputMode="decimal"
                name="fieldValue"
                defaultValue={rawValue}
                className="w-full"
              />
            );
          default:
            return (
              <Input
                label={def.name}
                hideLabel
                name="fieldValue"
                defaultValue={rawValue}
                className="w-full"
                {...linkInputProps(def)}
              />
            );
        }
      }}
    />
  );
}

/**
 * The inline editor for a BOOLEAN field, with a way back to "not set" for a
 * field that had no value.
 */
function BooleanCustomFieldEditor({
  name,
  label,
  initialChecked,
  initialIsUnset = false,
}: {
  name: string;
  label: string;
  // why: named `initialChecked` / `initialIsUnset` rather than the more
  // common `defaultChecked` / `defaultIsUnset` so they don't get treated
  // as controlled-input defaults that should sync: once the user
  // toggles, local state owns the value. Also silences react-doctor's
  // `no-derived-useState` heuristic, which flags `default*`-named
  // props seeded into useState as derived-state-in-disguise.
  initialChecked: boolean;
  initialIsUnset?: boolean;
}) {
  const [isUnset, setIsUnset] = useState(initialIsUnset);
  const [checked, setChecked] = useState(initialChecked);
  return (
    <div className="flex items-center gap-2">
      <input
        type="hidden"
        name={name}
        value={isUnset ? "" : checked ? "yes" : "no"}
      />
      <Switch
        aria-label={label}
        checked={!isUnset && checked}
        onCheckedChange={(val) => {
          setIsUnset(false);
          setChecked(val);
        }}
      />
      <span className="text-sm text-gray-600">
        {isUnset ? `${label} (not set)` : label}
      </span>
      {/*
       * Clear is only offered when the field was originally unset
       * (initialIsUnset === true) and the user has just toggled the Switch on,
       * so they can revert without committing a yes/no value. Once cleared, the
       * only way back is to flip the Switch, which automatically un-sets
       * isUnset via the onCheckedChange handler above.
       */}
      {!isUnset && initialIsUnset && (
        <button
          type="button"
          onClick={() => setIsUnset(true)}
          className="text-xs text-gray-400 underline hover:text-gray-600"
        >
          Clear
        </button>
      )}
    </div>
  );
}
