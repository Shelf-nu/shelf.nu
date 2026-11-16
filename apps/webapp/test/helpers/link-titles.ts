/**
 * Link title payloads shared by the tests that produce them and the tests that
 * consume them, so a route and the component reading its payload are pinned
 * to one shape.
 *
 * - `LINK_TITLES` is `linkTitles` as the asset overview and the advanced
 *   index send it, and what `getLinkTitles` returns.
 * - `LINK_TITLE_SAVED` is the body of a successful POST /api/link-titles.
 *
 * @see {@link file://../../app/modules/link-preview/service.server.ts}
 * @see {@link file://../../app/routes/api+/link-titles.ts}
 */
import type { LinkTitles } from "@shelf/links";

/** A maker's manual, as a Link field stores it. Its `LinkKey` is the same text. */
export const MANUAL_URL = "https://www.example-maker.com/manuals/eos-r5.pdf";

/** A shop page someone has named in the workspace. */
export const SHOP_URL = "https://www.example-shop.com/c/product/1234";

/** Titles keyed by `LinkKey`: one fetched page title, one name a person gave. */
export const LINK_TITLES: LinkTitles = {
  [MANUAL_URL]: { pageTitle: "EOS R5 user manual", customTitle: null },
  [SHOP_URL]: { pageTitle: "EOS R5 body", customTitle: "Camera supplier" },
};

/** What POST /api/link-titles answers after naming `MANUAL_URL`. */
export const LINK_TITLE_SAVED = {
  error: null,
  ok: true,
  linkTitle: { pageTitle: "EOS R5 user manual", customTitle: "Camera manual" },
};
