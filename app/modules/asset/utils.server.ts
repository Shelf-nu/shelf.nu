import type { Location } from "@prisma/client";

export function getLocationUpdateNoteContent({
  currentLocation,
  newLocation,
  firstName,
  lastName,
  assetName,
  isRemoving,
}: {
  currentLocation?: Pick<Location, "id" | "name"> | null;
  newLocation?: Location | null;
  firstName: string;
  lastName: string;
  assetName: string;
  isRemoving?: boolean;
}) {
  let message = "";
  if (currentLocation && newLocation) {
    message = `**${firstName.trim()} ${lastName.trim()}** updated the location of **${assetName.trim()}** from **[${currentLocation.name.trim()}](/locations/${
      currentLocation.id
    })** to **[${newLocation.name.trim()}](/locations/${newLocation.id})**`; // updating location
  }

  if (newLocation && !currentLocation) {
    message = `**${firstName.trim()} ${lastName.trim()}** set the location of **${assetName.trim()}** to **[${newLocation.name.trim()}](/locations/${
      newLocation.id
    })**`; // setting to first location
  }

  if (isRemoving || !newLocation) {
    message = `**${firstName.trim()} ${lastName.trim()}** removed  **${assetName.trim()}** from location **[${currentLocation?.name.trim()}](/locations/${currentLocation?.id})**`; // removing location
  }

  return message;
}
