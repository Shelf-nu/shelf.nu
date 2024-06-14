import { atom } from "jotai";

/** Track selected assets for adding assets to booking */
export const bookingsSelectedAssetsAtom = atom<string[]>([]);

/** Track selected assets for adding assets to location */
export const locationsSelectedAssetsAtom = atom<string[]>([]);

/** Track selected assets for adding assets to kits */
export const kitsSelectedAssetsAtom = atom<string[]>([]);

/** Track selected kits for booking */
export const bookingsSelectedKitsAtom = atom<string[]>([]);
