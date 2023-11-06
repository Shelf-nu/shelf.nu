import type { ChangeEvent } from "react";
import { atom } from "jotai";

export const titleAtom = atom("");
titleAtom.onMount = (setAtom) => {
  setAtom("Untitled custom field");
};
export const updateTitleAtom = atom(
  null,
  (_get, set, event: ChangeEvent<HTMLInputElement>) =>
    set(titleAtom, event.target.value)
);
