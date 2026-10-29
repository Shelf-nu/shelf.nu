/**
 * The custom field cards on the asset overview: "Documents & links" for
 * Link-format fields, and the custom fields card for every other field. Both
 * render their rows with `CustomFieldRow`, which shows a value and, for users
 * who can edit, its inline editor.
 *
 * @see {@link file://../../routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://../../utils/custom-fields.ts} `buildAssetOverviewCustomFields`
 *   and `splitOverviewCustomFields`, which build and split the rows
 */
import { useState } from "react";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import type { Currency } from "@prisma/client";
import { CustomFieldFormat, CustomFieldType } from "@prisma/client";
import type { LinkTitles } from "@shelf/links";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
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

/** Props shared by both cards. */
type CustomFieldCardProps = {
  /** The card's rows, from `splitOverviewCustomFields` */
  rows: OverviewRow[];
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
 * The asset's Link fields under a "Documents & links" heading, set or not.
 * Renders nothing when the asset has no Link fields.
 */
export function DocumentsAndLinksCard({
  rows,
  ...rowProps
}: CustomFieldCardProps) {
  if (rows.length === 0) return null;
  return (
    <Card className="my-3 px-[-4] py-[-5] md:border">
      <div className="border-b px-4 py-3">
        <h5>Documents &amp; links</h5>
      </div>
      <ul className="item-information">
        {rows.map((row) => (
          <CustomFieldRow key={row.def.id} row={row} {...rowProps} />
        ))}
      </ul>
    </Card>
  );
}

/**
 * The asset's other custom fields. Renders nothing when none has a value and
 * the user cannot fill any in.
 */
export function CustomFieldsCard({ rows, ...rowProps }: CustomFieldCardProps) {
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
}: Omit<CustomFieldCardProps, "rows"> & { row: OverviewRow }) {
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

  /*
   * An empty Link field reads "Not linked" for everyone: the card is a
   * checklist of what is missing. Other empty fields show only to people
   * who can fill them in.
   */
  const isLink = def.format === CustomFieldFormat.LINK;
  if (!hasValue && !canEditField && !isLink) return null;

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
            ) : def.type === CustomFieldType.TEXT ? (
              <TextWithLinks value={rawValue} titles={titles} />
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
          <span className="text-gray-400">
            {isLink ? "Not linked" : "Not set"}
          </span>
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
            // A Link field gets the URL keyboard on phones.
            // It stays type="text": the browser's own url
            // check would refuse "www.example.com/a.pdf",
            // which the server accepts and stores as https.
            return (
              <Input
                label={def.name}
                hideLabel
                name="fieldValue"
                defaultValue={rawValue}
                className="w-full"
                {...(def.format === "LINK"
                  ? {
                      inputMode: "url",
                      placeholder: "https://",
                      autoComplete: "off",
                      spellCheck: false,
                    }
                  : {})}
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
