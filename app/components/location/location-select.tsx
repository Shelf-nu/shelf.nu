import { useState } from "react";
import { useNavigation } from "react-router";
import { Button } from "~/components/shared/button";
import { isFormProcessing } from "~/utils/form";
import DynamicSelect from "../dynamic-select/dynamic-select";

import { XIcon } from "../icons/library";
import ImageWithPreview from "../image-with-preview/image-with-preview";

type IsBulk = {
  isBulk: true;
  locationId?: undefined;
};

type IsNotBulk = {
  isBulk: false;
  locationId?: string | null;
};

type BulkProps = IsBulk | IsNotBulk;

type LocationSelectProps = BulkProps & {
  hideClearButton?: boolean;
  placeholder?: string;
};

export const LocationSelect = ({
  hideClearButton = false,
  placeholder,
  ...restProps
}: LocationSelectProps) => {
  const navigation = useNavigation();

  const locationIdToUse = !restProps.isBulk ? restProps.locationId : undefined;
  const [locationId, setLocationId] = useState(locationIdToUse ?? undefined);
  const disabled = isFormProcessing(navigation.state);

  return (
    <div className="relative w-full">
      {!restProps.isBulk && (
        <input
          type="hidden"
          name="currentLocationId"
          value={locationIdToUse ?? undefined}
        />
      )}
      <div className="flex items-center gap-2">
        <DynamicSelect
          disabled={disabled}
          fieldName="newLocationId"
          defaultValue={locationId}
          model={{ name: "location", queryKey: "name" }}
          contentLabel="Locations"
          placeholder={placeholder || "Without location"}
          initialDataKey="locations"
          countKey="totalLocations"
          closeOnSelect
          allowClear
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
              {metadata?.thumbnailUrl ? (
                <ImageWithPreview
                  thumbnailUrl={metadata.thumbnailUrl}
                  alt={metadata.name}
                  className="size-6 rounded-[2px]"
                />
              ) : null}
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
