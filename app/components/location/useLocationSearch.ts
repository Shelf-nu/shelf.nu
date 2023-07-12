import { useMemo } from "react";
import type { ChangeEvent } from "react";
import type { Location } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { atom, useAtom, useAtomValue } from "jotai";

const searchAtom = atom("");
const isSearchingAtom = atom((get) => get(searchAtom) !== "");

export const useLocationSearch = () => {
  const [locationSearch, setLocationSearch] = useAtom(searchAtom);
  const isSearchingLocations = useAtomValue(isSearchingAtom);

  /** Get the locations from the loader */
  const locations = useLoaderData().locations;

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
