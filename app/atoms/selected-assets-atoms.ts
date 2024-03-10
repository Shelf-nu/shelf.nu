import { atom } from "jotai";

/** Track selected assets for adding assets to booking */
export const bookingsSelectedAssetsAtom = atom<string[]>([]);

/** Track selected assets for adding assets to location */
export const locationsSelectedAssetsAtom = atom<string[]>([]);
