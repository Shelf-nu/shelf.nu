import type { ChangeEvent } from "react";
import { atom } from "jotai";

export const dynamicTitleAtom = atom("");
dynamicTitleAtom.onMount = (setAtom) => {
  setAtom("");
};
export const updateDynamicTitleAtom = atom(
  null,
  (_get, set, event: ChangeEvent<HTMLInputElement>) =>
    set(dynamicTitleAtom, event.target.value)
);
