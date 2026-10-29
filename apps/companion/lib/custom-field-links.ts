/**
 * How custom field values with web links read on the asset screen.
 *
 * Every rule about the URL itself (detection, provider, kind, chip words)
 * comes from `@shelf/links`, the same package the web app reads links with.
 * This module only applies it to what the mobile asset detail payload
 * carries: the fields in `asset.linkFields` move to the Documents & links
 * section, and a value that is exactly one link becomes a chip, titled from
 * `asset.fieldLinkTitles` (by custom field id) when the server knows one.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it.
 *
 * @see {@link file://../components/asset-detail/documents-links-section.tsx}
 * @see {@link file://../components/asset-detail/custom-fields-section.tsx}
 * @see {@link file://../components/links/text-with-links.tsx}
 * @see {@link file://./custom-field-links.test.ts}
 */

import {
  linkChipText,
  parseLink,
  segmentText,
  type ChipText,
  type LinkIconId,
  type LinkTitle,
} from "@shelf/links";

/** Everything a link chip draws: its words, its icon and the URL it opens. */
export type LinkChipModel = ChipText & {
  readonly url: string;
  readonly icon: LinkIconId;
};

/**
 * The chip for a value that is exactly one http(s) link.
 *
 * Without a title the chip reads what the URL alone says ("PDF",
 * "SharePoint").
 *
 * @param value - The stored text value.
 * @param title - The value's entry in `asset.fieldLinkTitles` (looked up by
 *   the custom field's id), if any.
 * @returns The chip, or null when the value is not exactly one link.
 */
export function linkChip(
  value: string,
  title: LinkTitle | undefined
): LinkChipModel | null {
  const link = parseLink(value);
  if (!link) return null;
  return {
    ...linkChipText(link, title),
    url: link.url,
    icon: link.icon,
  };
}

/**
 * Whether a text value has at least one http(s) URL in it, so its row needs
 * room for a chip or tappable links.
 *
 * @param value - The stored text value.
 * @returns True when the value holds a link anywhere.
 */
export function containsLink(value: string): boolean {
  return segmentText(value).some((segment) => segment.type === "link");
}

/** One row of the Documents & links section. */
export type LinkFieldRow = {
  /** The custom field (definition) id. */
  readonly id: string;
  readonly name: string;
  /** The stored text, or null when the field is not set on this asset. */
  readonly value: string | null;
};

/** The parts of an `AssetDetail.customFields` entry this module reads. */
type StoredFieldValue = {
  readonly value: unknown;
  readonly customField: { readonly id: string };
};

/** The text of a stored TEXT value (`{ raw, valueText }`); null when blank. */
function storedText(value: unknown): string | null {
  let text: unknown = value;
  if (typeof value === "object" && value !== null) {
    const { raw, valueText } = value as { raw?: unknown; valueText?: unknown };
    text = raw ?? valueText;
  }
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

/**
 * Splits an asset's field values between the Documents & links section and
 * the Custom Fields card, so each field shows once.
 *
 * Every field in `linkFields` gets a row, in the server's order, set or not.
 * Exactly those fields leave the Custom Fields card; any other value stays
 * there, including a Link-format value whose field no longer applies to the
 * asset's category (the server leaves that field out of `linkFields`).
 *
 * @param customFields - The asset's (active) field values.
 * @param linkFields - `asset.linkFields`; absent on older servers, which
 *   leaves every value in the Custom Fields card.
 * @returns The Documents & links rows and the values left for Custom Fields.
 */
export function splitLinkFields<F extends StoredFieldValue>(
  customFields: readonly F[],
  linkFields: readonly { id: string; name: string }[] | undefined
): { linkRows: LinkFieldRow[]; otherFields: F[] } {
  const listed = linkFields ?? [];
  const listedIds = new Set(listed.map((field) => field.id));
  const valueByFieldId = new Map(
    customFields.map((cf) => [cf.customField.id, cf.value])
  );
  return {
    linkRows: listed.map(({ id, name }) => ({
      id,
      name,
      value: storedText(valueByFieldId.get(id)),
    })),
    otherFields: customFields.filter((cf) => !listedIds.has(cf.customField.id)),
  };
}
