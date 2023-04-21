import { atom } from "jotai";

export const sidebarCollapseStatusAtom = atom(false);

export const keepSidebarUncollapsedAtom = atom(true);

/* Controls the state for whether the sidebar is collapsed or not */
export const toggleSidebarAtom = atom(
  (get) => get(sidebarCollapseStatusAtom),
  (get, set) =>
    !get(keepSidebarUncollapsedAtom)
      ? set(sidebarCollapseStatusAtom, !get(sidebarCollapseStatusAtom))
      : null
);

/* Controls the state for whether the sidebar uncollapsed state will be maintained or not */
export const maintainUncollapsedAtom = atom(
  (get) => get(keepSidebarUncollapsedAtom),
  (get, set) => {
    set(keepSidebarUncollapsedAtom, !get(keepSidebarUncollapsedAtom));
    set(sidebarCollapseStatusAtom, !get(keepSidebarUncollapsedAtom));
  }
);
