import { useState } from "react";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { Button } from "~/components/shared/button";
import type { loader } from "~/routes/_layout+/assets.$assetId.overview.update-location";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import DynamicSelect from "../dynamic-select/dynamic-select";

import { XIcon } from "../icons/library";
import { Image } from "../shared/image";

export const LocationSelect = () => {
  const navigation = useNavigation();

  const { asset } = useLoaderData<typeof loader>();

  const [locationId, setLocationId] = useState(asset.locationId ?? undefined);
  const disabled = isFormProcessing(navigation.state);

  return (
    <div className="relative w-full">
      <input
        type="hidden"
        name="currentLocationId"
        value={asset.locationId || ""}
      />
      <div className="flex items-center gap-2">
        <DynamicSelect
          disabled={disabled}
          fieldName="newLocationId"
          defaultValue={locationId}
          model={{ name: "location", queryKey: "name" }}
          label="Locations"
          initialDataKey="locations"
          countKey="totalLocations"
          closeOnSelect
          extraContent={
            <Button
              to="/locations/new"
              variant="link"
              icon="plus"
              className="w-full justify-start pt-4"
            >
              Create new location
            </Button>
          }
          renderItem={({ name, metadata }) => (
            <div className="flex items-center gap-2">
              <Image
                imageId={metadata.imageId}
                alt="img"
                className={tw(
                  "size-6 rounded-[2px] object-cover",
                  metadata.description ? "rounded-b-none border-b-0" : ""
                )}
              />
              <div>{name}</div>
            </div>
          )}
        />

        <Button
          variant="secondary"
          type="button"
          className="p-3.5"
          onClick={() => setLocationId(undefined)}
          disabled={!locationId}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
};
