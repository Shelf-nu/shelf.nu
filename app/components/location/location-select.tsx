import { useMemo } from "react";
import { useLoaderData } from "@remix-run/react";
import { Button } from "~/components/shared";
import type { loader } from "~/routes/_layout+/assets.$assetId_.edit";
import { tw } from "~/utils";
import { SearchInput } from "./search-input";
import { useLocationSearch } from "./useLocationSearch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms";
import { Image } from "../shared/image";

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
  const { asset } = useLoaderData<typeof loader>();

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
            className=" max-h-[300px] w-[350px] overflow-auto"
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
                  {refinedLocations.map((c) => (
                    <SelectItem value={c.id} key={c.id} className="p-2">
                      <div className="flex items-center gap-2">
                        <Image
                          imageId={c.imageId}
                          alt="img"
                          className={tw(
                            "h-6 w-6 rounded-[2px] object-cover",
                            c.description ? "rounded-b-none border-b-0" : ""
                          )}
                        />
                        <div>{c.name}</div>
                      </div>
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
