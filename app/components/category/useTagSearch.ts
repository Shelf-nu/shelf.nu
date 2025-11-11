import { useMemo } from "react";
import type { ChangeEvent } from "react";
import type { Category } from "@prisma/client";
import { useLoaderData } from "react-router";
import { atom, useAtom, useAtomValue } from "jotai";

const searchAtom = atom("");
const isSearchingAtom = atom((get) => get(searchAtom) !== "");

export const useTagSearch = () => {
  const [tagSearch, setTagSearch] = useAtom(searchAtom);
  const isSearchingTags = useAtomValue(isSearchingAtom);

  /** Get the tags from the loader */
  const { tags } = useLoaderData<{
    tags: Category[];
  }>();

  const refinedTags = useMemo(
    () =>
      atom(
        tags.filter((cat) =>
          cat.name.toLowerCase().includes(tagSearch.toLowerCase())
        )
      ),
    [tagSearch, tags]
  ).init;

  const handleTagSearch = (e: ChangeEvent<HTMLInputElement>) => {
    setTagSearch(e.target.value);
  };

  const clearTagSearch = () => {
    setTagSearch("");
  };

  return {
    tagSearch,
    refinedTags,
    isSearchingTags,
    handleTagSearch,
    clearTagSearch,
  };
};
