import { useMemo } from "react";
import type { ChangeEvent } from "react";
import type { Location } from "@prisma/client";
import { useLoaderData } from "react-router";
import { atom, useAtom, useAtomValue } from "jotai";
import type { loader } from "~/routes/_layout+/assets.$assetId_.edit";

const searchAtom = atom("");
const isSearchingAtom = atom((get) => get(searchAtom) !== "");

export const useLocationSearch = () => {
  const [locationSearch, setLocationSearch] = useAtom(searchAtom);
  const isSearchingLocations = useAtomValue(isSearchingAtom);

  /** Get the locations from the loader */
  const locations = useLoaderData<typeof loader>().locations;

  const refinedLocations = useMemo(
    () =>
      atom(
        locations.filter((cat: Location) =>
          cat.name.toLowerCase().includes(locationSearch.toLowerCase())
        )
      ),
    [locationSearch, locations]
  ).init;

  const handleLocationSearch = (e: ChangeEvent<HTMLInputElement>) => {
    setLocationSearch(e.target.value);
  };

  const clearLocationSearch = () => {
    setLocationSearch("");
  };

  return {
    locationSearch,
    refinedLocations,
    isSearchingLocations,
    handleLocationSearch,
    clearLocationSearch,
  };
};
