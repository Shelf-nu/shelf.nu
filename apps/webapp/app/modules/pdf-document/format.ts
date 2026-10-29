/**
 * Printed Document Values
 *
 * Turns a stored custom field value into the text a PDF document shows in
 * its cell. The document is paper, so every value becomes plain text: an amount
 * in the workspace currency, a date in the acting user's date format, a yes
 * or no for a boolean, and a multi-line text as the text that was typed.
 *
 * @see {@link file://../booking/pdf-helpers.ts}
 */
import type { Currency, CustomFieldType } from "@prisma/client";
import type { ICustomFieldValueJson } from "~/modules/asset/types";
import { formatCurrency } from "~/utils/currency";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import type { ResolvedFormatPrefs } from "~/utils/date-format";

/**
 * The printed text of one custom field value.
 *
 * @param params.value - The stored `AssetCustomFieldValue.value`
 * @param params.type - The custom field's type
 * @param params.currency - The workspace currency, for amounts
 * @param params.locale - The acting user's locale, for amounts
 * @param params.prefs - The acting user's format preferences, for dates
 * @returns The text, or `null` when there is nothing to print
 */
export function formatDocumentCustomFieldValue({
  value,
  type,
  currency,
  locale,
  prefs,
}: {
  value: unknown;
  type: CustomFieldType;
  currency: Currency;
  locale: string;
  prefs?: ResolvedFormatPrefs;
}): string | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as ICustomFieldValueJson;
  const raw = stored.raw;
  if (raw === undefined || raw === null || raw === "") return null;

  switch (type) {
    case "AMOUNT": {
      const amount = Number(raw);
      return Number.isFinite(amount)
        ? formatCurrency({ value: amount, currency, locale })
        : String(raw);
    }
    case "MULTILINE_TEXT":
      return String(raw);
    default: {
      const text = getCustomFieldDisplayValue(stored, prefs);
      return typeof text === "string" ? text : String(raw);
    }
  }
}
