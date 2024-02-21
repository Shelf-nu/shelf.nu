import { atom } from "jotai";

export const assignCustodyUser = atom<User | null>(null);

type User = {
  id: string;
  name: string;
  userId: string;
};

assignCustodyUser.onMount = (setAtom) => {
  setAtom(null);
};

export const updateSelectedCustodyUserAtom = atom(
  null,
  (_get, set, event: User | null) => set(assignCustodyUser, event)
);
