/**
 * Link titles for chips rendered deep inside Markdown (activity notes), where
 * the loader's `LinkTitles` cannot be passed down as a prop.
 *
 * A page that has titles wraps its notes in `LinkTitlesProvider`; chips read
 * them with `useLinkTitles`. Without a provider chips show the words the URL
 * gives (kind and site), which is the same fallback as an untitled link.
 *
 * @see {@link file://../markdown/link-chip-component.tsx}
 */
import { createContext, useContext } from "react";
import type { LinkTitles } from "@shelf/links";

const LinkTitlesContext = createContext<LinkTitles | undefined>(undefined);

/** Provides the loader's link titles to every chip below it. */
export const LinkTitlesProvider = LinkTitlesContext.Provider;

/**
 * The link titles provided above this component, if any.
 *
 * @returns The titles keyed by `LinkKey`, or undefined without a provider
 */
export function useLinkTitles(): LinkTitles | undefined {
  return useContext(LinkTitlesContext);
}
