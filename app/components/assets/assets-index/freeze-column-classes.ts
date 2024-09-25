import type { ClassNameValue } from "tailwind-merge";
import { tw } from "~/utils/tw";

export const freezeColumnClassNames: Record<
  "checkbox" | "name" | "nameHeader" | "checkboxHeader",
  ClassNameValue
> = {
  // Because sticky elements dont work with border, we use the after pseudo element to create the border
  checkboxHeader: "sticky left-0 bg-white z-[10]",
  checkbox:
    "sticky left-0 bg-white z-[10] after:content-[''] after:absolute after:inset-0 after:border-b after:border-gray-200",
  nameHeader: tw(
    "sticky left-[48px] z-10 bg-white",
    "before:absolute before:inset-y-0 before:right-0 before:border-r before:content-['']"
  ),
  name: tw(
    "freeze-shadow sticky left-[48px] z-10 bg-white",
    "after:absolute after:inset-0 after:border-b after:border-r after:border-gray-200 after:content-['']"
  ),
};
