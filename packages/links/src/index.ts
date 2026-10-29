/**
 * `@shelf/links`: public entrypoint.
 *
 * Every rule about a web link in a custom field value lives here, so the
 * webapp and the companion app detect, label and validate links the same way:
 * which part of a text value is a URL, which service and kind of item a URL
 * points at, the words and icon on its chip, the identity its stored title is
 * keyed by, and the input rule for Link-format fields. The provider registry
 * and display rules are internal; this file is the only export.
 *
 * Pure and dependency-free, shipped as raw TypeScript like
 * `@shelf/quantity-control`: the webapp bundles it through `ssr.noExternal`,
 * the companion through Metro. Relative imports stay extensionless so Metro
 * resolves them. Regular expressions must not use lookbehind assertions:
 * Safari before 16.4 cannot parse them and the client build cannot lower them
 * (`no-lookbehind.test.ts` enforces this).
 *
 * @see {@link file://./types.ts} for the public types.
 * @see {@link file://./parse.ts} for detection, parsing and the input rule.
 * @see {@link file://./chip-text.ts} for chip words and title cleaning.
 * @see {@link file://./icons.ts} for the chip icons.
 */

export * from "./types";
export {
  MAX_LINK_LENGTH,
  parseLink,
  parseLinkInput,
  segmentText,
} from "./parse";
export { cleanLinkTitle, linkChipText } from "./chip-text";
export { LINK_ICONS } from "./icons";
