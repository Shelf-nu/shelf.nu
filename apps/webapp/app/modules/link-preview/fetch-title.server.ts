/**
 * Page title fetch
 *
 * The network half of link previews: GETs the head of a link's page through
 * the SSRF-guarded `safeFetchPrefix` and hands it to `classifyHead`. It sends
 * an honest bot User-Agent and never impersonates a browser, so sites that
 * refuse bots end up BLOCKED and the chip keeps what the URL alone says.
 *
 * @see {@link file://./policy.ts} how the head is judged
 * @see {@link file://../../utils/ssrf.server.ts} the guarded fetch
 */

import type { ParsedLink } from "@shelf/links";
import { BlockedAddressError, safeFetchPrefix } from "~/utils/ssrf.server";
import { classifyHead, isHtmlContentType } from "./policy";
import type { PageTitleResult } from "./policy";

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; ShelfLinkPreview/1.0; +https://www.shelf.nu)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en",
} as const;

/** A head larger than this is cut off; the title is near the top. */
const MAX_HEAD_BYTES = 1024 * 1024;

const TIMEOUT_MS = 8_000;

/**
 * Fetches the start of a link's page (up to `</head>`, at most 1 MB, 8 s,
 * default ports only) and reads its title. A non-HTML response is judged on
 * its headers alone, without reading the body.
 *
 * @param link - The parsed link to fetch
 * @returns The outcome. A destination refused by the SSRF guard is
 *   UNREACHABLE for good; any other failure to fetch is UNREACHABLE for now.
 *   Never throws.
 */
export async function fetchPageTitle(
  link: ParsedLink
): Promise<PageTitleResult> {
  try {
    const page = await safeFetchPrefix(link.url, {
      maxBytes: MAX_HEAD_BYTES,
      stopAfter: "</head>",
      timeoutMs: TIMEOUT_MS,
      headers: REQUEST_HEADERS,
      readBodyIf: ({ headers }) =>
        isHtmlContentType(headers.get("content-type")),
    });
    return classifyHead({ link, ...page });
  } catch (cause) {
    return {
      outcome: "UNREACHABLE",
      permanent: cause instanceof BlockedAddressError,
    };
  }
}
