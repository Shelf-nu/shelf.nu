import { useState } from "react";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { Button } from "~/components/shared/button";
import type { loader } from "~/routes/_layout+/assets.$assetId.overview.update-location";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import DynamicSelect from "../dynamic-select/dynamic-select";

import { XIcon } from "../icons/library";
import { Image } from "../shared/image";

export const LocationSelect = ({
  isBulk = false,
  hideClearButton = false,
}: {
  isBulk?: boolean;
  hideClearButton?: boolean;
}) => {
  const navigation = useNavigation();

  const data = useLoaderData<typeof loader>();
  const assetLocationId = isBulk
    ? undefined
    : data?.asset?.locationId ?? undefined;

  const [locationId, setLocationId] = useState(undefined);
  const disabled = isFormProcessing(navigation.state);

  return (
    <div className="relative w-full">
      {!isBulk && (
        <input type="hidden" name="currentLocationId" value={assetLocationId} />
      )}
      <div className="flex items-center gap-2">
        <DynamicSelect
          disabled={disabled}
          fieldName="newLocationId"
          defaultValue={locationId}
          model={{ name: "location", queryKey: "name" }}
          contentLabel="Locations"
          initialDataKey="locations"
          countKey="totalLocations"
          closeOnSelect
          extraContent={
            <Button
              to="/locations/new"
              variant="link"
              icon="plus"
              className="w-full justify-start pt-4"
              target="_blank"
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

        {hideClearButton ? null : (
          <Button
            variant="secondary"
            type="button"
            className="p-3.5"
            onClick={() => setLocationId(undefined)}
            disabled={!locationId}
          >
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  );
};
