import type { ClassNameValue } from "tailwind-merge";
import { tw } from "~/utils/tw";

export const freezeColumnClassNames: Record<
  "checkbox" | "name" | "nameHeader" | "checkboxHeader",
  ClassNameValue
> = {
  // Because sticky elements dont work with border, we use the after pseudo element to create the border
  checkboxHeader: tw(
    "sticky left-0 z-10 bg-gray-25",
    "after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-gray-200 after:content-['']"
  ),
  checkbox: tw("sticky left-0 z-10 bg-white"),

  nameHeader: tw(
    "sticky left-[48px] z-10 bg-gray-25",
    "before:absolute before:inset-y-0 before:right-0 before:border-r before:content-['']",
    "after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-gray-200 after:content-['']"
  ),
  name: tw(
    "freeze-shadow sticky left-[48px] z-10 bg-white",
    "after:absolute after:inset-y-0 after:right-[0.5px] after:border-r after:border-gray-200 after:content-['']"
    // "before:absolute before:inset-x-0 before:bottom-0 before:border-b before:border-gray-200 before:content-['']"
  ),
};
