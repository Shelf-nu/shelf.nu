/**
 * The words on a link chip, and the cleaning that makes a fetched page title
 * fit to be one of them.
 */

import { capDisplayText, normalizeDisplayText } from "./display-text";
import { KIND_LABELS, PROVIDERS } from "./registry";
import type { ChipText, LinkTitle, ParsedLink } from "./types";

function kindLabel(link: ParsedLink): string | null {
  if (link.kind === "page") return null;
  const providerLabels = link.provider
    ? PROVIDERS[link.provider].kindLabels
    : undefined;
  return providerLabels?.[link.kind] ?? KIND_LABELS[link.kind];
}

/**
 * Chip words for a parsed link.
 *
 * `primary` is the custom title, else the page title, else the file name,
 * else the kind ("PDF", "Google Sheet"), else the host for a plain page. A
 * blank title counts as no title. `meta` names the kind (when `primary` is a
 * title or file name) and the provider or host, joined by " · ", and is null
 * when it would repeat `primary`.
 */
export function linkChipText(
  link: ParsedLink,
  title: LinkTitle | undefined
): ChipText {
  const kind = kindLabel(link);
  const name = title?.customTitle || title?.pageTitle || link.fileName;
  const primary = name || kind || link.host;
  const where = link.provider ? PROVIDERS[link.provider].label : link.host;
  const parts = name && kind ? [kind, where] : [where];
  const meta = parts.join(" · ");
  if (meta === primary) return { primary, meta: null, label: primary };
  return { primary, meta, label: [primary, ...parts].join(", ") };
}

/**
 * Makes untrusted title text displayable: turns control characters into
 * spaces, strips bidi controls, collapses whitespace, removes the provider's
 * title prefix and suffix (" - Google Drive", "Dropbox - ") when `link` is given, and caps the result
 * at 120 characters. Null when nothing is left or the title is just the host.
 */
export function cleanLinkTitle(raw: string, link?: ParsedLink): string | null {
  let title = normalizeDisplayText(raw);
  const provider = link?.provider ? PROVIDERS[link.provider] : null;
  for (const prefix of provider?.titlePrefixes ?? []) {
    if (title.startsWith(prefix)) {
      title = title.slice(prefix.length).trimStart();
      break;
    }
  }
  const suffixes = provider?.titleSuffixes ?? [];
  for (const suffix of suffixes) {
    if (title.endsWith(suffix)) {
      title = title.slice(0, -suffix.length).trimEnd();
      break;
    }
  }
  title = capDisplayText(title);
  if (title === "") return null;
  if (link && title.toLowerCase().replace(/^www\./, "") === link.host) {
    return null;
  }
  return title;
}
