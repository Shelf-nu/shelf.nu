/**
 * Renders the `{% name text="..." /%}` tag of system notes.
 *
 * System notes put every value a person typed (a booking, kit or location
 * name, a barcode, a reminder name, a custom field value) inside a tag, never
 * as bare text, so the value always reads as written: a name that looks like a
 * URL stays text and never becomes a link to that URL. Only a value its writer
 * marks with `chips` (a custom field value, whose links the asset page already
 * shows as chips) gets link chips.
 *
 * @see {@link file://../../utils/markdoc-wrappers.ts} `wrapNameForNote`
 * @see {@link file://../links/text-with-link-chips.tsx}
 */
import { useLinkTitles } from "~/components/links/link-titles-context";
import { TextWithLinkChips } from "~/components/links/text-with-link-chips";

/**
 * Bold literal text, or with `chips`, the text with its web links as chips.
 *
 * @param props.text - The value as typed
 * @param props.chips - Show web links in the value as link chips
 */
export function NameComponent({
  text,
  chips = false,
}: {
  text: string;
  chips?: boolean;
}) {
  const titles = useLinkTitles();
  return (
    <strong>
      {chips ? <TextWithLinkChips text={text} titles={titles} /> : text}
    </strong>
  );
}
