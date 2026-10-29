/**
 * Link title payloads shared by the tests that produce them and the tests that
 * consume them, so a loader and the component reading its payload are pinned
 * to one shape.
 *
 * `LINK_TITLES` is `linkTitles` as the asset overview, the advanced index and
 * the mobile asset detail send it.
 *
 * @see {@link file://../../app/modules/link-preview/service.server.ts}
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
