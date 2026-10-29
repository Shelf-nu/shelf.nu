/**
 * Input attributes for a Link-format custom field, shared by the asset form
 * and the asset overview's inline editor so both behave the same.
 *
 * @see {@link file://../assets/custom-fields-inputs.tsx}
 * @see {@link file://../assets/asset-overview-custom-fields.tsx}
 */
import { CustomFieldFormat } from "@prisma/client";

/**
 * The URL keyboard on phones, no autocomplete or spellcheck on a web
 * address. The input stays `type="text"`: the browser's own url check would
 * refuse "www.example.com/a.pdf", which the server accepts and stores as
 * https.
 */
const LINK_INPUT_PROPS = {
  inputMode: "url",
  placeholder: "https://",
  autoComplete: "off",
  spellCheck: false,
} as const;

/**
 * Attributes to spread onto a TEXT field's input, after its own placeholder.
 *
 * @param field - The field definition
 * @returns The Link input attributes for a Link field, none for any other
 */
export function linkInputProps(field: { format: CustomFieldFormat }) {
  return field.format === CustomFieldFormat.LINK ? LINK_INPUT_PROPS : {};
}
