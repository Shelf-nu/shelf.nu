/**
 * TextWithLinks: a single-line text custom field value. A value that is
 * exactly one link renders as a `LinkChip`; any other text renders through
 * `LinkedText`, so a URL inside it is still tappable.
 *
 * @see {@link file://../../lib/custom-field-links.ts} `linkChip`
 * @see {@link file://./link-chip.tsx}
 * @see {@link file://./linked-text.tsx}
 */
import { memo, useMemo } from "react";
import type { StyleProp, TextStyle } from "react-native";
import type { LinkTitle } from "@shelf/links";
import { linkChip } from "@/lib/custom-field-links";
import { LinkChip } from "./link-chip";
import { LinkedText } from "./linked-text";

/**
 * A text value as a chip or as text with tappable links.
 *
 * @param props - Component props.
 * @param props.value - The stored text value.
 * @param props.title - The value's entry in `asset.fieldLinkTitles`, if any.
 * @param props.style - Text style when the value is not a single link.
 * @param props.numberOfLines - Lines shown before that text is clipped.
 * @returns The chip or the text.
 */
export const TextWithLinks = memo(function TextWithLinks({
  value,
  title,
  style,
  numberOfLines,
}: {
  value: string;
  title?: LinkTitle;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const chip = useMemo(() => linkChip(value, title), [value, title]);
  if (chip) return <LinkChip chip={chip} />;
  return (
    <LinkedText text={value} style={style} numberOfLines={numberOfLines} />
  );
});
