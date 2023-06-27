import { useMemo } from "react";
import type { Location } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { Button } from "~/components/shared";
import { SearchInput } from "./search-input";
import { useLocationSearch } from "./useLocationSearch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms";

export const LocationSelect = () => {
  /** This takes care of the search bar inside the dropdown */
  const {
    locationSearch,
    refinedLocations,
    isSearchingLocations,
    handleLocationSearch,
    clearLocationSearch,
  } = useLocationSearch();

  const hasLocations = useMemo(
    () => refinedLocations.length > 0,
    [refinedLocations]
  );
  const { asset } = useLoaderData();

  return (
    <div className="relative w-full">
      <input
        type="hidden"
        name="currentLocationId"
        value={asset?.locationId || ""}
      />
      <Select
        name="newLocationId"
        defaultValue={asset?.locationId || undefined}
      >
        <SelectTrigger className="">
          <SelectValue placeholder="Select location" />
        </SelectTrigger>

        <div>
          <SelectContent
            className=" w-[350px]"
            position="popper"
            align="end"
            sideOffset={4}
          >
            {!hasLocations && !isSearchingLocations ? (
              <div>
                You don't seem to have any locations yet.{" "}
                <Button to={"/locations/new"} variant="link" className="">
                  Create your first location
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <SearchInput
                    filter={locationSearch}
                    handleFilter={handleLocationSearch}
                  />
                  {isSearchingLocations && (
                    <Button
                      icon="x"
                      variant="tertiary"
                      disabled={isSearchingLocations}
                      onClick={clearLocationSearch}
                      className="z-100 pointer-events-auto absolute  right-[14px] top-0  h-full  border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                    />
                  )}
                </div>

                <div className="border-b border-b-gray-300 py-2 ">
                  {refinedLocations.map((c: Location) => (
                    <SelectItem value={c.id} key={c.id}>
                      {c.name}{" "}
                    </SelectItem>
                  ))}
                </div>

                <Button
                  to={"/locations/new"}
                  variant="link"
                  icon="plus"
                  className="w-full justify-start pt-4"
                >
                  Create new location
                </Button>
              </>
            )}
          </SelectContent>
        </div>
      </Select>
    </div>
  );
};
