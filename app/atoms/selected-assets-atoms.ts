import { atom } from "jotai";

/** Track selected assets for adding assets to booking */
export const bookingsSelectedAssetsAtom = atom<string[]>([]);

/** Track selected kits for booking */
export const bookingsSelectedKitsAtom = atom<string[]>([]);
