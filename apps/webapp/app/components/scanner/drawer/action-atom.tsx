import { atom } from "jotai";
import type { ActionType } from "./action-switcher";

export const scannerActionAtom = atom<ActionType>("View asset");
