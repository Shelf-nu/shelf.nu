/**
 * The long-press menu for a link, as data: Copy link (when the build has a
 * clipboard module) and Share, titled with the URL so the person sees where
 * it goes before acting on it. iOS shows it as an action sheet with Cancel
 * last; Android as an alert with Cancel first.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it. `showLinkMenu` in `./link-actions.ts` shows it.
 *
 * @see {@link file://./link-actions.ts} `showLinkMenu`
 * @see {@link file://./link-menu.test.ts}
 */

/** What a menu entry does. */
export type LinkMenuAction = "copy" | "share";

/** One entry of the menu, in the order shown. */
export type LinkMenuButton = {
  readonly label: string;
  /** Null for Cancel. */
  readonly action: LinkMenuAction | null;
};

/** The menu for one link. */
export type LinkMenu = {
  readonly title: string;
  readonly buttons: readonly LinkMenuButton[];
  /** Where Cancel sits in `buttons` (the action sheet needs the index). */
  readonly cancelIndex: number;
};

/**
 * Builds the long-press menu for a link.
 *
 * @param url - The link's absolute URL, shown as the title.
 * @param options.ios - True for the iOS action sheet, false for the Android
 *   alert.
 * @param options.canCopy - Whether the build has a clipboard module.
 * @returns The menu's title, buttons and Cancel position.
 */
export function buildLinkMenu(
  url: string,
  { ios, canCopy }: { ios: boolean; canCopy: boolean }
): LinkMenu {
  const actions: LinkMenuButton[] = [
    ...(canCopy ? [{ label: "Copy link", action: "copy" as const }] : []),
    { label: "Share", action: "share" },
  ];
  const cancel: LinkMenuButton = { label: "Cancel", action: null };
  return ios
    ? { title: url, buttons: [...actions, cancel], cancelIndex: actions.length }
    : { title: url, buttons: [cancel, ...actions], cancelIndex: 0 };
}
