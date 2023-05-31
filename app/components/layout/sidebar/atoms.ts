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

/* Using different atoms for mobile navigation sidebar as they conflict with desktop's sidebar atoms state*/
export const isMobileNavOpenAtom = atom(false);

export const toggleMobileNavAtom = atom(
  (get) => get(isMobileNavOpenAtom),
  (get, set) => set(isMobileNavOpenAtom, !get(isMobileNavOpenAtom))
);
